# Checklist de QA Manual — VoiceLab

Este documento contiene la guía de verificación paso a paso para el control de calidad del **VoiceLab** (ChatLab conducido por voz con Gemini Live, sin video/avatar Simli).

---

## 1. Requisitos Previos y Entorno

### A. Origen Seguro (Secure Origin)
El navegador web requiere un **origen seguro** para habilitar la API de captura de micrófono (`getUserMedia`):
- **Local:** `http://localhost:5173` o `http://127.0.0.1:5173`.
- **Remoto/Móvil:** Debe ser **HTTPS**. Si se está probando en un dispositivo móvil conectado al servidor local, se debe crear un túnel seguro:
  - `cloudflared tunnel --url http://localhost:5173` (o ngrok equivalente).
  - Configurar en `.env` el origen de `cors_origins` para incluir la URL del túnel.

### B. Límites de Cuota de Gemini Live (Free Tier)
- **Límite:** 20 solicitudes/día por API key por modelo.
- **Rotación:** El backend implementa rotación round-robin si se configuran `GEMINI_API_KEY`, `GEMINI_API_KEY2`, etc.
- **Nota de QA:** Si recibes un error `429 (Resource Exhausted)`, verifica las cuotas en Google AI Studio o añade una nueva key de respaldo en `.env`.

---

## 2. Guía de Pruebas Paso a Paso

### Paso 1: Acceso y Permisos de Micrófono
1. Entra a `/voice-lab` (o usa el botón de alternancia en el header de `/chat-lab`).
2. Verifica que se renderice la interfaz de inicio (tarjeta de bienvenida) y no la vista de llamada directamente.
3. Si el avatar es `entrevistador` (Sofia), completa el formulario de registro (Nombre y Rol Objetivo).
   - *Verificación:* El botón "Iniciar sesión de voz" debe estar deshabilitado hasta que completes ambos campos.
4. Presiona **Iniciar sesión de voz**.
5. **Denegar Permiso (Test A):** Deniega el permiso de micrófono en el navegador.
   - *Resultado Esperado:* Debe mostrarse el banner/tarjeta de error explicando que se requiere acceso al micrófono.
6. **Permitir Micrófono (Test B):** Recarga e inicia de nuevo, esta vez otorgando permiso.
   - *Resultado Esperado:* El backend debe conectar el WebSocket `/api/chat/voice/entrevistador`.

### Paso 2: Establecimiento de Conexión y Saludo Inicial
1. Una vez otorgado el permiso, observa el estado del avatar (círculo con emoji 🧑‍💼).
2. *Resultado Esperado:*
   - El estado debe pasar de "Conectando..." a "Escuchando...".
   - Sofia debe saludar automáticamente (audio y caption visible).
   - Se debe activar el cronómetro de la sesión en el header.
   - La barra de progreso de turnos debe aparecer en la parte superior (0%).

### Paso 3: Conversación Bidireccional
1. Habla por el micrófono para responder a Sofia.
2. *Resultado Esperado:*
   - Se genera un caption del lado del usuario (derecha, fondo violeta) cuando terminas de hablar.
   - Sofia debe procesar la respuesta y responder con audio local + caption del lado izquierdo (fondo gris/blanco).
   - El círculo del avatar debe mostrar un pulso de ondas animado mientras se reproduce el audio de Sofia.

### Paso 4: Controles de Audio (Mute / Terminar)
1. Presiona el botón del **Micrófono (Mute)**.
   - *Resultado Esperado:* El icono debe cambiar a `MicOff` en rojo, y el estado debe mostrar "Micrófono en silencio".
2. Habla mientras está silenciado.
   - *Resultado Esperado:* No se debe enviar ningún audio al servidor (sin captions nuevos).
3. Desactiva el mute y vuelve a hablar.
   - *Resultado Esperado:* La conversación se reanuda con normalidad.

### Paso 5: Flujo de Cierre y Countdown
1. Di una frase final indicando que deseas terminar (ej. *"Eso es todo por hoy, gracias Sofia"*).
2. *Resultado Esperado:*
   - El backend detecta la intención de cierre (closing intent).
   - En el frontend aparece un banner de advertencia con una cuenta regresiva (5 segundos) preguntando si deseas continuar.
3. **Cancelar Cierre (Test A):** Presiona "Cancelar" en el banner.
   - *Resultado Esperado:* El banner desaparece y la sesión continúa activa.
4. **Permitir Cierre (Test B):** Deja que el contador llegue a 0.
   - *Resultado Esperado:* La conexión se cierra, el micrófono se detiene, y se activa el estado finalizado ("Terminar y generar diagnóstico").

### Paso 6: Generación de Diagnóstico y Feedback
1. Presiona **Terminar y generar diagnóstico**.
2. *Resultado Esperado:*
   - Se muestra un loader mientras se hace la petición `POST /api/chat/diagnostico`.
   - Se abre el modal con el diagnóstico estructurado (Fortalezas, Áreas de mejora, Ritmo, y Conclusiones).
3. Dale **👎 (Dislike)** a un mensaje de Sofia en el panel de captions.
   - *Resultado Esperado:* El dislike se marca en rojo. Junto al mensaje aparece un botón `ℹ️` para agregar un comentario opcional de por qué no te gustó.
4. Completa el feedback del mensaje.
   - *Resultado Esperado:* El comentario queda visible debajo del mensaje correspondiente.

### Paso 7: Encuesta de Satisfacción y Persistencia
1. Cierra el modal de diagnóstico.
2. *Resultado Esperado:*
   - Debe abrirse automáticamente el modal de encuesta de satisfacción (Calificación 1-5 estrellas + comentario).
3. Selecciona una calificación y escribe un comentario, luego presiona "Enviar".
   - *Resultado Esperado:* Los datos de satisfacción se persisten en Postgres bajo `satisfaction_json`.

### Paso 8: Exportar Historial
1. Presiona el botón **Exportar a Markdown** (o el icono de descarga).
2. *Resultado Esperado:*
   - Se descarga un archivo `.md` con el nombre de la sesión.
   - El archivo debe incluir: los datos de registro del usuario, la transcripción completa de la conversación, los comentarios de dislike (bloques blockquote) y la sección final de "Satisfacción del Diagnóstico" con las estrellas correspondientes.
