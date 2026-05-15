import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart3, Edit3, LogOut } from "lucide-react";
import { onAuthStateChanged, signOut } from "firebase/auth";

import { firebaseAuth } from "../../lib/firebase";
import { useSessionStore } from "../../stores/sessionStore";

/**
 * Avatar circular del usuario (inicial del nombre) que despliega un menu
 * con datos de cuenta, links a /mi-plan y /registro, y boton de cerrar sesion.
 *
 * Diseño alineado al navbar del landing (rounded glass card + violet accents).
 * Sin foto subida por usuario por ahora — solo inicial sobre gradient.
 */
export function UserMenu() {
  const navigate = useNavigate();
  const { userProfile, clearUserProfile } = useSessionStore();
  const [open, setOpen] = useState(false);
  const [photoURL, setPhotoURL] = useState<string | null>(
    firebaseAuth?.currentUser?.photoURL ?? null
  );
  const [photoErrored, setPhotoErrored] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Capturar la foto de perfil de Firebase (Google la entrega en photoURL).
  // Suscribimos por si el componente se monta antes que el listener global y
  // currentUser aun no estaba poblado.
  useEffect(() => {
    if (!firebaseAuth) return;
    const unsub = onAuthStateChanged(firebaseAuth, (u) => {
      setPhotoURL(u?.photoURL ?? null);
      setPhotoErrored(false);
    });
    return () => unsub();
  }, []);

  // Cerrar al click fuera
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Cerrar al apretar Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!userProfile?.registro) return null;

  const nombre = userProfile.registro.nombre;
  const email = userProfile.registro.email;
  const initials = getInitials(nombre);

  async function handleLogout() {
    setOpen(false);
    try {
      if (firebaseAuth) await signOut(firebaseAuth);
    } catch (err) {
      console.error("[UserMenu] signOut fallo:", err);
    }
    // El listener de useFirebaseAuth limpiara el store, pero limpiamos
    // explicitamente por si la session estaba solo en localStorage.
    clearUserProfile();
    navigate("/login", { replace: true });
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Menú de usuario"
        aria-expanded={open}
        className="flex items-center gap-2 group"
      >
        {photoURL && !photoErrored ? (
          <img
            src={photoURL}
            alt={nombre}
            referrerPolicy="no-referrer"
            onError={() => setPhotoErrored(true)}
            className="w-9 h-9 rounded-full object-cover border border-white/20 group-hover:border-white/40 transition-colors"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-light to-teal flex items-center justify-center text-cream font-syne font-bold text-sm border border-white/20 group-hover:border-white/40 transition-colors">
            {initials}
          </div>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-72 rounded-2xl border border-white/10 bg-deep/95 backdrop-blur-xl shadow-xl overflow-hidden z-50"
          >
            {/* Cabecera con avatar + datos */}
            <div className="px-4 py-4 border-b border-white/10 flex items-center gap-3">
              {photoURL && !photoErrored ? (
                <img
                  src={photoURL}
                  alt={nombre}
                  referrerPolicy="no-referrer"
                  onError={() => setPhotoErrored(true)}
                  className="w-12 h-12 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-light to-teal flex items-center justify-center text-cream font-syne font-bold text-base shrink-0">
                  {initials}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-syne font-bold text-sm text-cream truncate">
                  {nombre}
                </p>
                {email && (
                  <p className="text-xs text-muted truncate">{email}</p>
                )}
                <p className="text-[10px] text-subtle mt-0.5 capitalize">
                  {userProfile.registro.rol_objetivo} · {userProfile.registro.industria}
                </p>
              </div>
            </div>

            {/* Acciones */}
            <div className="py-1">
              <MenuItem
                icon={BarChart3}
                label="Mi plan"
                onClick={() => {
                  setOpen(false);
                  navigate("/mi-plan");
                }}
              />
              <MenuItem
                icon={Edit3}
                label="Editar registro"
                onClick={() => {
                  setOpen(false);
                  navigate("/registro");
                }}
              />
            </div>

            {/* Logout separado */}
            <div className="border-t border-white/10 py-1">
              <MenuItem
                icon={LogOut}
                label="Cerrar sesión"
                onClick={handleLogout}
                danger
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger = false,
}: {
  icon: typeof BarChart3;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
        danger
          ? "text-danger hover:bg-danger/10"
          : "text-cream hover:bg-white/5"
      }`}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
