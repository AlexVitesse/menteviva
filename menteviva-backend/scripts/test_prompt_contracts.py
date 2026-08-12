"""Pruebas locales de contrato para los prompts de Sofia y Roberto.

No llaman proveedores externos: validan ensamblado, aislamiento de casos y las
reglas criticas que deben sobrevivir futuras ediciones de prompts.
"""

from pathlib import Path

from app.prompts.entrevistador import (
    build_gemini_entrevistador_prompt,
    build_session_state_note,
    sanitize_interviewer_text,
)
from app.prompts.roberto import get_roberto_prompt
from app.prompts.scenarios import get_system_prompt
from app.services.analysis import KPIS_BY_SCENARIO
from app.services.analysis import _reinforce_evidence_backed_diagnosis


def test_roberto_descubrimiento_es_manufactura_y_no_objeciones_completas() -> None:
    prompt = get_roberto_prompt("principiante", "descubrimiento")

    assert "planta metalmecánica" in prompt
    assert "Descubrimiento operativo en manufactura" in prompt
    assert "SUSTITUYEN el banco de objeciones" in prompt
    assert "NO lances objeciones de precio" in prompt
    assert "estación 4" in prompt


def test_roberto_objeciones_parte_de_descubrimiento_previo() -> None:
    prompt = get_roberto_prompt("intermedio", "objeciones")

    assert "Manejo de objeciones y avance comercial" in prompt
    assert "El vendedor ya sabe" in prompt
    assert "Usa las objeciones obligatorias del nivel" in prompt
    assert "Ingeniería Cóndor" in prompt


def test_roberto_case_viaja_en_session_vars() -> None:
    prompt = get_system_prompt(
        "roberto",
        session_vars={"roberto_case": "objeciones"},
        level="avanzado",
    )

    assert "CASO 2" in prompt
    assert "NPV/IRR" in prompt


def test_roberto_case_invalido_cae_a_descubrimiento() -> None:
    prompt = get_roberto_prompt("invalido", "otro")

    assert "CASO 1" in prompt
    assert "NIVEL ACTUAL: PRINCIPIANTE" in prompt


def test_sofia_voz_recupera_y_cierra_en_dos_turnos() -> None:
    prompt = build_gemini_entrevistador_prompt(
        session_vars={"minutos": 20, "idioma": "es-MX"}
    )

    assert "frase llega truncada" in prompt
    assert "Nunca cierres por una sola respuesta" in prompt
    assert "usa DOS turnos" in prompt
    assert "PROHIBIDO hacer la pregunta final" in prompt


def test_casos_roberto_tienen_rubricas_compatibles_con_su_objetivo() -> None:
    discovery = KPIS_BY_SCENARIO["roberto_descubrimiento"]
    objections = KPIS_BY_SCENARIO["roberto"]

    assert sum(kpi["weight"] for kpi in discovery["kpis"]) == 100
    assert sum(kpi["weight"] for kpi in objections["kpis"]) == 100
    assert any(kpi["id"] == "causa_raiz" for kpi in discovery["kpis"])
    assert all(kpi["id"] != "habilitacion_campeon" for kpi in discovery["kpis"])


def test_frontend_y_backend_comparten_ids_de_caso() -> None:
    frontend_store = (
        Path(__file__).parents[2]
        / "menteviva-frontend"
        / "src"
        / "stores"
        / "sessionStore.ts"
    ).read_text(encoding="utf-8")
    simulation = (
        Path(__file__).parents[2]
        / "menteviva-frontend"
        / "src"
        / "pages"
        / "Simulation.tsx"
    ).read_text(encoding="utf-8")

    assert '"descubrimiento" | "objeciones"' in frontend_store
    assert "roberto_case: selectedRobertoCase" in simulation


def test_control_interno_no_parece_dialogo_y_se_limpia() -> None:
    note = build_session_state_note(20, elapsed_seconds=600)
    assert note and note.startswith("<session_control")
    assert "NOTA DEL SISTEMA" not in note
    dirty = f"{note}\nEntiendo. ¿Qué hiciste tú? ¿Cómo terminó?"
    assert sanitize_interviewer_text(dirty) == "Entiendo. ¿Qué hiciste tú?"


def test_diagnostico_refuerza_senales_explicitas_omitidas() -> None:
    parsed = {
        "gaps": [],
        "competencias_foco": ["comunicacion"],
        "blind_spot": (
            "No fue posible identificar un punto ciego especifico con la "
            "informacion compartida en esta sesion."
        ),
        "verbal_patterns": {"we_vs_i_tendency": "alta"},
    }
    conversation = [
        {
            "role": "user",
            "content": "El equipo y yo lo resolvimos; no hubo cifras concretas.",
        }
    ]
    _reinforce_evidence_backed_diagnosis(parsed, conversation)
    assert any(gap["skill"] == "orientacion_resultados" for gap in parsed["gaps"])
    assert "orientacion_resultados" in parsed["competencias_foco"]
    assert "El equipo y yo" in parsed["blind_spot"]


if __name__ == "__main__":
    tests = [value for name, value in globals().copy().items() if name.startswith("test_")]
    for test in tests:
        test()
        print(f"OK {test.__name__}")
