# 2026-08-12 — Remediación de retros de Roberto y Sofía

Documento técnico completo:
[`docs/plans/18_retros_roberto_sofia_remediacion.md`](../plans/18_retros_roberto_sofia_remediacion.md)

## Cambios

- Roberto permanece fijo en manufactura y se divide en dos casos:
  descubrimiento operativo y objeciones/avance comercial.
- Briefing, prompt y rúbrica quedan alineados con Ingeniería Cóndor y la planta
  metalmecánica.
- Cada caso de Roberto tiene una evaluación compatible con su objetivo.
- Sofía recupera frases truncadas, contradicciones, ambigüedad y silencios antes
  de pivotar o cerrar.
- El cierre de Sofía se estructura en dos turnos.
- Las rutas de texto garantizan una pregunta visible por turno.
- El reloj interno cambia a `<session_control>` y se elimina de cualquier salida
  visible.
- VoiceLab muestra progreso por tiempo real y no por cuota de turnos.
- El diagnóstico recupera falta explícita de métricas y abuso de “nosotros”
  usando citas reales.
- Se añadieron arneses deterministas y reales para Roberto, Sofía, duración y
  diagnóstico.

## Validación

- Gemini texto focalizado: 4/4.
- Ronda larga alternativa de Sofía: verde en contratos automáticos.
- Roberto determinista y real: 4/4 en las rondas ejecutadas.
- Política de duración: aprobada.
- Compilación Python y build frontend: aprobados.

## Pendiente

- QA humana completa con Gemini Live para validar audio, latencia, naturalidad,
  Markdown hablado, cierre audible y ausencia de controles internos.
- Refinar evidencia contradicha y repetición de preguntas ya contestadas.

