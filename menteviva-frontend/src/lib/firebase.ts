/**
 * Firebase web SDK init.
 *
 * Lee la config desde variables VITE_FIREBASE_* (ver .env.example).
 * Si alguna falta, exportamos `null` y los componentes que dependan de
 * Firebase deben mostrar un fallback (ver useFirebaseAuth).
 *
 * Setup: ver FIREBASE_SETUP.md en la raíz del repo.
 */

import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const requiredKeys: (keyof typeof config)[] = ["apiKey", "authDomain", "projectId", "appId"];
const missing = requiredKeys.filter((k) => !config[k]);

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;

if (missing.length === 0) {
  firebaseApp = initializeApp(config);
  firebaseAuth = getAuth(firebaseApp);
} else {
  console.warn(
    `[firebase] Configuración incompleta. Faltan: ${missing.join(", ")}. ` +
      `Auth deshabilitado. Ver FIREBASE_SETUP.md.`
  );
}

export { firebaseApp, firebaseAuth };

export function isFirebaseConfigured(): boolean {
  return firebaseAuth !== null;
}

export function requireAuth(): Auth {
  if (!firebaseAuth) {
    throw new Error(
      "Firebase no está configurado. Llena VITE_FIREBASE_* en .env. Ver FIREBASE_SETUP.md."
    );
  }
  return firebaseAuth;
}
