import { motion } from "framer-motion";
import type { Message } from "../../types";

interface Props {
  messages: Message[];
  avatarName: string;
  maxHeight?: string;
}

export function ConversationReview({
  messages,
  avatarName,
  maxHeight = "max-h-64",
}: Props) {
  if (messages.length === 0) {
    return (
      <div className="card">
        <h3 className="font-syne font-bold mb-4">Resumen de conversacion</h3>
        <p className="text-muted text-sm">No hay mensajes para mostrar</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="font-syne font-bold mb-4">Resumen de conversacion</h3>
      <div className={`space-y-3 ${maxHeight} overflow-y-auto pr-2`}>
        {messages.map((msg, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, x: msg.role === "user" ? 20 : -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="text-sm"
          >
            <span
              className={
                msg.role === "user" ? "text-violet-light" : "text-teal"
              }
            >
              {msg.role === "user" ? "Tu: " : `${avatarName}: `}
            </span>
            <span className="text-muted">{msg.content}</span>
          </motion.div>
        ))}
      </div>

      {/* Export button (optional) */}
      <div className="mt-4 pt-4 border-t border-white/5">
        <button
          onClick={() => exportConversation(messages, avatarName)}
          className="text-sm text-violet hover:text-violet-light transition-colors"
        >
          Exportar conversacion
        </button>
      </div>
    </div>
  );
}

function exportConversation(messages: Message[], avatarName: string) {
  const text = messages
    .map((msg) => {
      const sender = msg.role === "user" ? "Tu" : avatarName;
      return `${sender}: ${msg.content}`;
    })
    .join("\n\n");

  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `conversacion-${avatarName.toLowerCase().replace(/\s+/g, "-")}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
