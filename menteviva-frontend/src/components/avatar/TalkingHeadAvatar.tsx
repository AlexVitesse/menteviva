import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, useFBX, Environment } from "@react-three/drei";
import * as THREE from "three";

export type AvatarGender = "feminine" | "masculine";

interface TalkingHeadAvatarProps {
  audioRef: RefObject<HTMLAudioElement | null>;
  isSpeaking: boolean;
  isActive?: boolean;
  modelUrl?: string;
  // Animacion idle oficial RPM. Por default usa feminine porque Sofia (avatar
  // del diagnostico) lo es. Para Roberto u otros masculinos pasar "masculine".
  gender?: AvatarGender;
}

const DEFAULT_MODEL_URL = "/avatars/sofia.glb";
// Animation library oficial de Ready Player Me. Los FBX traen el rig Mixamo
// con los mismos nombres de hueso (LeftArm, RightArm, Spine, ...) que el GLB
// de RPM, por lo que AnimationMixer puede aplicar los clips directamente sin
// retargeting manual. Bajados de github.com/readyplayerme/animation-library.
const IDLE_ANIM_URL: Record<AvatarGender, string> = {
  feminine: "/avatars/anims/F_Standing_Idle_001.fbx",
  masculine: "/avatars/anims/M_Standing_Idle_001.fbx",
};

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
  idleAnimUrl,
}: {
  url: string;
  audioRef: RefObject<HTMLAudioElement | null>;
  isSpeaking: boolean;
  idleAnimUrl: string;
}) {
  const { scene } = useGLTF(url);
  // FBX oficial de RPM con la animacion de breathing/idle. El mixer aplica
  // sus tracks (por nombre de hueso) directamente al scene del GLB.
  const idleFbx = useFBX(idleAnimUrl);
  const morphMeshesRef = useRef<THREE.SkinnedMesh[]>([]);
  const headBoneRef = useRef<THREE.Object3D | null>(null);
  const graphRef = useRef<AudioGraph | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  // Offset Y del grupo que contiene el avatar. Se calcula dinamicamente al
  // cargar el GLB sumando local positions desde Head hasta el scene root
  // (independiente de cualquier transform del group). Asi cada modelo se
  // encuadra igual sin importar la altura especifica de su rig.
  // Antes estaba hardcoded a -1.55, lo que recortaba los hombros de Sofia
  // (Head Y=1.562) vs Roberto (1.609) y Maria (1.677).
  // useState para que cambiar el valor dispare re-render del <group>.
  const [offsetY, setOffsetY] = useState(-1.55);

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
    let leftArm: THREE.Object3D | null = null;
    let rightArm: THREE.Object3D | null = null;
    let leftForeArm: THREE.Object3D | null = null;
    let rightForeArm: THREE.Object3D | null = null;
    scene.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        meshes.push(mesh);
      }
      // RPM/Wolf3D + samples de TalkingHead nombran al hueso "Head".
      if (!head && (obj.name === "Head" || obj.name === "head")) {
        head = obj;
      }
      // RPM exporta huesos con convencion Mixamo. Algunos GLBs incluyen el
      // prefijo "mixamorig" y otros no — soportamos ambos.
      const n = obj.name;
      if (!leftArm && (n === "LeftArm" || n === "mixamorigLeftArm")) leftArm = obj;
      if (!rightArm && (n === "RightArm" || n === "mixamorigRightArm")) rightArm = obj;
      if (!leftForeArm && (n === "LeftForeArm" || n === "mixamorigLeftForeArm")) leftForeArm = obj;
      if (!rightForeArm && (n === "RightForeArm" || n === "mixamorigRightForeArm")) rightForeArm = obj;
    });
    morphMeshesRef.current = meshes;
    headBoneRef.current = head;

    // Offset Y dinamico: sumamos las posiciones locales (Y) desde el hueso
    // Head subiendo por la jerarquia hasta el scene root. Esto da la altura
    // de la cabeza relativa al origen del modelo, independiente del transform
    // del <group> contenedor (asi evitamos el problema de leer matrixWorld
    // que aun no esta calculada o que incluye nuestra propia translacion).
    if (head) {
      let yAccum = (head as THREE.Object3D).position.y;
      let p: THREE.Object3D | null = (head as THREE.Object3D).parent;
      while (p && p !== scene) {
        yAccum += p.position.y;
        p = p.parent;
      }
      // Queremos que la cabeza quede en world Y = +0.05 (un pelin arriba del
      // centro del frame). offset = target - altura del head relativa al root.
      setOffsetY(0.05 - yAccum);
    }

    // (Eliminada la rotacion manual de hombros/codos. El AnimationMixer con
    // el clip oficial F/M_Standing_Idle_001.fbx pone los brazos en pose
    // natural respirando, sin hack de bones. Las variables leftArm/rightArm
    // se mantienen detectadas por si en el futuro queremos overrides
    // adicionales — son opcionales y no se usan ahora.)
    void leftArm; void rightArm; void leftForeArm; void rightForeArm;
  }, [scene]);

  // Inicializar AnimationMixer con el clip idle. Se recrea si cambia el
  // scene o el FBX. action.play() inicia el loop infinito por default.
  //
  // IMPORTANTE: el FBX de RPM viene en escala centimetros y trae tracks de
  // posicion (root motion en Hips) que en metros desplazan el avatar muy
  // lejos del frame. Filtramos los tracks .position para quedarnos solo con
  // las rotaciones — el resultado es la pose+breathing pero sin movimiento
  // de root. El avatar permanece en su sitio.
  useEffect(() => {
    if (!scene) return;
    const original = idleFbx?.animations?.[0];
    if (!original) return;
    const clip = original.clone();
    clip.tracks = clip.tracks.filter((t) => !t.name.endsWith(".position"));
    const mixer = new THREE.AnimationMixer(scene);
    const action = mixer.clipAction(clip);
    action.play();
    mixerRef.current = mixer;
    return () => {
      action.stop();
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      mixerRef.current = null;
    };
  }, [scene, idleFbx]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    graphRef.current = getAudioGraph(el);
    if (graphRef.current.ctx.state === "suspended") {
      graphRef.current.ctx.resume().catch(() => {});
    }
  }, [audioRef]);

  useFrame((_, delta) => {
    // ANIMATION MIXER PRIMERO. El idle anim escribe bones (rotaciones del
    // torso/brazos/cabeza/respiracion). Si lo aplicamos antes que el resto
    // del frame, podemos sobre-escribir cosas especificas (ej. boca) sin
    // que el mixer las pise.
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }

    const meshes = morphMeshesRef.current;
    if (meshes.length === 0) return;

    clockRef.current += delta;

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

    // (Head sway manual eliminado — el AnimationMixer con el idle clip
    // oficial ya entrega un sway natural de cabeza y torso por breathing.
    // Anadir nuestro sway encima causaba lerps que nunca convergian porque
    // el mixer sobre-escribia las rotaciones cada frame.)

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

  // Trasladamos el avatar hacia abajo para que la cabeza quede ~Y=+0.05
  // en el frame. El offset Y exacto se calcula en el useEffect arriba
  // basado en el world Y del hueso Head — asi cada modelo se encuadra
  // igual sin importar la altura especifica de su rig.
  return (
    <group position={[0, offsetY, 0]}>
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
  gender = "feminine",
}: TalkingHeadAvatarProps) {
  const idleAnimUrl = useMemo(() => IDLE_ANIM_URL[gender], [gender]);
  return (
    <div className="w-full h-full">
      <Canvas
        // Encuadre cara+hombros estilo videollamada. Con el idle anim oficial
        // los brazos ya estan a los costados, asi que la camara puede ser
        // ligeramente mas amplia sin mostrar T-pose. Probado: 0.85/24 OK
        // para Sofia/Roberto/Maria con el offset Y dinamico.
        camera={{ position: [0, 0.12, 0.85], fov: 24 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[1.5, 2, 1.5]} intensity={1.1} />
        <directionalLight position={[-1.5, 1, 1]} intensity={0.4} color="#a78bfa" />
        <Suspense fallback={<ModelFallback />}>
          <AvatarModel
            url={modelUrl}
            audioRef={audioRef}
            isSpeaking={isSpeaking}
            idleAnimUrl={idleAnimUrl}
          />
          <Environment preset="studio" />
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload(DEFAULT_MODEL_URL);
// Preload del idle feminine (el default — Sofia). El masculine se carga lazy
// solo cuando se elige un avatar masculino.
useFBX.preload(IDLE_ANIM_URL.feminine);
