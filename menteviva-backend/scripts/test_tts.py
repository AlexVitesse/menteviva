"""
Test del dispatcher de TTS: ElevenLabs (MP3) vs Gemini (WAV).

Contexto: decision 2026-09-18 — el proveedor alterno es Gemini, no OpenAI.
Gemini devuelve PCM16 crudo, asi que edge_tts lo envuelve en WAV y el WS
anuncia el contenedor en `assistant_audio_start.mime`. Si esa cadena se rompe
el navegador recibe bytes que no puede decodificar y el avatar suena mudo
**sin error en el backend** — de ahi que esto se pruebe sin depender del oido.

Dos capas:

1. SIN API (default): cero cuota.
   - output_mime() sigue al proveedor activo.
   - El WAV que generamos es parseable y conserva rate/canales/ancho.
   - El rate se lee del mime de la respuesta, no se hardcodea.
   - La rama Gemini del stream emite WAV.
   - **El fallback tambien emite WAV**: si cayera en MP3 el cliente ya
     recibio mime=audio/wav y no sonaria nada.

2. LIVE (`--live`): A/B real contra las dos APIs. Mide TTFB y total, y deja
   los audios en scripts/_out/ para escucharlos.
   OJO: el free tier de Gemini es por modelo y Gemini Live ya lo consume.

Ejecutar:
    poetry run python scripts/test_tts.py              # sin cuota
    poetry run python scripts/test_tts.py --live
    poetry run python scripts/test_tts.py --live --avatar entrevistador
"""

import argparse
import asyncio
import io
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import settings  # noqa: E402
from app.services import edge_tts  # noqa: E402

FRASE = (
    "Mire, yo llevo veinte anos en esta planta y he visto pasar muchos "
    "consultores. Digame en concreto que gano yo con esto."
)

OUT_DIR = Path(__file__).parent / "_out"


def _check(nombre: str, ok: bool, detalle: str = "") -> bool:
    marca = "OK   " if ok else "FALLA"
    extra = f" — {detalle}" if detalle else ""
    print(f"  {marca} {nombre}{extra}")
    return ok


def test_assembly() -> bool:
    """Todo lo comprobable sin gastar una sola llamada a la API."""
    print("\n[1] Contenedor y mime (sin API)")
    resultados = []

    original = settings.tts_provider
    try:
        settings.tts_provider = "elevenlabs"
        resultados.append(_check("mime elevenlabs", edge_tts.output_mime() == "audio/mpeg"))
        settings.tts_provider = "gemini"
        resultados.append(_check("mime gemini", edge_tts.output_mime() == "audio/wav"))
    finally:
        settings.tts_provider = original

    # El WAV tiene que ser parseable: un header mal armado se reproduce como
    # ruido o silencio, no lanza excepcion.
    pcm = b"\x00\x01" * 2400
    wav = edge_tts._pcm_to_wav(pcm, 24000)
    with wave.open(io.BytesIO(wav), "rb") as wf:
        resultados.append(_check("wav canales=1", wf.getnchannels() == 1))
        resultados.append(_check("wav 16 bits", wf.getsampwidth() == 2))
        resultados.append(_check("wav rate=24000", wf.getframerate() == 24000))
        resultados.append(
            _check("wav conserva el PCM", wf.readframes(wf.getnframes()) == pcm)
        )
    resultados.append(_check("wav empieza en RIFF", wav[:4] == b"RIFF", repr(wav[:4])))

    # El rate sale de la respuesta: si Google cambia el default y lo
    # hardcodeamos, la voz se oye acelerada o lenta sin que nada falle.
    rate = edge_tts._sample_rate_from_mime("audio/L16;codec=pcm;rate=16000")
    resultados.append(_check("rate leido del mime", rate == 16000, f"rate={rate}"))
    resultados.append(
        _check(
            "rate default si no viene",
            edge_tts._sample_rate_from_mime(None) == edge_tts.GEMINI_SAMPLE_RATE_DEFAULT,
        )
    )
    return all(resultados)


