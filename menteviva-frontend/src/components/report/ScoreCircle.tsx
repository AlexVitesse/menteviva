import { motion } from "framer-motion";

interface Props {
  score: number;
  size?: "md" | "lg" | "xl";
  className?: string;
}

const sizeConfig = {
  md: { container: "w-32 h-32", fontSize: "text-3xl", strokeWidth: 8 },
  lg: { container: "w-48 h-48", fontSize: "text-5xl", strokeWidth: 10 },
  xl: { container: "w-64 h-64", fontSize: "text-7xl", strokeWidth: 12 },
};

export function ScoreCircle({ score, size = "lg", className = "" }: Props) {
  const config = sizeConfig[size];

  function getScoreColor(score: number): string {
    if (score >= 75) return "#16A34A"; // success
    if (score >= 50) return "#F97316"; // warning
    return "#DC2626"; // danger
  }

  function getScoreLabel(score: number): string {
    if (score >= 85) return "Excelente";
    if (score >= 75) return "Muy bien";
    if (score >= 60) return "Bien";
    if (score >= 50) return "Regular";
    return "Necesita practica";
  }

  const color = getScoreColor(score);
  const circumference = 2 * Math.PI * 45; // radius of 45
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div className={`${config.container} relative`}>
        {/* Background circle */}
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx="50%"
            cy="50%"
            r="45%"
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={config.strokeWidth}
          />
          {/* Animated progress circle */}
          <motion.circle
            cx="50%"
            cy="50%"
            r="45%"
            fill="none"
            stroke={color}
            strokeWidth={config.strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1.5, ease: "easeOut" }}
          />
        </svg>

        {/* Score text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.span
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 }}
            className={`font-syne font-bold ${config.fontSize}`}
            style={{ color }}
          >
            {score}
          </motion.span>
        </div>
      </div>

      {/* Label */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="text-lg mt-4"
        style={{ color }}
      >
        {getScoreLabel(score)}
      </motion.p>
    </div>
  );
}
