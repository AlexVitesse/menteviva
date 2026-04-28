import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, Check, Share2 } from "lucide-react";
import type { UserProfile } from "../../types";
import { diagnosticoToShareText } from "../../utils/exportDiagnostico";

interface ShareDiagnosticoModalProps {
  open: boolean;
  onClose: () => void;
  profile: UserProfile;
  siteUrl: string;
}

type Network = {
  id: string;
  name: string;
  bgClass: string;
  // Nota: LinkedIn ignora cualquier "text" custom y solo lee la URL via OG tags.
  buildUrl: (text: string, url: string) => string;
};

const NETWORKS: Network[] = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    bgClass: "bg-[#25D366] hover:bg-[#1ea654]",
    buildUrl: (text, url) =>
      `https://wa.me/?text=${encodeURIComponent(`${text}\n\n${url}`)}`,
  },
  {
    id: "x",
    name: "X",
    bgClass: "bg-black hover:bg-zinc-800 border border-white/20",
    buildUrl: (text, url) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
  },
  {
    id: "facebook",
    name: "Facebook",
    bgClass: "bg-[#1877F2] hover:bg-[#0d6ae0]",
    buildUrl: (text, url) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text)}`,
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    bgClass: "bg-[#0A66C2] hover:bg-[#0850a0]",
    buildUrl: (_text, url) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
];

export function ShareDiagnosticoModal({
  open,
  onClose,
  profile,
  siteUrl,
}: ShareDiagnosticoModalProps) {
  const [copied, setCopied] = useState(false);
  const [nativeShared, setNativeShared] = useState(false);
  const text = diagnosticoToShareText(profile);
  const fullText = `${text}\n\n${siteUrl}`;
  const hasNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  function handleNetworkShare(network: Network) {
    const shareUrl = network.buildUrl(text, siteUrl);
    window.open(
      shareUrl,
      "_blank",
      "noopener,noreferrer,width=600,height=600"
    );
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  async function handleNative() {
    try {
      await navigator.share({
        title: "Mi diagnostico de habilidades blandas",
        text,
        url: siteUrl,
      });
      setNativeShared(true);
      window.setTimeout(() => setNativeShared(false), 2000);
    } catch {
      // user canceled / not supported
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-ink/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-card rounded-2xl border border-violet/30 p-6 relative"
          >
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="absolute top-3 right-3 text-muted hover:text-cream transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="font-syne text-xl font-bold mb-1">
              Compartir diagnostico
            </h3>
            <p className="text-sm text-muted mb-4">
              Elige donde quieres compartir tu resultado.
            </p>

            <div className="bg-deep/40 rounded-lg p-3 mb-4 text-xs sm:text-sm text-cream/90 whitespace-pre-line border border-white/10 max-h-40 overflow-y-auto">
              {fullText}
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              {NETWORKS.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleNetworkShare(n)}
                  className={`${n.bgClass} text-white font-medium py-3 rounded-lg transition-colors text-sm`}
                >
                  {n.name}
                </button>
              ))}
            </div>

            <button
              onClick={handleCopy}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-white/15 text-cream hover:border-white/30 transition-colors text-sm mb-2"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-teal" /> Copiado
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" /> Copiar texto
                </>
              )}
            </button>

            {hasNativeShare && (
              <button
                onClick={handleNative}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-white/15 text-cream hover:border-white/30 transition-colors text-sm"
              >
                {nativeShared ? (
                  <>
                    <Check className="w-4 h-4 text-teal" /> Compartido
                  </>
                ) : (
                  <>
                    <Share2 className="w-4 h-4" /> Mas opciones del dispositivo
                  </>
                )}
              </button>
            )}

            <p className="text-[10px] text-muted/70 text-center mt-4">
              LinkedIn solo lee la URL; el texto custom no se preserva en su flow.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
