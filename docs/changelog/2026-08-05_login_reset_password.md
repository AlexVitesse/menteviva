# 2026-08-05 — Recuperación de contraseña en el login

## Contexto

Revisando la plataforma principal salió que el login (Firebase Auth con
email+password) no tenía ninguna salida si alguien olvidaba su contraseña: el
único TODO al respecto vivía en `docs/FIREBASE_SETUP.md`. Con el piloto ya en
manos de los compañeros (Cris, Brandon, Areli), un olvido dejaba al usuario
fuera sin más opción que pedirle al equipo técnico resetearlo a mano en Console.

## Qué se hizo

`menteviva-frontend/src/pages/Login.tsx`:

- Link **"¿Olvidaste tu contraseña?"** debajo del campo de contraseña →
  `sendPasswordResetEmail(firebaseAuth, email)`. Firebase manda el correo y
  hostea la página donde se define la nueva contraseña: cero backend, cero
  tabla de tokens, cero dependencia nueva (ya estaba `firebase@^12`).
- Estado `notice` + caja teal (`MailCheck`) para el mensaje de éxito, separado
  de la caja ámbar de error que ya existía.
- `auth/user-not-found` se responde con el **mismo** mensaje que el caso
  exitoso ("si ese email tiene cuenta…") para no revelar qué correos están
  registrados. Es la misma postura que Firebase con *email enumeration
  protection*.
- `translateFirebaseError(err, accion)` ahora recibe la acción, para que el
  fallback no diga "no pudimos iniciar sesión" cuando el fallo fue al enviar el
  enlace. Los códigos que ya traducía (`invalid-email`, `too-many-requests`,
  `network-request-failed`) son justo los del reset.

`docs/FIREBASE_SETUP.md`: el punto de "lo que NO hace este setup" queda tachado
con la nota de que la plantilla *Password reset* debe estar habilitada en
Console → Authentication → Templates (está por defecto).

## Verificación

`npm run build` (tsc + vite) pasa. No hay test runner en el frontend.

Pendiente de prueba manual: pedir el reset con un email real del piloto y
confirmar que el correo llega (revisar spam — el remitente es el dominio
`*.firebaseapp.com`, no un dominio propio).

## Lo que NO se hizo

- Página de reset propia / branding del correo: la acción por defecto de
  Firebase alcanza. Se agrega un *custom action URL* solo si el correo genérico
  molesta en la demo.
- Verificación de email al registrarse: sigue sin exigirse (mismo doc).
- Rate limit propio: Firebase ya devuelve `auth/too-many-requests`.
