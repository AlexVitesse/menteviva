import { useState } from "react";
import { VoiceButton } from "./VoiceButton";
import { AudioVisualizer } from "./AudioVisualizer";
import { useAudioRecorder } from "../../hooks/useAudioRecorder";
import type { ConnectionStatus } from "../../types";

interface Props {
  status: ConnectionStatus;
  onAudioReady: (audioBase64: string) => void;
}

export function VoiceRecorder({ status, onAudioReady }: Props) {
  const { isRecording, startRecording, stopRecording } = useAudioRecorder();
  const [isProcessing, setIsProcessing] = useState(false);

  const isDisabled = status !== "ready" || isProcessing;

  async function handleMouseDown() {
    if (isDisabled) return;
    startRecording();
  }

  async function handleMouseUp() {
    if (!isRecording) return;

    setIsProcessing(true);
    try {
      const audioBase64 = await stopRecording();
      if (audioBase64) {
        onAudioReady(audioBase64);
      }
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Audio visualizer */}
      <AudioVisualizer isActive={isRecording} />

      {/* Voice button */}
      <VoiceButton
        isRecording={isRecording}
        isDisabled={isDisabled}
        isLoading={isProcessing}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      />

      {/* Instructions */}
      <p className="text-center text-muted text-sm">
        {isProcessing
          ? "Procesando audio..."
          : isRecording
          ? "Suelta para enviar"
          : status === "ready"
          ? "Manten presionado para hablar"
          : "Esperando conexion..."}
      </p>
    </div>
  );
}
