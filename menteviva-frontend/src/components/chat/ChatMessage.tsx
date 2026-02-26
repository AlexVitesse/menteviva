import { motion } from "framer-motion";
import type { Message } from "../../types";

interface Props {
  message: Message;
  avatarName?: string;
}

export function ChatMessage({ message, avatarName = "Asistente" }: Props) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className="flex flex-col max-w-[80%]">
        {/* Sender name */}
        <span
          className={`text-xs mb-1 ${
            isUser ? "text-right text-violet-lighter" : "text-left text-teal"
          }`}
        >
          {isUser ? "Tu" : avatarName}
        </span>

        {/* Message bubble */}
        <div
          className={`
            px-4 py-3 rounded-2xl
            ${isUser
              ? "bg-violet text-white rounded-br-sm"
              : "bg-deep text-cream rounded-bl-sm"
            }
          `}
        >
          <p className="text-sm leading-relaxed">{message.content}</p>
        </div>

        {/* Timestamp */}
        <span
          className={`text-xs text-subtle mt-1 ${
            isUser ? "text-right" : "text-left"
          }`}
        >
          {formatTime(message.timestamp)}
        </span>
      </div>
    </motion.div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
