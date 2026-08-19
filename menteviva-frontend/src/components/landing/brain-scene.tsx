import { Suspense, useRef, useMemo } from "react"
import { useReducedMotion, useScroll, type MotionValue } from "framer-motion"
import { Canvas, useFrame } from "@react-three/fiber"
import { Float, useGLTF } from "@react-three/drei"
import * as THREE from "three"

// Modelo del cerebro (glTF meshopt + texturas WebP, ~2.5 MB). drei enchufa el
// MeshoptDecoder por defecto, asi que no hace falta configurar nada mas.
const BRAIN_URL = "/models/brain.glb"
// Diametro objetivo en unidades de escena: el aura mide 2.6 de radio y las
// particulas orbitan fuera, asi que el cerebro se normaliza a ~2.4.
const BRAIN_SIZE = 2.4

function Brain() {
  const ref = useRef<THREE.Group>(null)
  const reduce = useReducedMotion()
  const { scene } = useGLTF(BRAIN_URL)

  // El glb trae su propio origen (apoyado en y=0) y su propia escala: lo
  // centramos y lo normalizamos para que encaje con el resto de la escena.
  const brain = useMemo(() => {
    const root = scene.clone(true)
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const k = BRAIN_SIZE / Math.max(size.x, size.y, size.z)
    root.scale.setScalar(k)
    root.position.copy(center).multiplyScalar(-k)
    return root
  }, [scene])

  useFrame((state) => {
    if (!reduce && ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.15
    }
  })

  return (
    <group ref={ref}>
      <primitive object={brain} />
    </group>
  )
}

useGLTF.preload(BRAIN_URL)

// Particulas tipo sinapsis alrededor del cerebro
function NeuralParticles() {
  const particlesRef = useRef<THREE.Points>(null)
  const reduce = useReducedMotion()

  const { positions, colors } = useMemo(() => {
    const count = 220
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)

    const violet = new THREE.Color("#8b5cf6")
    const teal = new THREE.Color("#14b8a6")

    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.random() * Math.PI
      const r = 2.2 + Math.random() * 1.6

      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = r * Math.cos(phi) * 0.75
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)

      const color = Math.random() > 0.5 ? violet : teal
      col[i * 3] = color.r
      col[i * 3 + 1] = color.g
      col[i * 3 + 2] = color.b
    }
    return { positions: pos, colors: col }
  }, [])

  useFrame((state) => {
    if (!reduce && particlesRef.current) {
      particlesRef.current.rotation.y = state.clock.elapsedTime * 0.05
      particlesRef.current.rotation.x =
        Math.sin(state.clock.elapsedTime * 0.1) * 0.1
    }
  })

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={colors.length / 3}
          array={colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.045}
        vertexColors
        transparent
        opacity={0.85}
        sizeAttenuation
      />
    </points>
  )
}

// Aura suave que rodea el cerebro
function BrainAura() {
  const auraRef = useRef<THREE.Mesh>(null)
  const reduce = useReducedMotion()

  useFrame((state) => {
    if (!reduce && auraRef.current) {
      auraRef.current.rotation.y = state.clock.elapsedTime * 0.1
      const scale = 1 + Math.sin(state.clock.elapsedTime * 0.5) * 0.04
      auraRef.current.scale.set(scale, scale, scale)
    }
  })

  return (
    <mesh ref={auraRef}>
      <sphereGeometry args={[2.6, 32, 32]} />
      <meshStandardMaterial
        color="#8b5cf6"
        transparent
        opacity={0.06}
        side={THREE.BackSide}
      />
    </mesh>
  )
}

function Brain3D({ progress }: { progress: MotionValue<number> }) {
  const reduce = useReducedMotion()
  const ref = useRef<THREE.Group>(null)

  // El cerebro deriva y se hunde conforme baja la pagina: deja de ser papel
  // tapiz y acompaña la lectura. Un solo grupo animado, sin re-renders.
  useFrame(() => {
    if (!ref.current) return
    const t = reduce ? 0 : progress.get()
    ref.current.rotation.y = t * Math.PI * 1.4
    ref.current.position.x = 1.7 + t * 0.9
    ref.current.position.y = -t * 1.6
    ref.current.position.z = -t * 2.2
    ref.current.scale.setScalar(1.15 - t * 0.2)
  })

  return (
    <group ref={ref} position={[1.7, 0, 0]} scale={1.15}>
      <Float
        speed={reduce ? 0 : 1.2}
        rotationIntensity={reduce ? 0 : 0.2}
        floatIntensity={reduce ? 0 : 0.5}
      >
        <Suspense fallback={null}>
          <Brain />
        </Suspense>
        <NeuralParticles />
        <BrainAura />
      </Float>
    </group>
  )
}

function Scene({ progress }: { progress: MotionValue<number> }) {
  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[10, 10, 10]} intensity={1.5} color="#8b5cf6" />
      <pointLight position={[-10, -10, -10]} intensity={0.9} color="#14b8a6" />
      <pointLight position={[0, 5, 5]} intensity={0.6} color="#f472b6" />
      <spotLight
        position={[0, 10, 0]}
        angle={0.5}
        penumbra={1}
        intensity={1}
        color="#7c3aed"
      />

      <Brain3D progress={progress} />
    </>
  )
}

/**
 * Atmosfera de toda la pagina: canvas fijo a pantalla completa detras del
 * contenido. El cerebro arranca descentrado a la derecha (para no quedar
 * detras del titular) y deriva hacia la izquierda conforme se baja.
 */
export function BrainScene() {
  const { scrollYProgress } = useScroll()

  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      {/* Velo de lectura: el contenido vive en la mitad izquierda y necesita
          suelo oscuro; el cerebro respira en la derecha. */}
      <div className="absolute inset-0 z-10 bg-gradient-to-r from-ink via-ink/85 to-transparent lg:via-ink/70" />
      <Canvas
        camera={{ position: [0, 0, 7], fov: 50 }}
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          powerPreference: "default",
        }}
      >
        <fog attach="fog" args={["#08071A", 6, 18]} />
        <Scene progress={scrollYProgress} />
      </Canvas>
    </div>
  )
}
