import type { RefObject } from "react";
import { Loader2 } from "lucide-react";

/**
 * Capa visual del avatar Simli: el <video> y <audio> que simli-client llena
 * con el stream WebRTC (cara fotorrealista + voz lip-synced). La logica de
 * conexion vive en useSimliAvatar — este componente solo monta los elementos
 * (los refs DEBEN estar en el DOM antes de llamar connect()).
 */
interface SimliAvatarProps {
  videoRef: RefObject<HTMLVideoElement>;
  audioRef: RefObject<HTMLAudioElement>;
  connected: boolean;
}

export function SimliAvatar({ videoRef, audioRef, connected }: SimliAvatarProps) {
  return (
    <div className="relative w-full h-full">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
      <audio ref={audioRef} autoPlay />
      {!connected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#2a2a3a] to-[#1a1a2e]">
          <Loader2 className="w-8 h-8 text-violet-light animate-spin" />
          <p className="text-white/60 text-sm">Conectando video del avatar...</p>
        </div>
      )}
    </div>
  );
}
