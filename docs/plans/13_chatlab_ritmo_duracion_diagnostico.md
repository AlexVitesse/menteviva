# Plan 13 — ChatLab: Ritmo, duración del diagnóstico y señalización de avance

**Rama:** `feature/chat-lab-prompt-bench` · **Fecha:** 2026-07-09
**Origen:** Evaluación del ritmo y conducción de la sesión en ChatLab (comparando Gemini vs. GPT-4/ChatGPT). Se detectó que el LLM, al ser stateless, no tenía percepción del tiempo real de la sesión (sin reloj interno), lo que causaba que Sofia (el avatar) entrevistara sin fin y no señalizara avance ni cierre a tiempo.

---

## 📋 Diagnóstico del Problema

El enfoque previo de la política de duración controlaba la cobertura mínima de competencias antes del cierre, pero no resolvía el ritmo ni la guía de la entrevista. 

* **ChatGPT (North-star):** Señaliza constantemente su posición en la entrevista ("Antes de entrar en las preguntas...", "Una última pregunta antes de cerrar...").
* **Gemini:** Conducía bien el BEI metodológicamente pero sin señalar avance ni cierre. La sesión se extendía de forma indefinida a pesar de que la barra de progreso en la UI llegara al 100%.
* **Causa:** El modelo es *stateless*. No recibe la duración transcurrida ni el número de intercambios, por lo que no puede autogestionar el tiempo de sesión.

---

## 🛠️ Solución Implementada

### 1. Inyección de Estado de Sesión (Reloj del LLM)
Se implementó `build_session_state_note` en `app/prompts/entrevistador.py` para generar una nota de sistema invisible para el candidato:
* Mide el avance calculando `max(pct_tiempo, pct_intercambios)`.
* Inyecta guías según el porcentaje transcurrido:
  * **<40%:** Apertura breve y primeras historias.
  * **40% - 75%:** Profundización BEI (drill-STAR).
  * **75% - 90%:** Tramo final ("anunciar el último tema").
  * **≥90%:** Tiempo agotado (forzar última pregunta de reflexión y cierre, omitiendo el mínimo de competencias si es necesario).

### 2. Actualización de Prompts
* **Prompt Maestro (`app/prompts/entrevistador_prompt.md`):** Nueva sección de "SEÑALIZACIÓN DE AVANCE" y "EXCEPCIÓN POR TIEMPO" en las reglas de cierre.
* **Prompt Conciso de Voz (`app/prompts/entrevistador.py`):** Integración de las mismas directrices de ritmo y excepción de tiempo para el piloto de voz (Gemini Live).

### 3. Integración en Chat de Texto (`app/routers/chat_text.py` & `ChatLab.tsx`)
* El frontend ahora envía `elapsed_seconds` (cronómetro real de la sesión) al endpoint `/api/chat`.
* El backend calcula y añade la `[NOTA DEL SISTEMA]` al último mensaje de usuario antes de enviarlo a Gemini (sin guardarlo en el historial persistido de la base de datos).

### 4. Soporte para Sesiones de Voz (`app/routers/conversation.py` & `app/services/gemini_live.py`)
* **Gemini Live (Voz):** Se añadió `send_context_note()` en `GeminiLiveSession` para enviar el estado del tiempo como contexto sin disparar turnos de habla inmediatos (`turn_complete=False`). El proxy WebSocket inyecta estas notas de ritmo en los umbrales seguros de silencio (50%, 75%, 90%, 100%, 115%).
* **Groq (Voz clásica/texto):** Se integró `_history_with_pacing_note` para intercalar de forma limpia las notas en las llamadas a `chat_stream`.

---

## 🧪 Verificación y Pruebas

Se creó el script de pruebas unitarias y de integración `scripts/test_pacing_policy.py`:
* **Pruebas Deterministas:** Valida los cálculos de porcentaje de avance, umbrales de fases, rendering correcto de variables del prompt y soporte para cierre por tool vs. marca `[CIERRE]`.
* **Pruebas de Integración Live (Groq):** Simula una conversación al final del tiempo (avance > 90%) verificando que el modelo reaccione iniciando el cierre (pregunta de reflexión) y cerrando de inmediato con `[CIERRE]`.

---

## ⚠️ Hallazgos y Limitaciones Documentadas

1. **Tamaño del Prompt vs. Límites de API (Groq Free Tier):** El prompt maestro creció hasta el límite del tier gratuito de Groq (`openai/gpt-oss-20b` / `120b` con 8k TPM limit). Para el banco de pruebas, se recomienda usar `llama-3.3-70b-versatile` o ascender a un tier de pago para evitar errores `413 (Request too large)`.
2. **Excepción de Competencias:** El tiempo ahora tiene prioridad absoluta sobre la cobertura de competencias. Si se agota el tiempo, el sistema cierra la entrevista con el material que tenga disponible.
