import { Suspense, useEffect, useRef, type RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, Environment } from "@react-three/drei";
import * as THREE from "three";

interface TalkingHeadAvatarProps {
  audioRef: RefObject<HTMLAudioElement | null>;
  isSpeaking: boolean;
  isActive?: boolean;
  modelUrl?: string;
}

const DEFAULT_MODEL_URL = "/avatars/sofia.glb";

type AudioGraph = {
  ctx: AudioContext;
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
};

// MediaElementAudioSourceNode solo puede crearse UNA vez por elemento.
// Si el componente se vuelve a montar sobre el mismo audio, reutilizamos.
const audioGraphCache = new WeakMap<HTMLAudioElement, AudioGraph>();

function getAudioGraph(el: HTMLAudioElement): AudioGraph {
  const cached = audioGraphCache.get(el);
  if (cached) return cached;

  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const source = ctx.createMediaElementSource(el);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.5;
  // CRITICO: el default minDecibels=-100 deja pasar el ruido de compresion
  // del MP3 (ElevenLabs entrega audio comprimido con artefactos de baja
  // amplitud constantes). Subir a -55 dB establece un noise gate efectivo:
  // cualquier cosa por debajo se mapea a byte 0. Sin esto, la boca nunca
  // cierra del todo entre silabas.
  analyser.minDecibels = -55;
  analyser.maxDecibels = -10;
  // Cadena: source -> analyser -> destination. analyser.connect(destination)
  // es OBLIGATORIO o el audio se silencia al pasar por el AudioContext.
  source.connect(analyser);
  analyser.connect(ctx.destination);

  const buffer = new ArrayBuffer(analyser.frequencyBinCount);
  const graph = { ctx, analyser, data: new Uint8Array(buffer) };
  audioGraphCache.set(el, graph);
  return graph;
}

