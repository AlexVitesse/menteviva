/**
 * Listener de Firebase auth state.
 *
 * Cuando Firebase reporta un usuario logueado, llama a /api/auth/sync para
 * traer el UserProfile (registro + diagnóstico) y lo mete al sessionStore.
 *
 * Cuando Firebase reporta logout, limpia el store.
 *
 * Si Firebase no está configurado, no hace nada (deja el store como esté).
 *
 * Montar UNA sola vez en la app (en App.tsx). El hook devuelve el estado del
 * intento inicial: { ready: true } cuando ya resolvió la primera vez.
 */

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { firebaseAuth } from "../lib/firebase";
import { ApiError, apiFetch } from "../lib/api";
import { useSessionStore } from "../stores/sessionStore";
import type { UserProfile } from "../types";

export interface FirebaseAuthStatus {
  ready: boolean;       // true cuando el listener ya emitió al menos una vez
  user: User | null;    // usuario Firebase actual (null si logout o sin config)
  needsRegistration: boolean;  // logueado en Firebase pero sin fila en SQLite
}

export function useFirebaseAuth(): FirebaseAuthStatus {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const setUserProfileFromAuth = useSessionStore((s) => s.setUserProfileFromAuth);
  const clearUserProfile = useSessionStore((s) => s.clearUserProfile);
  const setNeedsRegistration = useSessionStore((s) => s.setNeedsRegistration);
  const setAuthError = useSessionStore((s) => s.setAuthError);
  // El flag vive en el store (lo consumen App.tsx y Registro.tsx); lo leemos
  // tambien aqui para mantener el shape del retorno por compatibilidad.
  const needsRegistration = useSessionStore((s) => s.needsRegistration);

  useEffect(() => {
    if (!firebaseAuth) {
      // Sin config: marca ready para que la UI no se quede en loading.
      setReady(true);
      return;
    }
    const unsub = onAuthStateChanged(firebaseAuth, async (fbUser) => {
      setUser(fbUser);
      if (!fbUser) {
        clearUserProfile(); // limpia perfil + needsRegistration + authError
        setReady(true);
        return;
      }
      try {
        const profile = await apiFetch<UserProfile>("/api/auth/sync", {
          method: "POST",
        });
        setUserProfileFromAuth(profile); // limpia needsRegistration + authError
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // Logueado en Firebase pero falta la fila en la DB: hay que completar
          // el registro. App.tsx redirige a /registro al ver este flag.
          setNeedsRegistration(true);
          setAuthError(null);
        } else {
          // 401/500/503: no pudimos validar la sesion. Lo exponemos en vez de
          // mandar al landing en silencio (App.tsx muestra AuthErrorScreen).
          console.error("[useFirebaseAuth] /auth/sync falló:", err);
          setNeedsRegistration(false);
          setAuthError(
            "No pudimos validar tu sesión con el servidor. Reintenta en un momento; si persiste, avisa al equipo."
          );
        }
      } finally {
        setReady(true);
      }
    });
    return () => unsub();
  }, [setUserProfileFromAuth, clearUserProfile, setNeedsRegistration, setAuthError]);

  return { ready, user, needsRegistration };
}
