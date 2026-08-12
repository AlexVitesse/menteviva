# Cómo consultar los datos del piloto (actividad + retro de los compañeros)

Guía para revisar quién probó Mente Viva, sus sesiones, feedback y diagnósticos.
Última verificación: 2026-07-16.

## Dónde vive la data

- **BD:** Neon, proyecto **`menteviva-piloto`** (id `plain-recipe-34456635`, Postgres 16, región `aws-us-east-1`).
- Todo se guarda como JSON serializado en columnas `TEXT` (ver `menteviva-backend/app/db.py`).

### Tablas

| Tabla | Qué guarda |
|---|---|
| `users` | quién se registró: `user_id` (Firebase UID o `chatlab:*` para pruebas), `nombre`, `email`, `rol_objetivo`, `industria`, `auth_provider`, `last_login`, `created_at` |
| `chatlab_conversations` | sesiones de **ChatLab y VoiceLab**: `avatar_id`, `provider`, `model`, `minutos`, `conversation_json` (incluye feedback 👍/👎 y comentario por mensaje), `satisfaction_json` (estrellas + comentario final), `closed`, `updated_at` |
| `practice_sessions` | prácticas Roberto/María/Carlos: `avatar_id`, `level`, `duration_seconds`, `total_exchanges`, `overall_score`, `analysis_json`, `conversation_json` |
| `diagnostics` | diagnóstico final por usuario: `diagnostico_json`, `conversation_json`, `is_demo`, `completed_at` |

> Nota: los `user_id` con prefijo `chatlab:` son sesiones de prueba internas (banco), no usuarios reales de Firebase.

## 3 formas de consultar

### A) SQL directo en Neon (recomendado, lo más flexible)

Desde la consola de Neon (SQL Editor) o vía Claude Code con el MCP de Neon.
Queries listas más abajo.

### B) Scripts de inspección ya en el repo

Se corren en el VPS (o local con el `.env` apuntando a Neon) y escupen a consola:

```bash
cd menteviva-backend
poetry run python -m scripts.inspect_users      # usuarios registrados + conteo por email
poetry run python -m scripts.inspect_chatlab    # diagnósticos + conversaciones de chatlab
```

### C) Endpoints HTTP (por usuario, hoy SIN auth)

Requieren conocer el `user_id` de cada quien:

- `GET /api/user/{user_id}/sessions` — lista ligera de prácticas
- `GET /api/session/{session_id}` — práctica completa (análisis + conversación)
- `GET /api/user/{user_id}` — perfil
- `GET /api/user/{user_id}/diagnostics` — diagnósticos del usuario
- `GET /api/diagnostic/{diagnostic_id}` — un diagnóstico completo

> **Pendiente:** no existe un endpoint "ver todo" (panel admin). Por eso hoy la
> revisión global se hace con SQL (A) o scripts (B). Si se quiere un panel para
> el equipo, construir `GET /api/admin/overview` protegido con token.

## Queries listas para copiar (opción A)

### 1. Resumen general (¿hay actividad?)
```sql
SELECT
 (SELECT COUNT(*) FROM users) AS usuarios,
 (SELECT COUNT(*) FROM chatlab_conversations) AS chatlab_voicelab_convs,
 (SELECT COUNT(*) FROM chatlab_conversations WHERE satisfaction_json IS NOT NULL) AS con_satisfaccion,
 (SELECT COUNT(*) FROM practice_sessions) AS practicas,
 (SELECT COUNT(*) FROM diagnostics) AS diagnosticos;
```

### 2. Quién se registró y su último acceso
```sql
SELECT user_id, nombre, email, rol_objetivo, industria, auth_provider, last_login, created_at
FROM users
ORDER BY created_at DESC;
```

### 3. Sesiones de ChatLab/VoiceLab + satisfacción (la retro)
```sql
SELECT session_id, user_id, name, avatar_id, provider, model, minutos, closed,
       (satisfaction_json IS NOT NULL) AS tiene_satisfaccion,
       satisfaction_json,
       length(conversation_json) AS conv_len,   -- proxy de qué tan larga fue
       updated_at
FROM chatlab_conversations
ORDER BY updated_at DESC
LIMIT 50;
```

### 4. Prácticas con score
```sql
SELECT session_id, user_id, avatar_id, level, duration_seconds,
       total_exchanges, overall_score, created_at
FROM practice_sessions
ORDER BY created_at DESC
LIMIT 50;
```

### 5. Diagnósticos (con nombre del usuario)
```sql
SELECT d.diagnostic_id, d.user_id, u.nombre, d.is_demo, d.completed_at,
       length(d.conversation_json) AS conv_len
FROM diagnostics d
LEFT JOIN users u ON u.user_id = d.user_id
ORDER BY d.completed_at DESC;
```

### 6. Transcript completo de UNA sesión de voz/chat
```sql
SELECT conversation_json
FROM chatlab_conversations
WHERE session_id = '<pega-el-session_id-aqui>';
```

### 7. Sólo el feedback (satisfacción) de todas las sesiones
```sql
SELECT user_id, avatar_id, minutos,
       satisfaction_json ->> 'rating'   AS estrellas,
       satisfaction_json ->> 'comment'  AS comentario,
       updated_at
FROM chatlab_conversations
WHERE satisfaction_json IS NOT NULL
ORDER BY updated_at DESC;
```
> Nota: `satisfaction_json` es TEXT; si `->>` falla, castear: `satisfaction_json::jsonb ->> 'rating'`.

## Snapshot al 2026-07-16 (referencia)

- 5 usuarios: Cris Toledo, ERIC, Brandon Honorato, Areli Mohedano (reales, Firebase) + Eric Vazquez (`chatlab:` de prueba).
- Última actividad real de los compañeros: **mayo** (Brandon: 1 práctica María score 22; Cris y ERIC: diagnósticos). Areli registrada en junio, sin sesiones.
- 1 sola sesión de VoiceLab (prueba interna de hoy): ⭐3/5 — *"Muy corto, al final la voz de Sofia se distorsionó… no entiendo bien algunas partes del análisis."* (conversación de solo ~2.7k chars para 25 min → cierre temprano a revisar).

**Para la revisión post-pruebas:** correr las queries 1→7 en orden; la 1 dice si hubo
movimiento, la 3 y la 7 traen la retro, la 6 el transcript de lo que quieras auditar.
