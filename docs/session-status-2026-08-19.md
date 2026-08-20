# Estado de sesión — 2026-08-19

Tres frentes: (1) prod caído y restaurado, (2) consulta de evidencia de pruebas
en los labs, (3) rediseño de la landing pública.

---

## 1. Resumen ejecutivo

| Trabajo | Descripción | Estado |
|---|---|---|
| **Restauración del acceso público** | El `cloudflared` del `:8005` estaba zombie: proceso vivo reintentando contra un quick tunnel que Cloudflare ya recicló. Backend sano todo el tiempo. | ✅ Arriba, URL nueva |
| **Evidencia de pruebas en labs** | Consulta a Neon: **cero** sesiones y cero diagnósticos desde el redeploy del 12-ago. Prod corre un build que ningún tester ha ejercitado. | ✅ Documentado |
| **Cerebro 3D de la landing** | Trabajo pendiente del 18-ago (glb real en vez de malla procedural), revisado y commiteado. | ✅ Mergeado a `main` |
| **Auditoría de la landing** | 15 hallazgos en 4 grupos (credibilidad B2B, layout, técnico/a11y, copy) + plan de 9 bloques. | ✅ `docs/plans/19` |
| **Rediseño de la landing** | Dos pasadas: la primera salió genérica, la segunda cambió de dirección. | ✅ En `main`, sin push |
| **Capturas del producto** | Bloque 9 del plan. | ⏳ Bloqueado (sin activos) |

**Nada de esto está en `origin/main` todavía. No se hizo push ni redeploy.**

---

## 2. Prod: el túnel llevaba 5 días caído

Detalle completo: [`changelog/2026-08-19_restauracion_tunnel_prod`](changelog/2026-08-19_restauracion_tunnel_prod.md).

Tercer outage de la misma clase (03-jun, 11-ago, hoy), pero con un modo de falla
nuevo: el proceso **no había muerto**. Seguía vivo reintentando contra un túnel
que ya no existía del lado de Cloudflare (`Unauthorized: Tunnel not found` en
bucle). `pgrep` daba falso verde; el diagnóstico bueno estaba en `~/tunnel.log`.

- Último tráfico real de testers: **14-ago 08:59**.
- URL nueva: `https://planets-finance-hugo-excited.trycloudflare.com`
- Ya registrada por el usuario en Firebase → Authorized domains.
- `docs/BATERIA_PRUEBAS.md` actualizado con el link.

**Recomendación abierta:** `systemd --user` con `Restart=always` no habría
salvado esta (el proceso no murió, se colgó). Lo que sí corta el ciclo es un
cron cada 5 min que haga `curl` a la URL pública y relance si falla. El arreglo
de fondo es un named tunnel con hostname fijo, pero requiere cuenta de
Cloudflare con dominio y hoy no la hay en ese server.

---

## 3. Evidencia: prod está sin validar

Consultado en Neon (`menteviva-piloto`).

| Corte | Sesiones en labs | Diagnósticos |
|---|---|---|
| Desde el fix del túnel (11-ago 21:00 UTC) | 5 | 5 (ids 6-10) |
| **Desde el deploy a prod (12-ago 22:05 UTC)** | **0** | **0** |

Las 5 sesiones son de Sophia (3) y Brandon (2), **todas anteriores** al deploy.
El build que corre hoy (merge de `dev`: avatar-oss, roberto-sales-cases, login /
reset password, CORS y WS) nunca lo ha tocado un tester.

Agravante: el 13 y 14 de agosto **sí entró gente** (`/`, `/chat-lab`,
`/voice-lab`, `/api/chat/avatars`) y no quedó ninguna conversación. Sin revisar
los errores de esos dos días en `backend.log` no se distingue entre "se
asomaron y se fueron" y "se les rompió al arrancar".

**Acción pendiente:** pasarle el link nuevo a Sophia y Brandon y pedir una
prueba de humo sobre el build actual.

---

## 4. Landing: auditoría y rediseño

Auditoría y plan: [`plans/19_landing_rediseno_b2b`](plans/19_landing_rediseno_b2b.md).
Bitácora de ejecución: [`changelog/2026-08-19_rediseno_landing_b2b`](changelog/2026-08-19_rediseno_landing_b2b.md).

