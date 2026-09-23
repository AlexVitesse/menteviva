import { Suspense, useEffect, useRef, useMemo, useState } from "react"
import { useReducedMotion } from "framer-motion"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { OrbitControls, useGLTF } from "@react-three/drei"
import * as THREE from "three"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"
import { ANCHORS, type Zone as ZoneId } from "./acts"
import { isBrainDebug, kicks, pose, samplePose } from "./use-act"

// Modelo decimado (~68k vertices, solo normalMap; el original vive en
// docs/landing-assets/brain-full.glb fuera de git). drei enchufa el
// MeshoptDecoder por defecto.
const BRAIN_URL = "/models/brain.glb"
// Diametro objetivo en unidades de escena; ANCHORS vive en este espacio.
const BRAIN_SIZE = 2.4
const POSTER_URL = "/landing/brain-poster.webp"
const INK = "#08071A"

const FRESNEL_VERT = /* glsl */ `
  uniform float uPower;
  varying float vFresnel;
  void main() {
    vec3 n = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFresnel = pow(1.0 - abs(dot(n, normalize(-mv.xyz))), uPower);
    gl_Position = projectionMatrix * mv;
  }
`
const FRESNEL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vFresnel;
  void main() { gl_FragColor = vec4(uColor * vFresnel * uIntensity, vFresnel); }
