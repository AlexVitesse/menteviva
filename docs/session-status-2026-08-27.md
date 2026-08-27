# Estado de sesión — 2026-08-26/27

Dos frentes: (1) el avatar **Celeste** como alternativa a Roberto en CAT-01
Ventas, (2) el **deploy a prod** — que además sacó por fin la landing B2B que
llevaba desde el 19-ago sin publicar.

---

## 1. Resumen ejecutivo

| Trabajo | Descripción | Estado |
|---|---|---|
| **Avatar Celeste** | Port del GEM de ventas que Brandon validó a mano. Clienta difícil que se calibra al rubro del vendedor, frente al contexto fijo de manufactura de Roberto. Los dos conviven para poder compararlos. | ✅ En `main` y en prod |
| **Auditoría del avatar** | Revisión del propio trabajo: 3 defectos reales, todos en el turno de feedback (lo que el equipo iba a comparar). | ✅ Corregidos y con test |
| **Deploy a prod** | `7e11be3` → `9cac768`. Celeste en labs + landing B2B, Legal y `brain.glb` públicos. | ✅ Verificado contra el server |
| **Túnel restaurado** | Cuarto outage de la misma clase. URL nueva. | ✅ Arriba |
| **`CHATLAB_TOKEN`** | Intento de cerrar los labs abiertos. Rompió el VoiceLab. | ⛔ Revertido |
| **Comparativa Roberto vs Celeste** | El objetivo de todo esto. | ⏳ Pendiente del equipo |

Cierra dos pendientes que arrastraba la sesión del 19-ago: el push a
`origin/main` y el redeploy.

---

## 2. Celeste — avatar nuevo de CAT-01

Detalle: [`changelog/2026-08-26_avatar_celeste_ventas`](changelog/2026-08-26_avatar_celeste_ventas.md).

Roberto no terminaba de convencer en ventas. Brandon armó un GEM de Gemini con
otro enfoque —"Celeste Vargas"— y pidió tenerlo en los labs **junto** a Roberto,
no en su lugar.

**La diferencia de enfoque que se va a evaluar:** Roberto tiene contexto fijo
(planta metalmecánica, Cóndor, estación 4) y el vendedor se adapta a él. Celeste
pregunta en su primer turno qué vendes, a quién, a qué precio y qué etapa quieres
practicar, y se calibra a eso. Sirve para cualquier rubro; Roberto entrena uno.

Lo que se portó y lo que cambió frente al GEM:

- El Paso 0 pregunta **4** datos en vez de 5: el nivel lo manda el selector de la
  plataforma.
- Marcador `{{NIVEL}}`: al modelo le llega solo el bloque de su nivel.
- Regla anti-acotaciones narrativas (el GEM no la necesitaba; Groq y Gemini sí
  las emiten).
- **Precedencia explícita de la regla del descuento sobre la de objeciones
  escalonadas**: bajar el precio no resuelve la objeción de precio. Sin esa línea
  el modelo trataba el descuento como objeción resuelta y avanzaba — se reprodujo
  en el test antes de escribirla.
- Feedback acotado a ~500 palabras, cerrando con `[CIERRE]`.

**Marcada `lab_only`**: sale en `/chat-lab`, no en el catálogo del piloto. Sin esa
marca un tester podía entrar por voz a un flujo sin probar.

Frontend: **cero cambios necesarios**. El ChatLab pide la lista de avatares a la
API en runtime y ya muestra selector de nivel para cualquiera con
`supports_levels`.

### La auditoría fue lo que salvó el entregable

La primera versión pasaba sus propios tests, pero ninguno ejercitaba el turno de
feedback — justo lo que el equipo iba a comparar contra el GEM. Al probarlo
end-to-end aparecieron tres cosas:

1. **El feedback salía vacío.** `chat_complete` tenía `max_tokens=500` y
   gpt-oss-20b descuenta de ahí sus tokens de razonamiento. Medido:
   `finish_reason=length`, 2179 chars de razonamiento, **0 de contenido**. El
   caller lo tomaba por turno vacío y devolvía una frase de re-enganche de Sofía.
2. **El post-proceso lo destrozaba.** La regla anti-acotaciones casaba dentro del
   `**negrita**` de Markdown y dejaba `- * *: 5/10`, sin el nombre del KPI.
3. **Celeste era alcanzable desde producción** (de ahí `lab_only`).

Lección para la convención de tests del repo: el harness cubría las reglas de
conducta del roleplay, que es lo fácil de comprobar, y no el artefacto que
justifica el avatar. **Probar el entregable, no solo las reglas.**

`scripts/test_celeste.py` cubre ahora las dos capas: ensamblado + `lab_only` +
regresión del post-proceso **sin LLM** (`--assembly-only`, no gasta cuota), y 4
escenarios de conducta contra Groq. Verde: `ensamblado=OK | conducta 4/4`.

