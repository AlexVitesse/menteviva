# Snapshot de sesión — 2026-04-27

Rama: `feature/avatar-talkinghead` · Commit: `597f78b`

> Para el roadmap estratégico ver `roadmap.md`. Este archivo es el snapshot de
> lo que se hizo y lo que quedó pendiente en la sesión de hoy.

---

## ✅ Hecho en esta sesión

### Avatares 3D (TalkingHead)
- Componente `TalkingHeadAvatar` (R3F + GLB + morph targets ARKit/Oculus)
- Lip-sync por amplitud calibrado: noise gate (`minDecibels=-55`), RMS sobre band-pass 280–3000 Hz, hysteresis temporal (silencio >100 ms snap a 0), lerp asimétrico (attack 0.55 / release 0.32)
- 3 avatares descargados a `/public/avatars/`: `sofia.glb`, `avaturn.glb`, `avatarsdk.glb`
- Feature flag `?avatar3d=1` (`utils/avatar3dFlag.ts`), persistido en localStorage
- Fix de "boca abierta vibrando": eliminado baseline de `mouthSmile`, snap-to-zero <0.015, release lento corregido
- Cámara ajustada para mostrar cabeza completa (fov 30, posición [0, 0.05, 0.85])

### Escenario Roberto-Cóndor (reemplaza Roberto genérico)
- `roberto_prompt.md` (~5.7 KB) — Director de Operaciones, manufactura metalmecánica, cliente Ingeniería Cóndor
- Banco de objeciones obligatorio EN ORDEN: tiempo → ROI → fracaso previo → consulta DG/Finanzas
- Reacciones calibradas a OEE / MTBF / 5 Porqués / COPQ / silencio activo
- 9 reglas absolutas (incluye prohibición de acotaciones narrativas tipo `(la miro)` y sobre-entusiasmo)
- Ejemplos MAL/BIEN para reforzar el formato
- `roberto.py` loader + entry actualizada en `scenarios.py`

### Análisis: 6 KPIs por escenario
- `KPIS_BY_SCENARIO` reemplaza la lista plana de skills
- Pesos suman 100, indicadores observables, refs metodológicas (PRAINCODERECI, AIDA, SPIN, etc.)
- `overall_score` = `weighted_sum / total_weight` (calculado en código, no por LLM)
- Backwards-compatible: la respuesta sigue usando key `skills[]` con campos opcionales nuevos (`weight`, `indicators_met`, `indicators_missed`)
- Roberto: `diagnostico_tecnico (25)` · `idioma_cliente (20)` · `praincodereci (15)` · `control_presion (15)` · `roi_calculado (15)` · `habilitacion_campeon (10)`
- María: `manejo_objeciones (25)` · `escucha_activa (20)` · `praincodereci (15)` · `control_emocional (15)` · `tecnica_cierre (15)` · `valor_vs_precio (10)`

### Modelo LLM
- Comparativa head-to-head: Llama 3.1 8B vs Llama 4 Scout 17B vs GPT-OSS 20B
- **Default cambiado a `openai/gpt-oss-20b`** (mismo throughput ~0.66 s/turno, cumplimiento de reglas mucho mayor por reasoning bake-in)
- Llama 4 Scout descartado (más verboso que el 8B, contraintuitivo)
- Fallback documentado: `llama-3.1-8b-instant`

### Tests sintéticos
- `test_roberto_condor.py` — 3 escenarios calibrados (features-only, industrial+5Porqués, COPQ con datos propios). Resultado: 3/3
- `test_roberto_long_session.py` — 17 turnos PRAINCODERECI completos + análisis final. Acepta `--model` para A/B
- `test_pivot.py` (carryover de sesión previa)

### Frontend extras
- `ShareDiagnosticoModal` (FB / X / LinkedIn / WhatsApp / copy / Web Share API)
- Landing page (`Landing.tsx` + `components/landing/*`) — carryover sesión previa
- VAD assets en `/public/vad/` (Silero ONNX + ort-wasm)

### Documentación
- `avatar-research.md` — investigación LivePortrait, decisión A3, bugs de calibración

---

## 🔜 Pendiente inmediato (cleanup de esta sesión)

1. **Validar avatar 3D en Chrome Android sobre ngrok** (task #13, in_progress)
   - Probar lip-sync con audio real
   - Medir FPS y consumo de batería
   - Definir fallback a avatar 2D si no rinde

2. **Validar Sofía y María bajo `gpt-oss-20b`** (sólo Roberto pasó el test largo)
   - Adaptar `test_roberto_long_session.py` para ambas
   - Verificar Fase 5 de Sofía (hoy anuncia "déjame hacerte una pregunta final" y emite `[CIERRE]` directo sin la pregunta)

3. **Generar avatar Sofía custom en Ready Player Me** cuando el sitio vuelva a estar arriba (hoy `sofia.glb` es el `brunette.glb` del repo TalkingHead)

---

## 🎯 Siguiente sesión — quick wins

- **UI para los 6 KPIs en `Report.tsx`**: barras con `weight` + `indicators_met` (✓) vs `indicators_missed` (✗)
- **Selector de nivel** Principiante / Intermedio / Avanzado en `Briefing.tsx` (backend selecciona variante del prompt)
- **Refactor María** al modelo "Celeste" del documento CAT-01 científico (mismo formato que Roberto-Cóndor)
- **SEO básico**: Open Graph tags en `index.html`

---

## 🚀 Más adelante

- Roberto Intermedio + Avanzado (variantes del prompt con mayor presión)
- **Lip-sync con visemas reales** (timestamps de ElevenLabs o Whisper word-level) — gran salto de calidad vs amplitud
- Avatar Carlos (entrevistas) con voz propia
- El resto del backlog estratégico vive en `roadmap.md` (loop adaptativo, multi-tenant, B2B dashboard)

---

## 📌 Decisiones tomadas hoy (no re-discutir)

| Tema | Decisión | Razón |
|---|---|---|
| Avatar 3D | A3 (R3F custom, no librería TalkingHead.js) | TalkingHead.js requiere fonemas, no amplitud |
| Lip-sync v1 | Por amplitud (AnalyserNode) | Funciona sin pipeline de fonemas |
| LLM default | `openai/gpt-oss-20b` | Reasoning → cumplimiento de reglas estrictas |
| Análisis | `llama-3.3-70b-versatile` (sin cambio) | JSON mode estable; gpt-oss-120b rompe el budget |
| KPIs | 6 fijos por escenario, weighted | Pedido del documento CAT-01 científico |
| Roberto | Director de Operaciones, no genérico de ventas | Documento Cóndor (`CondorIC_GuionVentaConsultiva_v1`) |
| Response shape | Mantener key `skills[]` con campos opcionales | Evitar romper UI mientras se migra |
