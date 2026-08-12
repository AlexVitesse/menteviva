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

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { firebaseAuth } from "../lib/firebase";
import { ApiError, apiFetch } from "../lib/api";
import { useSessionStore } from "../stores/sessionStore";
import type { UserProfile } from "../types";

export interface FirebaseAuthStatus {
  ready: boolean;       // true cuando el listener ya emitió al menos una vez
  status: "initializing" | "anonymous" | "syncing" | "authenticated" | "needs_registration" | "error";
  user: User | null;    // usuario Firebase actual (null si logout o sin config)
  needsRegistration: boolean;  // logueado en Firebase pero sin fila en SQLite
}

export function useFirebaseAuth(): FirebaseAuthStatus {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<FirebaseAuthStatus["status"]>("initializing");
  const [user, setUser] = useState<User | null>(null);
  const authGenerationRef = useRef(0);
  const syncAbortRef = useRef<AbortController | null>(null);
  const setUserProfileFromAuth = useSessionStore((s) => s.setUserProfileFromAuth);
  const clearUserProfile = useSessionStore((s) => s.clearUserProfile);
  const setNeedsRegistration = useSessionStore((s) => s.setNeedsRegistration);
  const setAuthError = useSessionStore((s) => s.setAuthError);
  // El flag vive en el store (lo consumen App.tsx y Registro.tsx); lo leemos
  // tambien aqui para mantener el shape del retorno por compatibilidad.
  const needsRegistration = useSessionStore((s) => s.needsRegistration);

  useEffect(() => {
    if (!firebaseAuth) {
      // Sin Firebase no existe identidad verificable: no confiar en el cache.
      clearUserProfile();
      setStatus("anonymous");
      setReady(true);
      return;
    }
    const unsub = onAuthStateChanged(firebaseAuth, async (fbUser) => {
      const generation = ++authGenerationRef.current;
      syncAbortRef.current?.abort();
      syncAbortRef.current = null;
      setUser(fbUser);
      if (!fbUser) {
        clearUserProfile(); // limpia perfil + needsRegistration + authError
        setStatus("anonymous");
        setReady(true);
        return;
      }
      const controller = new AbortController();
      syncAbortRef.current = controller;
      setStatus("syncing");
      try {
        const profile = await apiFetch<UserProfile>("/api/auth/sync", {
          method: "POST",
          signal: controller.signal,
        });
        if (
          generation !== authGenerationRef.current ||
          firebaseAuth?.currentUser?.uid !== fbUser.uid
        ) {
          return;
        }
        setUserProfileFromAuth(profile); // limpia needsRegistration + authError
        setStatus("authenticated");
      } catch (err) {
        if (controller.signal.aborted || generation !== authGenerationRef.current) {
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          // Logueado en Firebase pero falta la fila en la DB: hay que completar
          // el registro. App.tsx redirige a /registro al ver este flag.
          setNeedsRegistration(true);
          setAuthError(null);
          setStatus("needs_registration");
        } else {
          // 401/500/503: no pudimos validar la sesion. Lo exponemos en vez de
          // mandar al landing en silencio (App.tsx muestra AuthErrorScreen).
          console.error("[useFirebaseAuth] /auth/sync falló:", err);
          setNeedsRegistration(false);
          setAuthError(
            "No pudimos validar tu sesión con el servidor. Reintenta en un momento; si persiste, avisa al equipo."
          );
          setStatus("error");
        }
      } finally {
        if (generation === authGenerationRef.current) {
          syncAbortRef.current = null;
          setReady(true);
        }
      }
    });
    return () => {
      authGenerationRef.current += 1;
      syncAbortRef.current?.abort();
      syncAbortRef.current = null;
      unsub();
    };
  }, [setUserProfileFromAuth, clearUserProfile, setNeedsRegistration, setAuthError]);

  return { ready, status, user, needsRegistration };
}