---

## 3. Deploy a prod

Detalle: [`changelog/2026-08-27_deploy_celeste_landing_prod`](changelog/2026-08-27_deploy_celeste_landing_prod.md).

Se desplegó `9cac768`, que arrastra también los 7 commits de la landing B2B
pendientes desde el 19-ago. **Decisión del usuario**: que saliera todo, no solo
Celeste.

| Qué | Estado |
|---|---|
| Backend | Recargado por el watcher, `/health` OK, Neon schema v7 |
| Frontend | Rebuild 11:08 — landing B2B, Legal, `brain.glb` (2.5 MB) |
| `lab_only` | Verificado en prod: `/api/avatars` → `roberto, maria` · `/api/chat/avatars` → `entrevistador, roberto, celeste, maria` |
| Público | **https://solved-bid-tribunal-sonic.trycloudflare.com** |

### Cuatro tropiezos

1. **El pull abortó** por un `package-lock.json` sucio en el server (un `npm
   install` suelto). Era el bump de `@esbuild` que el repo ya traía; se descartó.
2. **`npm ci` no funciona en ese server.** No es el lockfile: lo genera npm
   **11.6.2** en local y allá corre npm **10.8.2**, que lee distinto las deps
   opcionales de plataforma. `npm ci --dry-run` en local pasa igual. El build
   salió porque `npm run build` usó el `node_modules` existente. **Hasta
   actualizar npm, no borrar `node_modules` en esa VM.**
3. **Túnel zombie, cuarta vez.** `Unauthorized: Tunnel not found` en bucle,
   proceso vivo. Diagnóstico por `~/tunnel.log`, nunca por `pgrep`. Al relanzar
   quedaron dos cloudflared del 8005 escribiendo al mismo log; se mató el viejo.
4. **`CHATLAB_TOKEN` rompió el VoiceLab.** Los labs están abiertos en el túnel
   público (el `.env` no tiene `APP_ENVIRONMENT`, `CHATLAB_TOKEN` ni
   `CHATLAB_OPERATORS`). Se probó el token compartido: `chatLabFetch` lo manda,
   pero VoiceLab usa `apiFetch` pelado y quedó en 401. Confirmado con curl y
   revertido.

`memory/prod_deploy_setup.md` actualizado: decía "rebuild: `npm ci && npm run
build`", que hoy es instrucción falsa para esa máquina.

---

## 4. Commits de la sesión

```
9cac768 feat(labs): avatar Celeste para comparar contra Roberto en CAT-01
bcd2f1e docs: bitacora del deploy 2026-08-27 (Celeste + landing B2B en prod)
```

13 archivos en el primero (4 nuevos), +2 docs. `test_celeste.py` 4/4,
`test_prompt_contracts` en verde, `npm run build` en verde. Ambos en
`origin/main`.

---

## 5. Pendientes

| Qué | Quién | Nota |
|---|---|---|
| **Firebase → Authorized domains** | usuario | `solved-bid-tribunal-sonic.trycloudflare.com` sin `https://`. El backend responde pero **el login falla** sin esto. La URL cambió respecto a la de agosto: hay que repartirla otra vez |
| **Correr la comparativa** | Brandon / Sophia / Cris | ChatLab → Roberto y Celeste, mismo motor y mismo nivel. Todo se guarda en `chatlab_conversations` (Neon) con transcript completo, así que se puede revisar después sin repetirla |
| **`npm install -g npm@11`** | usuario | Dentro del env conda `deepseek`, no necesita sudo. Hasta entonces ese server no puede reinstalar dependencias |
| **Cerrar los labs con `CHATLAB_OPERATORS`** | pendiente | El arreglo correcto, no el token: `apiFetch` ya manda el `Authorization` en ambos labs. Requiere los UID de Firebase de la tabla `users` en Neon y probar ChatLab **y** VoiceLab antes y después |
| **Decidir Roberto vs Celeste** | producto | Si gana Celeste: quitar `lab_only`, meterla en `AVATARS_WITH_LEVELS` y en los textos de `Briefing.tsx`, y decidir qué hace el feedback largo en voz (probablemente delegarlo a `analysis.py` en vez de que lo dicte el avatar) |
| **Knowledge del GEM** | opcional | Los ~47k chars de diálogos modelo no se portaron: revientan los 8k TPM de Groq pegados al system prompt. Si se quiere, va como RAG |
| **Voz propia para Celeste** | pendiente | Hoy comparte la de María |
| **Supervisión del túnel** | usuario | Sigue abierto del 19-ago: cron de healthcheck cada 5 min, o named tunnel con dominio |
