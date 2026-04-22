import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Box, Float, Sphere, Torus } from "@react-three/drei";
import * as THREE from "three";

function FloatingSphere({
  position,
  color,
  scale = 1,
  speed = 1,
}: {
  position: [number, number, number];
  color: string;
  scale?: number;
  speed?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x = state.clock.elapsedTime * speed * 0.3;
      meshRef.current.rotation.y = state.clock.elapsedTime * speed * 0.2;
    }
  });

  return (
    <Float speed={speed * 2} rotationIntensity={0.5} floatIntensity={1.5}>
      <Sphere ref={meshRef} args={[1, 32, 32]} position={position} scale={scale}>
        <meshStandardMaterial
          color={color}
          metalness={0.9}
          roughness={0.1}
          emissive={color}
          emissiveIntensity={0.1}
        />
      </Sphere>
    </Float>
  );
}

function FloatingBox({
  position,
  color,
  scale = 1,
  speed = 1,
}: {
  position: [number, number, number];
  color: string;
  scale?: number;
  speed?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x = state.clock.elapsedTime * speed * 0.4;
      meshRef.current.rotation.z = state.clock.elapsedTime * speed * 0.3;
    }
  });

  return (
    <Float speed={speed * 1.5} rotationIntensity={0.8} floatIntensity={1}>
      <Box ref={meshRef} args={[1, 1, 1]} position={position} scale={scale}>
        <meshStandardMaterial
          color={color}
          metalness={0.8}
          roughness={0.2}
          emissive={color}
          emissiveIntensity={0.05}
        />
      </Box>
    </Float>
  );
}

function FloatingRing({
  position,
  color,
  scale = 1,
  speed = 1,
}: {
  position: [number, number, number];
  color: string;
  scale?: number;
  speed?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x =
        Math.sin(state.clock.elapsedTime * speed * 0.5) * 0.5;
      meshRef.current.rotation.y = state.clock.elapsedTime * speed * 0.3;
    }
  });

  return (
    <Float speed={speed} rotationIntensity={0.3} floatIntensity={2}>
      <Torus ref={meshRef} args={[1, 0.1, 16, 48]} position={position} scale={scale}>
        <meshStandardMaterial
          color={color}
          metalness={0.95}
          roughness={0.05}
          emissive={color}
          emissiveIntensity={0.15}
        />
      </Torus>
    </Float>
  );
}

function Stars() {
  const starsRef = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const pos = new Float32Array(150 * 3);
    for (let i = 0; i < 150; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 25;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 25;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 25;
    }
    return pos;
  }, []);

  useFrame((state) => {
    if (starsRef.current) {
      starsRef.current.rotation.y = state.clock.elapsedTime * 0.01;
    }
  });

  return (
    <points ref={starsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={150}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.08}
        color="#a78bfa"
        transparent
        opacity={0.8}
        sizeAttenuation
      />
    </points>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[10, 10, 10]} intensity={1.5} color="#8b5cf6" />
      <pointLight position={[-10, -10, -10]} intensity={0.8} color="#14b8a6" />
      <pointLight position={[0, 5, 5]} intensity={0.5} color="#f472b6" />

      <FloatingSphere position={[-3, 1.5, -2]} color="#8b5cf6" scale={1} speed={0.8} />
      <FloatingSphere position={[3, -1.5, -3]} color="#14b8a6" scale={0.7} speed={1.2} />
      <FloatingSphere position={[-1.5, -2, -1]} color="#f472b6" scale={0.5} speed={1} />

      <FloatingBox position={[2.5, 2, -4]} color="#a78bfa" scale={0.6} speed={0.7} />
      <FloatingBox position={[-2.5, -1, -5]} color="#2dd4bf" scale={0.5} speed={0.9} />

      <FloatingRing position={[0, 0, -6]} color="#8b5cf6" scale={1.8} speed={0.5} />
      <FloatingRing position={[-3.5, 0.5, -7]} color="#14b8a6" scale={1} speed={0.6} />

      <Stars />
    </>
  );
}

export function Scene3D() {
  return (
    <div className="fixed inset-0 z-0">
      <Canvas
        camera={{ position: [0, 0, 10], fov: 50 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "default" }}
      >
        <color attach="background" args={["#0a0a12"]} />
        <fog attach="fog" args={["#0a0a12", 8, 25]} />
        <Scene />
      </Canvas>
    </div>
  );
}
