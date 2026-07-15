# 2026-07-09 — ChatLab: Gemini 2.5 Flash por default + reintento 503 agresivo

**Rama:** `feature/chat-lab-prompt-bench`
**Origen:** reporte del usuario — ChatLab tardaba mucho en responder (hasta ~52s por turno).

## Diagnóstico (logs `menteviva.log`)

El lag **no era un bug del código**, sino Gemini saturado. Evidencia de dos turnos consecutivos:

```
11:06:01 | [GeminiText] key 1/2 fallo (503 UNAVAILABLE "high demand") → reintenta key 2
11:06:06 | gemini/gemini-3.5-flash respondió en 16777 ms   (~17s)

11:06:46 | [ChatText] avatar=entrevistador provider=gemini turnos=2 prompt=27827 chars
11:07:32 | [GeminiText] key 1/2 fallo (503 UNAVAILABLE "high demand") → reintenta key 2
11:07:37 | gemini/gemini-3.5-flash respondió en 51652 ms   (~52s)
```

Detalle clave: la request entró a las `11:06:46` pero el 503 no afloró hasta
`11:07:32` — **el primer intento colgó ~46s en una sola key** antes de que el
failover saltara a la key 2 (que respondió en ~5s). Causa: el SDK
`google-genai` reintenta el 503 **internamente con backoff exponencial** antes
de propagar el error, así que nuestro loop de rotación de keys ni se enteraba
hasta pasados ~46s.

## Cambios

### 1. Default a Gemini 2.5 Flash — `app/config.py:73`
```python
# antes
gemini_model_text: str = "gemini-3.5-flash"
# ahora
gemini_model_text: str = "gemini-2.5-flash"
```
Modelo que el usuario quiere evaluar y además más barato:
`$0.30/$2.50` por 1M tok (in/out) vs `$1.50/$9.00` de 3.5 → ~5× más barato en
input, ~3.6× en output (tabla en `app/services/llm_costs.py`).

### 2. Reintento 503 agresivo — `app/services/gemini_live.py`
Cortamos el retry interno del SDK para que el 503 aflore al instante y nuestro
loop de rotación pruebe otra key de inmediato:
```python
_GEMINI_HTTP_OPTIONS = types.HttpOptions(
    timeout=20_000,  # ms; cap duro por intento
    retry_options=types.HttpRetryOptions(attempts=1),  # sin backoff interno
)
```
- `_gemini_client()` pasó a aceptar `http_options` opcional; se aplican **solo
  al path de TEXTO** (`generate_text` → `generate_content`).
- La **sesión Live de audio** sigue con el default (no se le mete un timeout
  HTTP a un websocket persistente).

Resultado esperado: si una key da 503, salto casi instantáneo a la siguiente en
vez de colgar ~46s. Tope duro de 20s por intento evita conexiones colgadas.

## Verificación

Validado por import directo (no consume cuota Gemini — free tier 20 req/día/key):
```
model = gemini-2.5-flash        ✓
timeout = 20000 ms              ✓
retry attempts = 1              ✓
client = Client                 ✓ (construye sin error)
```
**Pendiente de prueba real:** reiniciar backend y volver a probar en ChatLab;
confirmar en logs `modelo=gemini-2.5-flash` y salto rápido de key ante 503.

## Pendiente relacionado (NO tocado en este cambio)
Warning recurrente `[ChatText] user_profile invalido, ignorando: registro.industria
/ registro.experience_level Field required` — el frontend manda el perfil sin
esos campos, así que `UserProfile` no valida y se descarta → el perfil de Eric
no se inyecta al prompt. Arreglo aparte (hacer los campos opcionales).
