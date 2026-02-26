import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Message } from "../../types";

interface Props {
  messages: Message[];
  className?: string;
}

export function ChatBox({ messages, className = "" }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      className={`card overflow-y-auto space-y-4 ${className}`}
    >
      {messages.length === 0 ? (
        <p className="text-muted text-center py-8">
          Presiona el microfono para comenzar la conversacion
        </p>
      ) : (
        <AnimatePresence mode="popLayout">
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`flex ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`
                  max-w-[80%] px-4 py-3 rounded-2xl
                  ${message.role === "user"
                    ? "bg-violet text-white rounded-br-sm"
                    : "bg-deep text-cream rounded-bl-sm"
                  }
                `}
              >
                <p className="text-sm">{message.content}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}
