# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout — two apps, don't confuse them

```
Mente Viva/
├── menteviva-backend/       # PRIMARY: FastAPI backend for soft-skills avatars (Roberto, Maria, Carlos)
├── menteviva-frontend/      # PRIMARY: React+Vite frontend that pairs with menteviva-backend
├── interview-simulator/     # SEPARATE project: job-interview variant (own backend + frontend)
│   ├── backend/
│   └── frontend/
├── install.bat / start.bat / stop.bat   # Windows launchers for the PRIMARY app
└── logs/, .docx specs, *.txt plans      # Design docs (Spanish)
```

`interview-simulator/` is a parallel, self-contained subproject with its own README. Changes in `menteviva-*` do not propagate there and vice versa.

## Common commands

All commands below assume the **primary** app (`menteviva-backend` + `menteviva-frontend`). Shell is bash-on-Windows; use forward slashes.

### First-time setup
```bash
./install.bat          # checks Python/Node/Poetry, installs both apps, creates .env from .env.example
```

### Run dev (both servers)
```bash
./start.bat            # launches backend on :8000 and frontend on :5173 in separate terminals
./stop.bat             # kills uvicorn + the frontend node process
```

### Backend only
```bash
cd menteviva-backend
poetry install
poetry run uvicorn app.main:app --reload --port 8000
# Health:   http://localhost:8000/health
# OpenAPI:  http://localhost:8000/docs
```

### Frontend only
```bash
cd menteviva-frontend
npm install
npm run dev            # vite dev server on :5173 (host:true, reachable on LAN)
npm run build          # tsc + vite build — use this to type-check, there is no separate lint step
npm run preview        # serve the production build
```

### Tests
Backend has `pytest` + `pytest-asyncio` + `httpx` declared as dev deps, **but no test suite exists yet** (no `tests/` directory). If you add tests, put them under `menteviva-backend/tests/` and run with `poetry run pytest`. Frontend has no test runner configured.

### Required env vars (`menteviva-backend/.env`)
| Var | Notes |
|---|---|
| `GROQ_API_KEY` | Required. Free key from https://console.groq.com |
| `GROQ_API_KEY_2` .. `GROQ_API_KEY_4` | Optional; enable round-robin rotation for concurrent users |
| `ELEVENLABS_API_KEY` | Required for TTS |
| `DEBUG` | `true`/`false`; toggles debug logging |

Frontend reads `VITE_API_URL` (default `http://localhost:8000`) and `VITE_WS_URL` (default `ws://localhost:8000`).

## Architecture

### Realtime voice-chat pipeline
A single WebSocket at **`/api/conversation/{avatar_id}`** (`app/routers/conversation.py`) orchestrates the whole turn. Per user turn:

1. Client sends `{type: "audio", audio: <base64>}` (webm from MediaRecorder) or `{type: "text", text: ...}`.
2. **STT** — `services/groq_whisper.py` → Groq `whisper-large-v3-turbo`, Spanish.
3. **LLM (streaming)** — `services/groq_llm.py` → Groq `llama-3.1-8b-instant`. Tokens stream back as `assistant_token` events.
4. **TTS** — `services/edge_tts.py` → **ElevenLabs** (see gotcha below). Full audio arrives in one `assistant_audio` event.
5. When the client sends `{type: "end_session"}`, the server runs **analysis** (`services/analysis.py` → Groq `openai/gpt-oss-120b`) and returns `session_end` with a scored skills report.

Status events (`transcribing | thinking | generating_audio | analyzing | ready`) are sent before each phase so the UI can show the right indicator.

### Key gotcha: `edge_tts.py` uses ElevenLabs
The file `app/services/edge_tts.py` is named after an earlier Microsoft Edge TTS implementation but now calls the **ElevenLabs** SDK (see `pyproject.toml`: `elevenlabs = "^1.0"`). Voice IDs are hardcoded in `AVATAR_VOICES` inside that file. Branch `feature/elevenlabs-tts` reflects the migration. Do not rename the module casually — routers import `from app.services.edge_tts import text_to_speech`.

### Groq key rotation (`services/groq_pool.py`)
A module-level `GroqPool` round-robins across all non-empty keys in `settings.groq_api_keys`. Every call to `get_groq_client()` returns the next client — thread-safe via a `Lock`. All Groq services (LLM, Whisper, analysis) go through this pool. Never instantiate `Groq(...)` directly in new code; use `get_groq_client()` so rotation keeps working.