`

function Brain({ fresnel, onReady }: { fresnel: THREE.ShaderMaterial; onReady: () => void }) {
  const { scene } = useGLTF(BRAIN_URL)
  // Un frame despues de montar ya se compilaron los shaders: se apaga el poster.
  useFrame(() => onReady())

  const brain = useMemo(() => {
    const root = scene.clone(true)
    // Se juntan antes: el fresnel se agrega como hijo y traverse lo visitaria.
    const meshes: THREE.Mesh[] = []
    root.traverse((obj) => obj instanceof THREE.Mesh && meshes.push(obj))
    meshes.forEach((obj) => {
      // Violeta oscuro con surcos via normalMap. Clearcoat bajo + entorno
      // (RoomEnvironment, ver Environment) para que no se vea de plastico.
      const old = obj.material as THREE.MeshStandardMaterial
      obj.material = new THREE.MeshPhysicalMaterial({
        color: "#170E48",
        roughness: 0.62,
        metalness: 0.0,
        clearcoat: 0.45,
        clearcoatRoughness: 0.4,
        iridescence: 0.18,
        iridescenceIOR: 1.3,
        emissive: "#5B21B6",
        emissiveIntensity: 0.12,
        envMapIntensity: 0.4,
        normalMap: old.normalMap,
        normalScale: old.normalScale,
      })
      old.map?.dispose()
      old.roughnessMap?.dispose()
      old.dispose()
      // Hijo de la malla: hereda su transform exacto y comparte geometria.
      obj.add(new THREE.Mesh(obj.geometry, fresnel))
    })
    // El glb trae su propio origen y escala: se centra y normaliza.
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const k = BRAIN_SIZE / Math.max(size.x, size.y, size.z)
    root.scale.setScalar(k)
    root.position.copy(center).multiplyScalar(-k)
    return root
  }, [scene, fresnel])

  return <primitive object={brain} />
}

useGLTF.preload(BRAIN_URL)

// Reflejos procedurales (sin descargar HDR). Sin esto el material se ve plano.
function Environment() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = tex
    return () => {
      scene.environment = null
      tex.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
  return null
}

// Bloom con umbral alto: solo brillan el fresnel y las zonas. Con prioridad 1
// en useFrame, R3F deja de renderizar solo y lo hace el composer.
function Post() {
  const { gl, scene, camera, size } = useThree()
  const fx = useMemo(() => {
    const composer = new EffectComposer(gl)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0.8, 0.55, 0.62)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())
    return { composer, bloom }
  }, [gl, scene, camera])
  useEffect(() => {
    fx.composer.setPixelRatio(gl.getPixelRatio())
    fx.composer.setSize(size.width, size.height)
  }, [fx, gl, size])
  useEffect(() => () => fx.composer.dispose(), [fx])
  useFrame(() => {
    fx.bloom.strength = pose.bloom
    fx.composer.render()
  }, 1)
  return null
}

// Degradado radial blanco -> transparente (llega a 0 en el borde: sin halos cuadrados).
let glowTexture: THREE.CanvasTexture | null = null
function getGlowTexture() {
  if (glowTexture) return glowTexture
  const c = document.createElement("canvas")
  c.width = c.height = 128
  const ctx = c.getContext("2d")!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, "rgba(255,255,255,1)")
  g.addColorStop(0.35, "rgba(255,255,255,0.45)")
  g.addColorStop(1, "rgba(255,255,255,0)")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  glowTexture = new THREE.CanvasTexture(c)
  return glowTexture
}

/** Zona funcional: glow que se ve a traves de la corteza + luz que tiñe la superficie. */
function Zone({ id }: { id: ZoneId }) {
  const reduce = useReducedMotion()
  const sprite = useRef<THREE.Sprite>(null)
  const light = useRef<THREE.PointLight>(null)
  const color = useMemo(() => new THREE.Color(), [])
  const target = useMemo(() => new THREE.Color(), [])
  const level = useRef(0)

  useFrame((state, delta) => {
    const [c, intensity] = pose.zones[id] ?? ["#000000", 0]
    const lambda = reduce ? 20 : 4.5
    level.current = THREE.MathUtils.damp(level.current, intensity, lambda, delta)
    if (intensity > 0) color.lerp(target.set(c), 1 - Math.exp(-lambda * delta))
    kicks[id] = Math.max(0, (kicks[id] ?? 0) - delta * 2.2)
    const pulse = intensity > 0 && !reduce ? 1 + 0.18 * Math.sin(state.clock.elapsedTime * 3.2) : 1
    const i = level.current * pulse + (kicks[id] ?? 0)
    if (sprite.current) {
      const m = sprite.current.material
      m.color.copy(color)
      m.opacity = Math.min(1, i / 4.5)
    }
    if (light.current) {
      light.current.color.copy(color)
      light.current.intensity = i * 4
    }
  })

  return (
    <group position={ANCHORS[id]}>
      <sprite ref={sprite} scale={0.7}>
        <spriteMaterial
          map={getGlowTexture()}
          transparent
          opacity={0}
          depthTest={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <pointLight ref={light} distance={1.5} decay={2} intensity={0} />
    </group>
  )
}

// Particulas tipo sinapsis alrededor del cerebro; su opacidad la maneja el acto.
function NeuralParticles({ material }: { material: THREE.PointsMaterial }) {
  const ref = useRef<THREE.Points>(null)
  const reduce = useReducedMotion()

  const { positions, colors } = useMemo(() => {
    const count = window.innerWidth < 1024 ? 70 : 140
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const violet = new THREE.Color("#8b5cf6")
    const teal = new THREE.Color("#14b8a6")
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.random() * Math.PI
      const r = 2.0 + Math.random() * 1.8
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = r * Math.cos(phi) * 0.75
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
      const c = Math.random() > 0.5 ? violet : teal
      col.set([c.r, c.g, c.b], i * 3)
    }
    return { positions: pos, colors: col }
  }, [])

  useFrame((state) => {
    if (!reduce && ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.05
      ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.1
    }
  })

  return (
    <points ref={ref} material={material}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={positions.length / 3} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={colors.length / 3} array={colors} itemSize={3} />
      </bufferGeometry>
    </points>
  )
}

function DebugAnchors() {
  return (
    <>
      {Object.entries(ANCHORS).map(([zone, p]) => (
        <mesh key={zone} position={p}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshBasicMaterial color="#F97316" depthTest={false} />
        </mesh>
      ))}
      <axesHelper args={[1.6]} />
    </>
  )
}

const ZONE_IDS = Object.keys(ANCHORS) as ZoneId[]

function Brain3D({ debug, onReady }: { debug: boolean; onReady: () => void }) {
  const reduce = useReducedMotion()
  const ref = useRef<THREE.Group>(null)
  const idle = useRef(0)
  const look = useMemo(() => new THREE.Vector3(...pose.look), [])
  const proj = useMemo(() => new THREE.Vector3(), [])

  const fresnel = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: FRESNEL_VERT,
        fragmentShader: FRESNEL_FRAG,
        uniforms: {
          uColor: { value: new THREE.Color("#A855F7") },
          uPower: { value: 2.6 },
          uIntensity: { value: 0.9 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
      }),
    []
  )
  const points = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 0.035,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        sizeAttenuation: true,
        depthWrite: false,
      }),
    []
  )

  // Cada frame: la pose objetivo sale del scroll y la camara la persigue con damp.
  useFrame((state, delta) => {
    const g = ref.current
    if (!g) return
    const cam = state.camera
    samplePose(state.size.width / state.size.height)
    const lambda = reduce ? 30 : 4.5
    const damp = (from: number, to: number) => THREE.MathUtils.damp(from, to, lambda, delta)

    if (!debug) {
      cam.position.set(damp(cam.position.x, pose.cam[0]), damp(cam.position.y, pose.cam[1]), damp(cam.position.z, pose.cam[2]))
      look.set(damp(look.x, pose.look[0]), damp(look.y, pose.look[1]), damp(look.z, pose.look[2]))
      cam.lookAt(look)
    }
    if (!reduce) idle.current += delta * 0.1
    g.rotation.y = damp(g.rotation.y, pose.rot + idle.current)
    fresnel.uniforms.uIntensity.value = damp(fresnel.uniforms.uIntensity.value, pose.fresnel * 0.9)
    points.opacity = damp(points.opacity, pose.synapses * 0.85)

    // La luz del cerebro cae sobre la pagina (ver .lp-bleed en index.css).
    const [where, color] = pose.bleed
    if (where === "center") proj.set(0, 0, 0)
    else proj.fromArray(ANCHORS[where])
    g.localToWorld(proj).project(cam)
    const s = document.documentElement.style
    s.setProperty("--bx", `${(proj.x * 0.5 + 0.5) * 100}%`)
    s.setProperty("--by", `${(-proj.y * 0.5 + 0.5) * 100}%`)
    s.setProperty("--bc", color)
  })

  return (
    <group ref={ref}>
      <Suspense fallback={null}>
        <Brain fresnel={fresnel} onReady={onReady} />
      </Suspense>
      <NeuralParticles material={points} />
      {ZONE_IDS.map((id) => (
        <Zone key={id} id={id} />
      ))}
      {debug && <DebugAnchors />}
    </group>
  )
}

const hasWebGL = () => {
  try {
    return !!document.createElement("canvas").getContext("webgl2")
  } catch {
    return false
  }
}

/**
 * Mismo encuadre que el cerebro del acto 1 (camara a 3.1, look y -0.45):
 * el cerebro mide ~1.1 pantallas y queda recortado arriba.
 */
export function BrainPoster() {
  const [ok, setOk] = useState(true)
  if (!ok) return null
  return (
    <img
      src={POSTER_URL}
      alt=""
      onError={() => setOk(false)}
      className="absolute left-1/2 top-[-22vh] h-[104vh] w-auto max-w-none -translate-x-1/2"
    />
  )
}

/**
 * Canvas fijo a pantalla completa detras del contenido. El cerebro narra el
 * scroll: cada [data-act] de la pagina le da una pose de camara (ver acts.ts).
 */
export function BrainScene() {
  const debug = useMemo(isBrainDebug, [])
  const webgl = useMemo(hasWebGL, [])
  const [ready, setReady] = useState(false)
  const onReady = useMemo(() => {
    let done = false
    return () => {
      if (!done) { done = true; setReady(true) }
    }
  }, [])

  return (
    <div
      className={debug ? "fixed inset-0 z-[60]" : "pointer-events-none fixed inset-0 z-0"}
      aria-hidden="true"
    >
      {(!webgl || !ready) && <BrainPoster />}
      {webgl && (
        <Canvas
          camera={{ position: pose.cam, fov: 40, near: 0.1, far: 40 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        >
          <color attach="background" args={[INK]} />
          <fog attach="fog" args={[INK, 6, 16]} />
          <Environment />
          <ambientLight color="#4C3A8A" intensity={0.35} />
          {/* Blanca calida para que el normalMap dibuje los surcos. */}
          <directionalLight position={[3, 4, 5]} intensity={1.6} color="#FFF4E6" />
          <pointLight position={[-4, 2, 3]} intensity={14} distance={12} decay={2} color="#7C3AED" />
          <pointLight position={[4, -2, -3]} intensity={9} distance={12} decay={2} color="#06B6D4" />
          <Brain3D debug={debug} onReady={onReady} />
          <Post />
          {debug && <OrbitControls enableZoom={false} />}
        </Canvas>
      )}
    </div>
  )
}