function AvatarModel({
  url,
  audioRef,
  isSpeaking,
}: {
  url: string;
  audioRef: RefObject<HTMLAudioElement | null>;
  isSpeaking: boolean;
}) {
  const { scene } = useGLTF(url);
  const morphMeshesRef = useRef<THREE.SkinnedMesh[]>([]);
  const headBoneRef = useRef<THREE.Object3D | null>(null);
  const graphRef = useRef<AudioGraph | null>(null);

  // Estado de animacion suavizado para evitar tremor.
  const ampRef = useRef(0);          // amplitud filtrada de boca
  const silenceMsRef = useRef(0);    // ms acumulados bajo el piso de voz (gate)
  const blinkTimerRef = useRef(0);
  const blinkPhaseRef = useRef(0);
  const browTargetRef = useRef(0);   // valor objetivo de cejas (0..1)
  const browValueRef = useRef(0);    // valor actual interpolado
  const browTimerRef = useRef(0);    // proximo lift en seg
  const clockRef = useRef(0);        // tiempo acumulado para sway/breath

  useEffect(() => {
    const meshes: THREE.SkinnedMesh[] = [];
    let head: THREE.Object3D | null = null;
    scene.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        meshes.push(mesh);
      }
      // RPM/Wolf3D + samples de TalkingHead nombran al hueso "Head".
      if (!head && (obj.name === "Head" || obj.name === "head")) {
        head = obj;
      }
    });
    morphMeshesRef.current = meshes;
    headBoneRef.current = head;
  }, [scene]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    graphRef.current = getAudioGraph(el);
    if (graphRef.current.ctx.state === "suspended") {
      graphRef.current.ctx.resume().catch(() => {});
    }
  }, [audioRef]);

  useFrame((_, delta) => {
    const meshes = morphMeshesRef.current;
    if (meshes.length === 0) return;

    clockRef.current += delta;
    const t = clockRef.current;

    // --- Amplitud de voz (RMS + noise gate + hysteresis) ---
    let rawAmp = 0;
    if (isSpeaking && graphRef.current) {
      const { analyser, data } = graphRef.current;
      analyser.getByteFrequencyData(data);
      // Vocales ~300-3000 Hz. fftSize 1024 + sampleRate ~48k -> bin ≈ 47 Hz.
      // bins 6..64 cubren ~280-3000 Hz.
      let sumSq = 0;
      let n = 0;
      const end = Math.min(64, data.length);
      for (let i = 6; i < end; i++) {
        sumSq += data[i] * data[i];
        n++;
      }
      // RMS sobre el band-pass + normalizar a [0,1]. Mas estable que la media.
      const rms = n > 0 ? Math.sqrt(sumSq / n) : 0;
      rawAmp = Math.min(1, rms / 95);

      // Gate con hysteresis temporal: si la amplitud cae bajo el piso de voz
      // por mas de 100 ms, forzamos rawAmp=0 ("snap to closed"). Esto evita
      // que el ruido de compresion del MP3 (que el minDecibels deja pasar
      // ocasionalmente) mantenga la boca abierta entre silabas.
      const VOICE_FLOOR = 0.13;
      const SILENCE_HOLD_MS = 100;
      if (rawAmp < VOICE_FLOOR) {
        silenceMsRef.current += delta * 1000;
        if (silenceMsRef.current > SILENCE_HOLD_MS) rawAmp = 0;
      } else {
        silenceMsRef.current = 0;
        // Curva no-lineal: amplifica voz fuerte, comprime voz suave.
        rawAmp = Math.pow(rawAmp, 1.4);
      }
    } else {
      silenceMsRef.current = 0;
    }
    // Lerp asimetrico: ataque rapido para seguir la silaba, release tambien
    // moderadamente rapido (boca cierra solido al silencio).
    const lerpFactor = rawAmp > ampRef.current ? 0.55 : 0.32;
    ampRef.current += (rawAmp - ampRef.current) * lerpFactor;
    // Snap-to-zero final: por debajo de 0.015 consideramos boca cerrada.
    if (ampRef.current < 0.015) ampRef.current = 0;
    const amp = ampRef.current;

    // --- Blink idle ---
    blinkTimerRef.current += delta;
    if (blinkPhaseRef.current > 0) {
      blinkPhaseRef.current = Math.max(0, blinkPhaseRef.current - delta);
    } else if (blinkTimerRef.current > 3 + Math.random() * 3) {
      blinkTimerRef.current = 0;
      blinkPhaseRef.current = 0.14;
    }
    const blink =
      blinkPhaseRef.current > 0
        ? 1 - Math.abs(blinkPhaseRef.current - 0.07) / 0.07
        : 0;

    // --- Brow lift ocasional al hablar (cada 4-7s) ---
    browTimerRef.current += delta;
    if (isSpeaking && browTimerRef.current > 4 + Math.random() * 3) {
      browTimerRef.current = 0;
      browTargetRef.current = 0.25 + Math.random() * 0.25;
      // Mantener el lift ~600ms y luego soltar
      window.setTimeout(() => { browTargetRef.current = 0; }, 600);
    } else if (!isSpeaking) {
      browTargetRef.current = 0;
    }
    browValueRef.current += (browTargetRef.current - browValueRef.current) * 0.12;

    // --- Head sway sutil al hablar + breath idle ---
    const head = headBoneRef.current;
    if (head) {
      const swayAmount = isSpeaking ? 0.04 + amp * 0.03 : 0.015;
      const targetYaw = Math.sin(t * 0.7) * swayAmount;
      const targetPitch = Math.sin(t * 0.5 + 1.3) * swayAmount * 0.6;
      // Lerp para que el sway sea organico
      head.rotation.y += (targetYaw - head.rotation.y) * 0.08;
      head.rotation.x += (targetPitch - head.rotation.x) * 0.08;
    }

    for (const mesh of meshes) {
      const dict = mesh.morphTargetDictionary;
      const inf = mesh.morphTargetInfluences;
      if (!dict || !inf) continue;

      const setMorph = (name: string, value: number) => {
        const idx = dict[name];
        if (idx !== undefined) inf[idx] = value;
      };

      // Boca: combinacion de jaw + mouthOpen + viseme_aa para apertura solida.
      // Cuando amp=0, los tres morphs son 0 -> labios cerrados sin gap.
      // Sin baselines persistentes (mouthSmile/mouthFunnel) que parten labios.
      setMorph("jawOpen", amp * 0.65);
      setMorph("mouthOpen", amp * 0.45);
      setMorph("viseme_aa", amp * 0.6);
      // Sonrisa SOLO cuando hay amplitud real, escalada con la voz.
      // Asi en silencio los labios quedan en su posicion neutra.
      setMorph("mouthSmile", amp * 0.18);

      setMorph("eyeBlinkLeft", blink);
      setMorph("eyeBlinkRight", blink);

      const brow = browValueRef.current;
      setMorph("browInnerUp", brow);
      setMorph("browOuterUpLeft", brow * 0.6);
      setMorph("browOuterUpRight", brow * 0.6);
    }
  });

  // Trasladamos el avatar hacia abajo para que la cabeza quede ~origen.
  // Avatares Ready Player Me full-body tienen la cabeza ~1.55 m.
  return (
    <group position={[0, -1.55, 0]}>
      <primitive object={scene} />
    </group>
  );
}

function ModelFallback() {
  return (
    <mesh>
      <sphereGeometry args={[0.12, 32, 32]} />
      <meshStandardMaterial color="#7c3aed" wireframe />
    </mesh>
  );
}

export function TalkingHeadAvatar({
  audioRef,
  isSpeaking,
  modelUrl = DEFAULT_MODEL_URL,
}: TalkingHeadAvatarProps) {
  return (
    <div className="w-full h-full">
      <Canvas
        camera={{ position: [0, 0.05, 0.85], fov: 30 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[1.5, 2, 1.5]} intensity={1.1} />
        <directionalLight position={[-1.5, 1, 1]} intensity={0.4} color="#a78bfa" />
        <Suspense fallback={<ModelFallback />}>
          <AvatarModel url={modelUrl} audioRef={audioRef} isSpeaking={isSpeaking} />
          <Environment preset="studio" />
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload(DEFAULT_MODEL_URL);
