# Firebase Auth — setup para Mente Viva

Esta guía explica los pasos en Firebase Console para activar la autenticación
en el piloto. Tiempo estimado: 10 minutos.

---

## 1. Crear el proyecto

1. Entra a https://console.firebase.google.com con tu cuenta de Google.
2. Click en **Add project** → nombre sugerido: `menteviva-pilot` (o el que prefieras).
3. **Google Analytics**: puedes desactivarlo para el piloto (no aporta nada todavía).
4. Espera a que termine de crear el proyecto.

---

## 2. Habilitar Email/Password Auth

1. Menú lateral → **Build → Authentication**.
2. Click **Get started**.
3. Tab **Sign-in method**.
4. En la lista de proveedores, click **Email/Password**.
5. Activa el toggle de **Email/Password** (deja **Email link** desactivado para el piloto).
6. **Save**.

---

## 3. Configuración del frontend (Web SDK)

1. Menú lateral → ⚙️ → **Project settings**.
2. Tab **General** → baja a **Your apps**.
3. Click el ícono `</>`  (Web app) → registra una app:
   - Nickname: `menteviva-web`
   - **NO** marques "Firebase Hosting".
   - Click **Register app**.
4. Vas a ver un objeto `firebaseConfig`:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "menteviva-pilot.firebaseapp.com",
     projectId: "menteviva-pilot",
     storageBucket: "menteviva-pilot.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123",
   };
   ```

5. Copia esos valores a `menteviva-frontend/.env`:

   ```env
   VITE_FIREBASE_API_KEY=AIzaSy...
   VITE_FIREBASE_AUTH_DOMAIN=menteviva-pilot.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=menteviva-pilot
   VITE_FIREBASE_STORAGE_BUCKET=menteviva-pilot.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
   VITE_FIREBASE_APP_ID=1:1234567890:web:abc123
   ```

> El `apiKey` aquí **no es secreto** — está pensado para vivir en el frontend
> (como tu Google Maps API key). Lo que protege Firebase son las reglas de
> auth y los Authorized Domains, no esa key.

---

## 4. Configuración del backend (Admin SDK)

El backend verifica los tokens contra los certs públicos de Google. Necesita
un **service account JSON** con permisos administrativos.

1. ⚙️ → **Project settings** → tab **Service accounts**.
2. Click **Generate new private key** → confirma → descarga el JSON.
3. **Importante**: este archivo SÍ es secreto (contiene una private key).
   Guárdalo **fuera del repo** o en `menteviva-backend/secrets/firebase-admin.json`
   y verifica que `secrets/` esté en `.gitignore`.
4. Configura `menteviva-backend/.env`. Dos opciones:

   **Opción A — ruta al archivo (recomendado en local):**
   ```env
   FIREBASE_SERVICE_ACCOUNT_PATH=secrets/firebase-admin.json
   ```

   **Opción B — JSON inline (recomendado en Render/hosts):**
   ```env
   FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"menteviva-pilot",...}
   ```
   (todo en una sola línea, con las comillas escapadas si tu shell lo necesita).

5. Reinicia el backend. Deberías ver en logs:
   ```
   [firebase_auth] Firebase Admin SDK inicializado
   ```

---

## 5. Authorized domains (para deploy)

Por defecto Firebase solo deja al frontend autenticarse desde `localhost`. Cuando
despliegues en Vercel:

1. Authentication → **Settings** → tab **Authorized domains**.
2. **Add domain** → agrega tu dominio (`menteviva.vercel.app` o el que tengas).

---

## 6. Verificación end-to-end

1. Backend corriendo: `poetry run uvicorn app.main:app --reload --port 8000`
2. Frontend corriendo: `npm run dev` → abre `http://localhost:5173`
3. Flujo:
   - `/login` → click "Crear cuenta nueva".
   - Llena nombre, email, contraseña, rol, industria, nivel.
   - Submit → debe ir a `/diagnostico/setup`.
   - En Firebase Console → Authentication → tab **Users** verás el email creado.
   - Refresca la página: debe mantenerte logueado (Firebase persiste sesión).
   - Logout → desde DevTools console: `firebaseAuth.signOut()` (botón próximo).

---

## 7. Lo que NO hace este setup (post-piloto)

- **Reset de password**: el código no expone "olvidé mi contraseña" todavía.
  Firebase tiene `sendPasswordResetEmail`; agregarlo cuando haya feedback.
- **Email verification**: no exigimos verificar email para entrar. Después
  agregamos el flag `email_verified` como requisito.
- **OAuth (Google/Apple/Microsoft)**: solo email+password. Activar otros
  providers es trivial desde Console + un botón en `Login.tsx`.
- **Multi-factor auth**: no para piloto.
- **Migración a Postgres + RLS**: SQLite hoy. La estructura de la DB ya está
  preparada para migrar (ver comentarios en `app/db.py`); cuando convenga,
  un script `pg_dump`-equivalente + Alembic baseline.

---

## Troubleshooting

- **`Firebase no está configurado` en Login**: faltan `VITE_FIREBASE_*` en
  el `.env` del frontend. Reinicia `npm run dev` después de editar `.env`.
- **`auth/operation-not-allowed`**: Email/Password no está habilitado en
  Authentication → Sign-in method.
- **Backend log: `Firebase Auth no disponible`**: revisa que
  `FIREBASE_SERVICE_ACCOUNT_PATH` apunte al JSON correcto, y que el path sea
  relativo al working directory del backend (típicamente `menteviva-backend/`).
- **`/auth/sync` devuelve 404 después de login**: el usuario hizo signup en
  Firebase pero no completó el formulario de registro. Mándalo a `/registro`
  para crear la fila en SQLite.
