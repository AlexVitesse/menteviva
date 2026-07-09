import { useEffect, useRef } from "react";

interface Props {
  analyser: AnalyserNode | null;
  active: boolean;
  barCount?: number;
  className?: string;
}

/**
 * Medidor de nivel de voz REAL (a diferencia de AudioVisualizer, que es una
 * animacion decorativa). Lee el AnalyserNode del mic y dibuja barras segun el
 * RMS actual. Actualiza estilos por DOM directo via rAF — cero re-renders.
 */
export function MicLevelMeter({ analyser, active, barCount = 7, className = "" }: Props) {
  const barsRef = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const resetBars = () => {
      barsRef.current.forEach((bar) => {
        if (bar) bar.style.height = "4px";
      });
    };

    if (!analyser || !active) {
      resetBars();
      return;
    }

    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      // Ganancia visual: la voz normal ronda rms ~0.05-0.2
      const level = Math.min(1, rms * 5);

      const mid = (barCount - 1) / 2;
      barsRef.current.forEach((bar, i) => {
        if (!bar) return;
        // Perfil de "onda": barras centrales mas altas que las laterales
        const falloff = 1 - Math.abs(i - mid) / (barCount * 0.85);
        const h = 4 + level * falloff * 20;
        bar.style.height = `${h}px`;
      });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      resetBars();
    };
  }, [analyser, active, barCount]);

  return (
    <div className={`flex items-center gap-[3px] h-6 ${className}`} aria-hidden="true">
      {Array.from({ length: barCount }).map((_, i) => (
        <div
          key={i}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
          className="w-[3px] rounded-full bg-current transition-[height] duration-75"
          style={{ height: 4 }}
        />
      ))}
    </div>
  );
}