Audiencia elegida: **cliente B2B** (RRHH / L&D). Modo preserve: se conservan
marca, tipografía y el cerebro 3D.

### Primera pasada (commit `760bdb9`) — salió genérica

Se hicieron los bloques 2 a 8 del plan: páginas legales reales, hero partido,
sección "Para equipos", CTA dual, stepper vertical, comparativa replegada,
accesibilidad. Todo correcto sobre el papel, pero el resultado fue
**reordenar cajas**: el cerebro quedó metido en una columna (peor que de fondo)
y las seis tarjetas de características seguían ahí.

Veredicto del usuario: *"La misma vaina. Se ve genérica sin alma, tan de IA."*

### Segunda pasada (commit `46bfa8e`) — cambio de dirección

- **El cerebro vuelve a pantalla completa** detrás de todo, pero reaccionando al
  scroll: rota, se aleja en z y se hunde por la derecha. El progreso viaja como
  `MotionValue` de `useScroll` leído dentro de `useFrame`, sin listener de
  scroll ni re-render. Velo de gradiente para que el texto siempre tenga suelo.
- **Borrado `features.tsx`** (las 6 tarjetas con iconito y gradiente distinto,
  lo más intercambiable del sitio).
- **Nueva sección `conversations.tsx`**: fragmentos **textuales** de sesiones
  reales de la BD, con selector Ventas / Diagnóstico. Solo los turnos del
  avatar; lo que dijeron las personas que probaron no se publica.
- **Hero con postura** en vez de descripción de producto: *"La conversación que
  estás evitando."*

### Orden final de la página

Hero → Conversaciones → Cómo funciona → Para equipos → Por qué Mente Viva → CTA
→ Footer.

### Decisiones del usuario registradas

- **Las métricas `10K+` / `95%` del hero se quedan** (bloque 1 del plan, no
  aplicado). Son inventadas frente a 7 usuarios y 1 sesión real; se conservan
  porque el sitio se usa para demo. El riesgo queda anotado en el plan.
- El modelo `brain.glb` viene de un repo sin licencia. Decisión previa del
  usuario, documentada en el changelog del 18-ago.

---

## 5. Commits de la sesión (todos en `main` local)

```
a02896e feat(landing): cerebro 3D real (glb) en vez de la malla procedural
d8d355d docs: restauracion del tunnel de prod 2026-08-19 + link nuevo del piloto
7537b96 docs: evidencia en Neon — cero pruebas de labs desde el redeploy del 12-ago
a548dee docs: auditoria de la landing + plan de rediseno B2B (plan 19)
760bdb9 feat(landing): rediseno con enfoque B2B (plan 19, bloques 2-8)
46bfa8e feat(landing): segunda pasada, el cerebro vuelve al fondo y entra el producto
```

20 archivos, +1374 / -613. `npx tsc --noEmit` y `npm run build` en verde.
Revisión visual en Chrome contra el dev server.

---

## 6. Pendientes

| Qué | Quién | Nota |
|---|---|---|
| **Push a `origin/main` + redeploy** | decisión del usuario | El frontend NO se recarga solo: hay que `npm ci && npm run build` en el server |
| **Confirmar `CONTACTO`** | usuario | `menteviva-frontend/src/pages/Legal.tsx:6`, hoy `contacto@i-condor.com`. Todos los "Agendar demo" abren `mailto:` a esa dirección |
| **Revisión jurídica de los textos legales** | externo | Lo escrito es un punto de partida operativo |
| **Validar el copy del hero** | Sophia / Areli | *"La conversación que estás evitando"* es propuesta del asistente, no voz de marca aprobada |
| **Prueba de humo en prod** | Sophia / Brandon | El build desplegado no lo ha tocado ningún tester |
| **Capturas reales del producto** | pendiente de activos | La skill `gpt-image-2` necesita el CLI de RunComfy, no instalado. Generar un panel inventado sería mostrar un producto falso |
| **Supervisión del túnel** | usuario | Cron de healthcheck cada 5 min, o named tunnel con dominio |
