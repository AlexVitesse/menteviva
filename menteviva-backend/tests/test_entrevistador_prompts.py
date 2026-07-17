from types import SimpleNamespace

from app.models.user_profile import Registro, UserProfile
from app.prompts import entrevistador


def profile(with_diagnostic=False):
    diagnostic = None
    if with_diagnostic:
        diagnostic = SimpleNamespace(
            competencias_foco=["liderazgo", "comunicacion"],
            blind_spot="habla en plural",
            verbal_patterns=SimpleNamespace(
                vague_verbs_detected=["apoyar"], we_vs_i_tendency="alta"
            ),
        )
    return UserProfile.model_construct(
        user_id="uid-a", created_at="now", updated_at="now",
        registro=Registro(
            nombre="Ana", rol_objetivo="Directora", industria="Fintech",
            experience_level="senior",
        ),
        diagnostico=diagnostic,
    )


def test_greetings_are_valid_and_seeded():
    first = entrevistador.pick_greeting("uid-a")
    assert first == entrevistador.pick_greeting("uid-a")
    index, text = entrevistador.pick_greeting()
    assert 0 <= index < len(entrevistador.GREETING_TEMPLATES)
    assert text


def test_duration_policy_covers_short_medium_long_and_invalid():
    assert entrevistador.build_duration_policy("bad")["competencias_min"] == 2
    assert entrevistador.build_duration_policy(25)["competencias_min"] == 2
    assert entrevistador.build_duration_policy(40)["competencias_min"] == 3
    assert entrevistador.build_duration_policy(60)["competencias_min"] == 4
    assert entrevistador.target_exchanges(3) == 4


def test_session_notes_cover_all_phases_and_modes():
    assert entrevistador.build_session_state_note(25) is None
    assert "apertura" in entrevistador.build_session_state_note(25, exchanges=1)
    assert "profund" in entrevistador.build_session_state_note(25, exchanges=4)
    assert "Tramo final" in entrevistador.build_session_state_note(25, elapsed_seconds=1200)
    assert "[CIERRE]" in entrevistador.build_session_state_note(25, elapsed_seconds=1400)
    assert "finalizar_entrevista" in entrevistador.build_session_state_note(
        25, elapsed_seconds=1400, cierre_como_tool=True
    )
    assert entrevistador.build_session_state_note(0, elapsed_seconds=0)


def test_master_and_gemini_prompts_render_profile_and_session_variables():
    user = profile()
    variables = entrevistador.build_entrevistador_variables(
        user,
        {"idioma": "es-MX", "tono": "directo", "minutos": 40,
         "competencias": ["liderazgo", "negociacion"]},
    )
    assert variables["nombre"] == "Ana"
    assert variables["competencias_min"] == "3"
    rendered = entrevistador.render_prompt_variables("Hola {{nombre}}", variables)
    assert rendered == "Hola Ana"
    assert "Ana" in entrevistador.get_entrevistador_prompt(user, {"minutos": 25})
    live = entrevistador.build_gemini_entrevistador_prompt(
        user, {"minutos": 40, "competencias": ["liderazgo", "negociacion"]}
    )
    assert "Ana" in live and "liderazgo, negociacion" in live
    assert "sector Fintech" in live
    assert "la persona" in entrevistador.build_gemini_entrevistador_prompt()


def test_user_context_requires_diagnostic_and_includes_gaps():
    assert entrevistador.build_user_context_block(profile()) == ""
    context = entrevistador.build_user_context_block(profile(with_diagnostic=True))
    assert "liderazgo" in context
    assert "habla en plural" in context
    assert "apoyar" in context
