import { useRef, useMemo } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { Float } from "@react-three/drei"
import * as THREE from "three"
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js"

// Cerebro generado proceduralmente: icosfera subdividida con desplazamiento
// de vertices via simplex noise para producir giros y surcos realistas,
// mas un surco longitudinal marcado que separa los hemisferios.
function useBrainGeometry(seed: number = 0) {
  return useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 6) // 40,962 vertices
    const noise = new SimplexNoise()
    const pos = g.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()

    // seed-like perturbation
    const s = seed * 13.37

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      const n = v.clone().normalize()

      // Forma general: un poco alargado en X (lobulos), aplanado en Y
      const shapeX = 1.22
      const shapeY = 0.92
      const shapeZ = 1.0

      // Octavas de ruido para los pliegues organicos
      let disp = 0
      disp += noise.noise3d(n.x * 1.3 + s, n.y * 1.3, n.z * 1.3) * 0.14
      disp += noise.noise3d(n.x * 3.2, n.y * 3.2 + s, n.z * 3.2) * 0.08
      disp += noise.noise3d(n.x * 7 + s, n.y * 7, n.z * 7) * 0.04
      disp += noise.noise3d(n.x * 15, n.y * 15, n.z * 15 + s) * 0.015

      // Cisura longitudinal: surco profundo en x=0 sobre la mitad superior
      const fissure =
        Math.exp(-Math.pow(n.x * 5.5, 2)) *
        Math.max(0, n.y * 1.2) *
        0.18

      // Pequeno aplanado en la base (donde estaria el tronco)
      const baseFlatten = Math.max(0, -n.y - 0.5) * 0.15

      const r = 1 + disp - fissure - baseFlatten

      pos.setXYZ(
        i,
        n.x * r * shapeX * 1.25,
        n.y * r * shapeY * 1.25,
        n.z * r * shapeZ * 1.25,
      )
    }

    g.computeVertexNormals()
    return g
  }, [seed])
}

function Brain() {
  const ref = useRef<THREE.Mesh>(null)
  const wireRef = useRef<THREE.Mesh>(null)
  const geometry = useBrainGeometry(1)

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.15
    }
    if (wireRef.current) {
      wireRef.current.rotation.y = state.clock.elapsedTime * 0.15
    }
  })

  return (
    <group>
      {/* Superficie principal del cortex */}
      <mesh ref={ref} geometry={geometry}>
        <meshStandardMaterial
          color="#8b5cf6"
          metalness={0.25}
          roughness={0.6}
          emissive="#7c3aed"
          emissiveIntensity={0.18}
        />
      </mesh>

      {/* Overlay de wireframe tenue para resaltar los pliegues */}
      <mesh ref={wireRef} geometry={geometry} scale={1.003}>
        <meshBasicMaterial
          color="#14b8a6"
          wireframe
          transparent
          opacity={0.08}
        />
      </mesh>

      {/* Tronco encefalico / medula, en tono teal */}
      <BrainStem />
    </group>
  )
}

function BrainStem() {
  const ref = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.15
    }
  })

  return (
    <group ref={ref} position={[0, -1.1, -0.1]}>
      <mesh position={[0, -0.4, 0]}>
        <cylinderGeometry args={[0.22, 0.32, 0.9, 24]} />
        <meshStandardMaterial
          color="#14b8a6"
          metalness={0.4}
          roughness={0.5}
          emissive="#0d9488"
          emissiveIntensity={0.18}
        />
      </mesh>
      {/* Cerebelo */}
      <mesh position={[0, -0.1, -0.5]}>
        <sphereGeometry args={[0.55, 24, 24]} />
        <meshStandardMaterial
          color="#2dd4bf"
          metalness={0.3}
          roughness={0.55}
          emissive="#14b8a6"
          emissiveIntensity={0.15}
        />
      </mesh>
    </group>
  )
}

// Particulas tipo sinapsis alrededor del cerebro
function NeuralParticles() {
  const particlesRef = useRef<THREE.Points>(null)

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
    if (particlesRef.current) {
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

  useFrame((state) => {
    if (auraRef.current) {
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

function Brain3D() {
  return (
    <Float speed={1.2} rotationIntensity={0.2} floatIntensity={0.5}>
      <group scale={1.15}>
        <Brain />
        <NeuralParticles />
        <BrainAura />
      </group>
    </Float>
  )
}

function Scene() {
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

      <Brain3D />
    </>
  )
}

export function BrainScene() {
  return (
    <div className="fixed inset-0 z-0">
      <Canvas
        camera={{ position: [0, 0, 7], fov: 50 }}
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          powerPreference: "default",
        }}
      >
        <color attach="background" args={["#08071A"]} />
        <fog attach="fog" args={["#08071A", 6, 18]} />
        <Scene />
      </Canvas>
    </div>
  )
}
