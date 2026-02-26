import { motion } from "framer-motion";

interface Props {
  label: string;
  value: number;
  maxValue?: number;
  color?: "violet" | "teal" | "success" | "warning" | "danger";
  showPercentage?: boolean;
  delay?: number;
}

const colorClasses = {
  violet: "bg-violet",
  teal: "bg-teal",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function MetricBar({
  label,
  value,
  maxValue = 100,
  color = "violet",
  showPercentage = true,
  delay = 0,
}: Props) {
  const percentage = Math.min((value / maxValue) * 100, 100);

  return (
    <div className="space-y-2">
      {/* Label and value */}
      <div className="flex justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="text-cream font-medium">
          {showPercentage ? `${Math.round(percentage)}%` : value}
        </span>
      </div>

      {/* Bar background */}
      <div className="h-2 bg-deep rounded-full overflow-hidden">
        {/* Animated fill */}
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 1, ease: "easeOut", delay }}
          className={`h-full rounded-full ${colorClasses[color]}`}
        />
      </div>
    </div>
  );
}