### Avatars & scenarios are config, not classes
`app/prompts/scenarios.py::AVATARS` is the single source of truth for each persona:
- Basic info (name, role, company, personality)
- `voice` (ElevenLabs voice key — but note the actual voice IDs live in `edge_tts.py::AVATAR_VOICES`, keyed by avatar id)
- `avatar_type` (e.g. `"animated"` — the frontend renders a 2D SVG Lottie character)
- `system_prompt` (full roleplay instructions; the LLM is told never to break character, one question per reply)

`services/analysis.py::SKILLS_BY_SCENARIO` defines the evaluation rubric per avatar (skill id → description). To add a new avatar:
1. Add entry to `AVATARS` in `scenarios.py`.
2. Add matching voice id to `edge_tts.py::AVATAR_VOICES`.
3. Add skill rubric to `SKILLS_BY_SCENARIO` in `analysis.py` or the post-session analysis will error out.

### Frontend state & WS protocol
- **Zustand store** — `src/stores/sessionStore.ts` holds `selectedAvatar`, `messages`, `status`, `serverError`, `metrics`.
- **WebSocket hook** — `src/hooks/useWebSocket.ts`. Intentional behavior: `assistant_token` events accumulate text into a `pendingTextRef` and are **not** rendered until the matching `assistant_audio` arrives, so the assistant message and voice appear together. Don't "fix" this to stream the text live — it will desync the audio/caption.
- **Routing** — `App.tsx` uses a flat route set: `/` (Dashboard / avatar picker) → `/briefing` → `/simulation` → `/report`. The 14-screen product spec below is aspirational, not implemented.
- **Audio** — `useAudioRecorder` (MediaRecorder → base64) and `useAudioPlayer` (plays the `assistant_audio` blob); `useSoundEffects` for UI sfx.

### Styling
Tailwind is the styling system. The design-token palette (ink/deep/card, violet/teal, success/warning/danger, cream/muted/subtle) is encoded in `menteviva-frontend/tailwind.config.js` — prefer those tokens over raw hex. Fonts are Syne (headings/CTAs) and Instrument Sans (body), loaded via Google Fonts.

## Product context (keep for design decisions)

**Mente Viva** is a soft-skills training platform that uses conversational AI + 2D avatars to simulate workplace scenarios (sales, negotiation, interviews). Users speak with an avatar for a few minutes, then receive a scored report.

- **Score semaphore**: green > 75, yellow 50–75, red < 50 (see `Report.tsx`).
- **Adaptive roadmap logic** (product spec, partially implemented): score > 75 on 2 consecutive sessions → level up; score < 50 → level down; no improvement in 3 → insert remedial session.
- **Scenario catalog** (planned, 40+ across 8 categories). Phase 1 implemented as 3 avatars:
  - **Roberto** — CAT-01 Ventas / Consultive B2B SaaS sell
  - **Maria** — CAT-02 Negociación / Contract renegotiation
  - **Carlos** — CAT-03 Entrevistas (partial; shares Roberto's voice for now)
- **Flujos (aspirational)**: Onboarding (P-01..P-04), Dashboard (P-05), Simulation (P-06..P-09), Feedback (P-10..P-12), B2B Manager (P-13, P-14). Only Dashboard / Briefing / Simulation / Report are built.
- **Team**: Brandon H. (product), Eric V. (tech lead), Sophia M. (psych content), Cristina T. (B2B strategy), Areli M. (marketing).

## Conventions worth following

- Backend code and comments are in Spanish (variable names, log messages, docstrings). Match the surrounding style — don't translate.
- All routes live under `/api` except `/health` (see `main.py`). Add new routers with `app.include_router(..., prefix="/api", tags=[...])`.
- Logging uses a single named logger `menteviva` with a rotating file handler (5 MB × 5) at `menteviva-backend/logs/menteviva.log`. Use `logging.getLogger("menteviva")` so output is captured consistently.
- CORS origins are hardcoded in `config.py::cors_origins`. Add new dev tunnel / frontend hosts there.
- System prompts enforce **one question per avatar reply** — keep that constraint when tweaking prompts (the UX assumes it, and commit `caf9fbd` reinforces it).
