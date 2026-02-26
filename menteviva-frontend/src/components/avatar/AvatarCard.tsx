import { motion } from "framer-motion";
import { Check } from "lucide-react";
import type { Avatar } from "../../types";
import { AnimatedAvatar, AvatarCharacter } from "./AnimatedAvatar";

interface Props {
  avatar: Avatar;
  isSelected: boolean;
  onClick: () => void;
}

export function AvatarCard({ avatar, isSelected, onClick }: Props) {
  // Mapear el ID del avatar al character del AnimatedAvatar
  const avatarCharacter: AvatarCharacter =
    avatar.id === "roberto" ? "roberto" :
    avatar.id === "maria" ? "maria" :
    "roberto"; // fallback

  return (
    <motion.div
      onClick={onClick}
      whileHover={{ scale: 1.03, y: -4 }}
      whileTap={{ scale: 0.98 }}
      className={`
        relative overflow-hidden cursor-pointer
        bg-card rounded-2xl p-6 border-2 transition-all duration-300
        ${isSelected
          ? "border-violet shadow-lg shadow-violet/20"
          : "border-white/5 hover:border-white/20"}
      `}
    >
      {/* Selected indicator */}
      {isSelected && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute top-4 right-4 w-8 h-8 bg-violet rounded-full
                     flex items-center justify-center z-10"
        >
          <Check className="w-5 h-5 text-white" />
        </motion.div>
      )}

      {/* Avatar animado con animación de respiración */}
      <motion.div
        animate={{
          scale: [1, 1.02, 1],
        }}
        transition={{
          repeat: Infinity,
          duration: 4,
          ease: "easeInOut"
        }}
        className="relative w-36 h-36 mx-auto mb-5"
      >
        {/* Glow background */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-violet/30 to-teal/30 blur-xl" />

        {/* Avatar container */}
        <div
          className="relative w-full h-full rounded-full overflow-hidden border-4 border-white/10"
          style={{
            background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          }}
        >
          <AnimatedAvatar
            character={avatarCharacter}
            isActive={false}
            size={136}
          />
        </div>

        {/* Breathing ring animation */}
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.5, 0.2, 0.5]
          }}
          transition={{ repeat: Infinity, duration: 3 }}
          className="absolute inset-0 rounded-full border-2 border-violet/30"
        />
      </motion.div>

      {/* Info */}
      <h3 className="font-syne text-lg font-bold text-center text-cream mb-1">
        {avatar.name}
      </h3>
      <p className="text-sm text-teal text-center mb-2">{avatar.role}</p>
      <p className="text-xs text-muted text-center mb-4">{avatar.company}</p>

      {/* Personality tag */}
      <div className="flex justify-center">
        <span className="text-xs px-4 py-1.5 rounded-full bg-violet/10
                         border border-violet/20 text-violet-lighter">
          {avatar.personality}
        </span>
      </div>
    </motion.div>
  );
}
