import { useEffect, useRef, type RefObject } from "react";
import { Loader2 } from "lucide-react";

/**
 * Capa visual del avatar Simli: el <video> y <audio> que simli-client llena
 * con el stream WebRTC (cara fotorrealista + voz lip-synced). La logica de
 * conexion vive en useSimliAvatar — este componente solo monta los elementos
 * (los refs DEBEN estar en el DOM antes de llamar connect()).
 *
 * Render: Simli entrega 512x512. Antes usabamos `object-cover` sobre todo el
 * panel (~2x mas grande) -> upscaling + crop = imagen borrosa. Ahora el video
 * se muestra a su aspecto NATIVO (cuadrado, centrado, object-contain) y el
 * panel se rellena con el MISMO stream desenfocado de fondo (estilo TV), asi
 * la cara queda lo mas nitida posible sin deformar ni recortar.
 */
interface SimliAvatarProps {
  videoRef: RefObject<HTMLVideoElement>;
  audioRef: RefObject<HTMLAudioElement>;
  connected: boolean;
}

export function SimliAvatar({ videoRef, audioRef, connected }: SimliAvatarProps) {
  const bgVideoRef = useRef<HTMLVideoElement>(null);

  // El fondo blur reusa el MISMO MediaStream del video principal (cero costo
  // extra de red/decodificacion significativo). Se engancha cuando Simli ya
  // conecto (srcObject asignado por simli-client).
  useEffect(() => {
    if (!connected) return;
    const main = videoRef.current;
    const bg = bgVideoRef.current;
    if (main && bg && main.srcObject && bg.srcObject !== main.srcObject) {
      bg.srcObject = main.srcObject;
      bg.play().catch(() => {});
    }
  }, [connected, videoRef]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Fondo: mismo stream, desenfocado y ampliado para llenar el panel */}
      <video
        ref={bgVideoRef}
        autoPlay
        playsInline
        muted
        aria-hidden
        className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-50"
      />
      {/* Video principal: aspecto nativo 1:1, sin crop, centrado */}
      <div className="absolute inset-0 flex items-center justify-center">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full max-w-full aspect-square object-contain"
        />
      </div>
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