def test_stream_branches() -> bool:
    """La rama Gemini del stream y su fallback, con las APIs monkeypatcheadas."""
    print("\n[2] Ramas del stream (sin API)")
    resultados = []

    original = settings.tts_provider
    gemini_real = edge_tts._gemini_tts
    el_real = edge_tts._elevenlabs_wav

    async def recolectar(avatar: str = "roberto") -> bytes:
        return b"".join([c async for c in edge_tts.text_to_speech_stream(FRASE, avatar)])

    try:
        settings.tts_provider = "gemini"

        # (a) camino feliz
        fake_wav = edge_tts._pcm_to_wav(b"\x00\x01" * 100, 24000)

        async def _fake_gemini(text, avatar_id):
            return fake_wav

        edge_tts._gemini_tts = _fake_gemini
        salida = asyncio.run(recolectar())
        resultados.append(_check("gemini OK -> emite WAV", salida == fake_wav))

        # (b) Gemini cae: el fallback DEBE seguir siendo WAV, porque el cliente
        #     ya recibio mime=audio/wav en assistant_audio_start.
        async def _boom(text, avatar_id):
            raise RuntimeError("429 quota")

        fallback_wav = edge_tts._pcm_to_wav(b"\x02\x03" * 100, 24000)

        async def _fake_el(text, voice_id):
            return fallback_wav

        edge_tts._gemini_tts = _boom
        edge_tts._elevenlabs_wav = _fake_el
        salida = asyncio.run(recolectar())
        resultados.append(_check("gemini falla -> fallback en WAV", salida == fallback_wav))
        resultados.append(
            _check("el fallback NO sale en MP3", salida[:4] == b"RIFF", repr(salida[:4]))
        )
    finally:
        settings.tts_provider = original
        edge_tts._gemini_tts = gemini_real
        edge_tts._elevenlabs_wav = el_real

    return all(resultados)


def test_respuesta_degradada() -> bool:
    """Gemini devuelve candidato SIN content de forma intermitente.

    Medido el 2026-09-22 con textos cortos: finish_reason=OTHER y content=None.
    Sin guard eso reventaba con AttributeError sobre None — un error que no
    nombra la causa y que enmascara el motivo real en los logs de prod.
    """
    print("\n[3] Respuesta degradada de Gemini (sin API)")
    resultados = []

    from app.services import gemini_live

    class _FakeCandidate:
        content = None
        finish_reason = "OTHER"

    class _FakeResponse:
        candidates = [_FakeCandidate()]

    class _FakeModels:
        def generate_content(self, **kwargs):
            return _FakeResponse()

    class _FakeClient:
        models = _FakeModels()

    real = gemini_live._gemini_client
    try:
        gemini_live._gemini_client = lambda **kw: _FakeClient()
        try:
            edge_tts._gemini_tts_sync("hola", "roberto")
            resultados.append(_check("content=None levanta error claro", False, "no lanzo"))
        except RuntimeError as e:
            resultados.append(
                _check(
                    "content=None levanta error claro",
                    "finish_reason" in str(e),
                    str(e),
                )
            )
        except AttributeError as e:
            resultados.append(
                _check("content=None levanta error claro", False, f"AttributeError: {e}")
            )
    finally:
        gemini_live._gemini_client = real

    return all(resultados)


async def _medir(provider: str, avatar: str) -> tuple[float, float, bytes]:
    """Devuelve (ttfb, total, audio) del proveedor pedido."""
    original = settings.tts_provider
    settings.tts_provider = provider
    try:
        inicio = time.monotonic()
        ttfb = None
        trozos = []
        async for chunk in edge_tts.text_to_speech_stream(FRASE, avatar):
            if ttfb is None:
                ttfb = time.monotonic() - inicio
            trozos.append(chunk)
        return ttfb or 0.0, time.monotonic() - inicio, b"".join(trozos)
    finally:
        settings.tts_provider = original


def test_live(avatar: str) -> bool:
    """A/B real. Gasta cuota de las dos APIs."""
    print(f"\n[3] A/B en vivo (avatar={avatar})")
    OUT_DIR.mkdir(exist_ok=True)
    resultados = []

    for provider, ext in (("elevenlabs", "mp3"), ("gemini", "wav")):
        try:
            ttfb, total, audio = asyncio.run(_medir(provider, avatar))
        except Exception as e:
            resultados.append(
                _check(f"{provider} responde", False, f"{type(e).__name__}: {e}")
            )
            continue

        destino = OUT_DIR / f"tts_{avatar}_{provider}.{ext}"
        destino.write_bytes(audio)
        resultados.append(
            _check(
                f"{provider} genera audio",
                len(audio) > 1000,
                f"ttfb={ttfb:.2f}s total={total:.2f}s {len(audio)} bytes -> {destino.name}",
            )
        )

    print("\n  Escuchalos antes de mover TTS_PROVIDER en prod:")
    print(f"  {OUT_DIR}")
    return all(resultados)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="A/B real contra las APIs")
    parser.add_argument("--avatar", default="roberto")
    args = parser.parse_args()

    print("=" * 70)
    print("TEST TTS — dispatcher ElevenLabs / Gemini")
    print("=" * 70)

    ok = test_assembly() and test_stream_branches() and test_respuesta_degradada()
    if args.live:
        ok = test_live(args.avatar) and ok

    print("\n" + "=" * 70)
    print("RESULTADO:", "VERDE" if ok else "ROJO")
    print("=" * 70)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
