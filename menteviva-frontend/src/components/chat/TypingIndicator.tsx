import { motion } from "framer-motion";

interface Props {
  name?: string;
}

export function TypingIndicator({ name = "Escribiendo" }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-center gap-2"
    >
      <div className="bg-deep px-4 py-3 rounded-2xl rounded-bl-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted text-sm">{name}</span>
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                animate={{
                  y: [0, -4, 0],
                  opacity: [0.5, 1, 0.5],
                }}
                transition={{
                  duration: 0.6,
                  repeat: Infinity,
                  delay: i * 0.15,
                }}
                className="w-2 h-2 bg-violet rounded-full"
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
