# Sistema de Diseño e Interfaz — Mente Viva ChatLab

Este documento registra los patrones de diseño, decisiones de UX/UI e integraciones técnicas realizadas en el espacio de pruebas de prompts (ChatLab).

## 1. Dirección de Diseño e Identidad Visual (Feel)
*   **Concepto:** Sandbox de laboratorio de ingeniería cognitiva / Consola de experimentación de prompts.
*   **Estética:** Cyberpunk/Sci-Fi minimalista de alta densidad (estilo Linear/Vercel) integrada en la paleta oficial de *Mente Viva*.
*   **Colores Primitivos:**
    *   Fondo Base Canvas: `bg-ink` (`#08071A`)
    *   Paneles y Contenedores Elevados: `bg-deep` (`#110F2B`) y `bg-panel` (`#181630`)
    *   Acentos Activos: `violet` (`#7C3AED`) y `teal` (`#06B6D4`)
    *   Jerarquía de Texto: `cream` (`#F5F3FF`) para lectura cómoda, `muted` para etiquetas y `subtle` para placeholders o elementos deshabilitados.
*   **Tipografía:**
    *   Títulos e Identidad: *Syne* (moderna y geométrica).
    *   Cuerpo del Chat y Controles: *Instrument Sans* (legibilidad fluida).
    *   Métricas e Indicadores de Telemetría: Monospace / Tabular.

## 2. Estrategia de Profundidad (Depth Strategy)
*   **Bordes-Only:** Estructura limpia basada en divisiones de baja opacidad (`border-white/5` y `border-white/10`) y transparencias con desenfoque (`backdrop-blur-md px-6 py-4`).
*   **Sombras Sutiles:** Se evitan sombras pesadas. Los componentes activos usan sombras sutiles de color violeta difuso (`hover:shadow-violet/20`) para simular energía digital o estados interactivos táctiles.

## 3. Grilla y Unidades de Espaciado (Spacing)
*   **Base Unit:** 4px.
*   **Márgenes de Layout:** `p-6` para controles laterales y cajas de entrada, `py-8 px-6` para el feed de conversación principal.
*   **Densidad de Información:** Espaciados estrechos en telemetría (`space-y-3`, `gap-1.5`) para maximizar la lectura técnica en una sola pantalla sin necesidad de scrolls excesivos.

## 4. Patrones de Componentes Clave

### A. Layout del Workspace (Split-Pane Ocultable y Responsive)
*   Un contenedor flexible a pantalla completa que se divide en dos columnas principales en pantallas grandes (`lg:flex-row`).
*   **Barra Lateral Ocultable:** Se implementó un botón de alternancia en el encabezado (`◀` / `▶`) controlado por un estado reactivo. Al contraerse, la barra lateral desaparece completamente (`hidden`) y la terminal de chat (`flex-1`) se expande de forma fluida a todo lo ancho de la pantalla, ideal para sesiones de roleplay inmersivas o pantallas pequeñas.

### B. Consola de Telemetría e Inspección
*   Un widget de estado que lee los datos devueltos por el backend:
    *   **Carga del Prompt:** Medidor numérico y visual de caracteres del prompt actual de sistema.
    *   **Modelo Activo:** Indicador del modelo exacto en ejecución (`gpt-4o`, `gpt-4o-mini`, `gemini-2.5-flash`, `gpt-oss-20b`).
    *   **Estado del Cierre:** Semaforización visual que parpadea en naranja si la IA gatilla una marca de terminación.

### C. Administrador de Sesiones Locales (Multipersona)
*   Un gestor de estados persistente en `localStorage`. Resuelve el uso simultáneo por múltiples personas en el mismo cliente sin mezclar historiales:
    *   Permite crear sesiones independientes con nombres dinámicos.
    *   Permite renombrar dinámicamente cada celda mediante inputs inline con detección de teclas (`Enter` / `Escape`).
    *   Permite la descarga directa de un reporte del laboratorio estructurado en Markdown (`.md`), documentando la fecha, metadatos técnicos, modelo exacto y la transcripción del chat.

### D. Burbujas de Conversación Balanceadas
*   Diferenciación de bordes e identificación tipo etiqueta en estilo mono (`TÚ` y `ASISTENTE` en mayúsculas).
*   **Indicador de Escritura ("Pulso Neuronal"):** Animaciones fluidas en violeta (`animate-bounce` desfasados) que emulan el razonamiento de los modelos LLM antes de mostrar el texto final en pantalla.

## 5. Integración y Selección de Modelos por Proveedor
El sandbox permite aislar y evaluar los siguientes modelos por cada proveedor configurado:

### A. Groq (Prompt Maestro)
*   `openai/gpt-oss-20b` (Default)
*   `llama-3.3-70b-versatile`
*   `llama-3.1-8b-instant`
*   `deepseek-r1-distill-llama-70b`

### B. Gemini (Voz sin audio)
*   `gemini-2.5-flash` (Default)
*   `gemini-2.5-pro`
*   `gemini-1.5-flash`
*   `gemini-1.5-pro`

### C. ChatGPT / OpenAI (Motor ChatGPT)
*   `gpt-4o` (Default Sofía)
*   `gpt-4o-mini` (Default otros avatares)
*   `o1-mini`
*   `o3-mini`
