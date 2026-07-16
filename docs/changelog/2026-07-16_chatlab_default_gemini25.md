# 2026-07-16 — ChatLab: default Gemini pasa de 3.5-flash a 2.5-flash

## Contexto
Revisión de qué modelo Gemini corre por detrás en cada superficie, buscando
bajar costo/consistencia (ver comparación de precios julio 2026: `gemini-3.5-flash`
$1.50/$9.0 vs `gemini-2.5-flash` $0.30/$2.50 por 1M tok).

## Hallazgo (estado real antes del cambio)
Ambos caminos de **producción** ya estaban en 2.5, no en 3.5:

| Superficie | Setting / origen | Modelo | Familia |
|---|---|---|---|
| Voz Sofia (Live) | `settings.gemini_model_live` (`config.py:68`) | `gemini-2.5-flash-native-audio-latest` | 2.5 |
| Análisis / texto | `settings.gemini_model_text` (`config.py:73`) | `gemini-2.5-flash` | 2.5 |
| **VoiceLab** | hereda `gemini_model_live` + `gemini_model_text` del backend (sin selector propio) | 2.5 | 2.5 |
| **ChatLab** | default de `selectedModel` en el frontend | `gemini-3.5-flash` | **3.5** ← único en 3.5 |

El "3.5 por default" que se veía era **solo el selector de ChatLab** (banco de
pruebas de prompts), no la voz ni el diagnóstico real de usuarios.

Nota: `gemini-2.5-flash-lite` **no** tiene variante de audio nativo, así que la voz
no puede correr en Flash-Lite; se queda en `native-audio`.

## Cambio
Default de ChatLab: `gemini-3.5-flash` → `gemini-2.5-flash`.

Archivos:
- `menteviva-frontend/src/pages/ChatLab.tsx`
  - `PROVIDER_MODELS.gemini`: etiqueta `3.5-flash` "(GA - Default)" → "(GA)";
    `2.5-flash` "(Legacy)" → "(Default)".
  - `selectedModel` inicial de la sesión default (`session-default`): a `gemini-2.5-flash`.
  - `selectedModel` de `createNewSession`: a `gemini-2.5-flash`.
- `menteviva-frontend/src/pages/chatlab/types.ts`
  - Misma actualización de etiquetas en la copia de `PROVIDER_MODELS` (no importada
    por ChatLab hoy, pero se sincroniza para evitar deriva).

## Sin cambios
- VoiceLab: ya usaba 2.5 vía backend; no tiene default de modelo en el frontend.
- `config.py` (`gemini_model_live`, `gemini_model_text`): siguen en 2.5, sin tocar.

## Pendiente / opcional
- El alias `-latest` en la voz puede moverse solo a una versión más nueva. Si se
  quiere fijar, pinear a `gemini-2.5-flash-native-audio-preview-12-2025`.
- Sesiones de ChatLab ya guardadas en `localStorage` conservan su `selectedModel`
  anterior; el nuevo default solo aplica a sesiones nuevas.
