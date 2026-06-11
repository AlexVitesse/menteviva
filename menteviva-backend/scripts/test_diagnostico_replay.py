"""Replay del análisis del diagnóstico sobre un transcript GUARDADO — sin Gemini.

Uso:
    poetry run python -m scripts.test_diagnostico_replay

Re-juega la conversación del escenario `sin_metricas` (Laura Méndez, corrida
2026-06-09 que dio `gaps: []`) directamente contra generate_user_profile (Groq).
Sirve para validar cambios al PROMPT DE ANÁLISIS sin gastar cuota de Gemini:
si el fix de "evidencia por cita vaga" funciona, ahora debe aparecer un gap de
orientacion_resultados citando una frase vaga de Laura ("quedó muy satisfecho",
"sin contratiempos"...).

Resultado en consola Y en logs/replay_diagnostico.txt (la consola se traga el
stdout en algunos entornos Windows).
"""
import asyncio
import json
import pathlib
import sys
import traceback

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from app.models.user_profile import Registro  # noqa: E402
from app.services.analysis import generate_user_profile  # noqa: E402

OUT = pathlib.Path(__file__).parent.parent / "logs" / "replay_diagnostico.txt"

REGISTRO = Registro(
    nombre="Laura Méndez",
    rol_objetivo="Gerente de Marketing",
    industria="Retail",
    experience_level="mid",
)

# Transcript literal de la corrida sin_metricas (test_diagnostico_escenarios,
# 2026-06-09). Laura jamás da un número; el análisis de entonces devolvió
# gaps: [] y blind_spot sentinel.
CONVERSATION = [
    {"role": "assistant", "content": "¡Hola, Laura! Qué gusto saludarte. Soy Sofía, de Mente Viva. ¿Cómo va tu día hoy?"},
    {"role": "user", "content": "¡Hola, Sofía! Qué alegría recibir tu mensaje. El día va genial, gracias por preguntar. ¿En qué puedo apoyarte hoy?"},
    {"role": "assistant", "content": "¡Qué bueno que vaya genial! Me da mucho gusto.\n\nMira, Laura, me gustaría que me contaras sobre alguna ocasión en tu trabajo donde hayas tenido que adaptarte a un cambio importante. ¿Qué pasó exactamente?"},
    {"role": "user", "content": "Claro, recuerdo una ocasión cuando el proyecto al que estaba trabajando cambió de enfoque en medio de la fase de diseño. Decidí reorganizar las prioridades y dedicar tiempo extra a capacitar al equipo en la nueva herramienta que necesitábamos usar. Trabajé mano a mano con el cliente para ajustar el cronograma y asegurar que todos entendieran los nuevos objetivos. El resultado fue que el proyecto se completó sin contratiempos y el cliente quedó muy satisfecho con la transición."},
    {"role": "assistant", "content": "Entiendo. Mencionas que reorganizaste las prioridades y capacitaste al equipo. ¿Qué fue lo primero que hiciste tú, específicamente, cuando te enteraste del cambio de enfoque?"},
    {"role": "user", "content": "Lo primero que hice fue sentarme con el líder del proyecto y escuchar el briefing completo sobre el nuevo enfoque. Luego anoté los puntos clave y redacté un plan de acción rápido, asignando tareas concretas a cada miembro del equipo. Después lo compartí en una reunión informal para que todos pudieran aportar sus ideas y aclarar dudas. Así aseguramos que la transición fuera fluida y sin sorpresas."},
    {"role": "assistant", "content": "Ya veo. Y después de esa reunión, cuando ya tenían el plan, ¿qué acción concreta tomaste tú para empezar a implementar ese nuevo enfoque?"},
    {"role": "user", "content": "Inmediatamente después de la reunión, me encargué de crear el flujo de trabajo actualizado: escribí una guía paso a paso y la compartí en la carpeta compartida del proyecto. Luego organicé una breve sesión de entrenamiento donde demostré las funciones clave de la nueva herramienta y respondí preguntas al instante. Finalmente, coordiné el primer sprint con tareas claras, asegurándome de que todos supieran sus responsabilidades desde el primer día."},
    {"role": "assistant", "content": "Excelente. Me queda muy clara esa situación.\n\nAhora, Laura, me gustaría que me contaras sobre alguna situación en la que hayas tenido que resolver un problema difícil, algo que no tenía una solución obvia. ¿Qué sucedió?"},
    {"role": "user", "content": "En un proyecto de consultoría me encontré con una brecha de datos que no tenía solución clara. Yo tomé la iniciativa de crear una matriz de verificación manual y lo probé con datos de prueba hasta que todo encajó. Luego ajusté el proceso y documenté la solución para evitar que volviera a ocurrir. Al final, el cliente quedó muy satisfecho y el"},
    {"role": "assistant", "content": "Qué fuerte. Mencionas que creaste una matriz de verificación manual. ¿Cómo se te ocurrió esa idea en particular, y qué pasos seguiste para desarrollarla?"},
    {"role": "user", "content": "Me quedó claro que la clave era volver a lo básico, así que pensé en una matriz de verificación manual como un “chequeo” que pudiera cubrir todas las lagunas. Diseñé primero los criterios que debía incluir, los plasmé en una hoja de cálculo y probé con algunos registros de prueba para"},
    {"role": "assistant", "content": "Entiendo. Y después de probarlo, ¿qué ajustes o mejoras tuviste que hacerle a esa matriz para que funcionara correctamente?"},
]

EXPECTED_HINTS = ["metric", "número", "numero", "medi", "cuantif", "indicador",
                  "resultado", "orientaci"]


async def main() -> str:
    diag = await generate_user_profile(
        conversation=CONVERSATION,
        registro=REGISTRO,
        session_vars={"idioma": "es-MX", "tono": "calido-profesional", "minutos": 25},
    )
    blob = json.dumps(
        {"gaps": diag.get("gaps"), "blind_spot": diag.get("blind_spot"),
         "competencias_foco": diag.get("competencias_foco")},
        ensure_ascii=False,
    ).lower()
    hit = any(h in blob for h in EXPECTED_HINTS)
    resumen = (diag.get("resumen_ejecutivo") or "").strip()
    lines = [
        "--- DIAGNÓSTICO (replay sin_metricas, post-fix E1/E2) ---",
        json.dumps(diag, ensure_ascii=False, indent=2),
        "",
        f">>> HINT orientación a resultados (sin métricas): "
        f"{'APARECE' if hit else 'NO aparece (revisar a mano)'}",
        f">>> gaps devueltos: {len(diag.get('gaps') or [])} "
        f"(la corrida pre-fix devolvió 0)",
        f">>> resumen_ejecutivo: {'PRESENTE' if resumen else 'VACÍO (revisar)'} "
        f"({len(resumen)} chars)",
        f"    \"{resumen}\"" if resumen else "",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    try:
        report = asyncio.run(main())
    except Exception:
        report = "ERROR:\n" + traceback.format_exc()[-1200:]
    OUT.write_text(report, encoding="utf-8")
    print(report)
