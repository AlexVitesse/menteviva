import { motion } from "framer-motion";

interface Props {
  isActive: boolean;
  barCount?: number;
  className?: string;
}

export function AudioVisualizer({ isActive, barCount = 5, className = "" }: Props) {
  return (
    <div className={`flex items-center justify-center gap-1 ${className}`}>
      {Array.from({ length: barCount }).map((_, i) => (
        <motion.div
          key={i}
          animate={{
            height: isActive
              ? [8, 24, 16, 32, 12, 8]
              : 8,
          }}
          transition={{
            duration: 0.5,
            repeat: isActive ? Infinity : 0,
            delay: i * 0.1,
          }}
          className="w-1 bg-violet rounded-full"
          style={{ minHeight: 8 }}
        />
      ))}
    </div>
  );
}
