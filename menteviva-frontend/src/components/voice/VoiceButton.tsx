import { motion } from "framer-motion";
import { Mic, MicOff, Loader2 } from "lucide-react";

interface Props {
  isRecording: boolean;
  isDisabled: boolean;
  isLoading?: boolean;
  onMouseDown: () => void;
  onMouseUp: () => void;
  size?: "md" | "lg";
}

const sizeClasses = {
  md: "w-16 h-16",
  lg: "w-20 h-20",
};

const iconSizes = {
  md: "w-6 h-6",
  lg: "w-8 h-8",
};

export function VoiceButton({
  isRecording,
  isDisabled,
  isLoading = false,
  onMouseDown,
  onMouseUp,
  size = "lg",
}: Props) {
  return (
    <motion.button
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onTouchStart={onMouseDown}
      onTouchEnd={onMouseUp}
      whileHover={{ scale: isDisabled ? 1 : 1.05 }}
      whileTap={{ scale: isDisabled ? 1 : 0.95 }}
      disabled={isDisabled}
      className={`
        ${sizeClasses[size]} rounded-full flex items-center justify-center
        transition-all duration-200 relative
        ${isRecording
          ? "bg-danger shadow-lg shadow-danger/30"
          : "bg-violet shadow-lg shadow-violet/30"}
        ${isDisabled && "opacity-50 cursor-not-allowed"}
      `}
    >
      {/* Pulse animation when recording */}
      {isRecording && (
        <motion.div
          initial={{ scale: 1, opacity: 0.5 }}
          animate={{ scale: 1.5, opacity: 0 }}
          transition={{ repeat: Infinity, duration: 1 }}
          className="absolute inset-0 rounded-full bg-danger"
        />
      )}

      {/* Icon */}
      {isLoading ? (
        <Loader2 className={`${iconSizes[size]} text-white animate-spin`} />
      ) : isRecording ? (
        <MicOff className={`${iconSizes[size]} text-white`} />
      ) : (
        <Mic className={`${iconSizes[size]} text-white`} />
      )}
    </motion.button>
  );
}
