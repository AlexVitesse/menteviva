import { useCallback, useRef } from "react";

// Generador de tonos usando Web Audio API (sin archivos externos)
function createTone(
  frequency: number,
  duration: number,
  type: OscillatorType = "sine",
  volume: number = 0.3
): () => void {
  return () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = frequency;
      oscillator.type = type;

      // Fade in/out para evitar clicks
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01);
      gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + duration);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + duration);
    } catch (e) {
      console.warn("Audio not supported:", e);
    }
  };
}

// Sonido de dos tonos (ding-dong)
function createDualTone(freq1: number, freq2: number, duration: number = 0.15): () => void {
  return () => {
    createTone(freq1, duration, "sine", 0.2)();
    setTimeout(() => createTone(freq2, duration, "sine", 0.2)(), duration * 1000);
  };
}

// Sonidos predefinidos
const SOUNDS = {
  // Conectado - tono ascendente amigable
  connected: createDualTone(440, 660, 0.12),

  // Desconectado - tono descendente
  disconnected: createDualTone(660, 440, 0.12),

  // Inicio de grabación - beep corto agudo
  recordStart: createTone(880, 0.08, "sine", 0.25),

  // Fin de grabación - beep doble
  recordStop: () => {
    createTone(660, 0.06, "sine", 0.2)();
    setTimeout(() => createTone(880, 0.08, "sine", 0.2)(), 80);
  },

  // Mensaje enviado - swoosh sutil
  messageSent: createTone(520, 0.1, "triangle", 0.15),

  // Respuesta recibida - notificación suave
  responseReceived: createDualTone(523, 659, 0.1),

  // Error - tono bajo
  error: createTone(220, 0.2, "sawtooth", 0.15),

  // Sesión terminada - acorde final
  sessionEnd: () => {
    createTone(523, 0.15, "sine", 0.2)(); // C
    setTimeout(() => createTone(659, 0.15, "sine", 0.2)(), 100); // E
    setTimeout(() => createTone(784, 0.25, "sine", 0.2)(), 200); // G
  },
};

export type SoundType = keyof typeof SOUNDS;

export function useSoundEffects() {
  const enabledRef = useRef(true);

  const play = useCallback((sound: SoundType) => {
    if (enabledRef.current && SOUNDS[sound]) {
      SOUNDS[sound]();
    }
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;
  }, []);

  return { play, setEnabled };
}
