import json
import random
from types import SimpleNamespace

import pytest

from app.models.user_profile import Registro
from app.services import analysis


def test_format_conversation_and_truncation():
    conversation = [
        {"role": "user", "content": "hola"},
        {"role": "assistant", "content": "respuesta"},
    ]
    assert analysis._format_conversation(conversation) == "USUARIO: hola\nCLIENTE: respuesta"
    truncated = analysis._format_conversation(
        [{"role": "user", "content": "x" * 200}], max_chars=40
    )
    assert "conversacion truncada" in truncated


def test_empty_and_demo_analysis_are_contract_complete(monkeypatch):
    empty = analysis._empty_analysis("razon")
    assert empty["error"] is True and empty["overall_score"] == 0
    monkeypatch.setattr(random, "randint", lambda *_: 70)
    config = {
        "scenario_type": "test",
        "kpis": [{"id": "custom", "name": "Custom", "weight": 100, "indicators": []}],
    }
    demo = analysis._demo_analysis("avatar", config, 1, 10)
    assert 45 <= demo["overall_score"] <= 95
    assert demo["skills"][0]["id"] == "custom"
    assert demo["is_demo"] is True


def test_inconclusive_session_heuristics():
    assert analysis._is_inconclusive_session([]) == (False, "")
    short = [{"role": "user", "content": "no se"}] * 4
    assert analysis._is_inconclusive_session(short)[0] is True
    substantial = [{"role": "user", "content": "x" * 100}] + short
    assert analysis._is_inconclusive_session(substantial) == (False, "")
    evasive = [{"role": "user", "content": "no recuerdo pero voy a extender esta frase"}] * 4
    assert "evasivas" in analysis._is_inconclusive_session(evasive)[1]


def test_absence_gap_filter_keeps_quotes_and_real_evidence():
    gaps = [
        {"skill": "a", "evidence": "No se menciono resultado"},
        {"skill": "b", "evidence": 'No cuantifico: dijo "salio bien"'},
        {"skill": "c", "evidence": "Dijo que mejoro 20%"},
    ]
    assert [gap["skill"] for gap in analysis._drop_absence_gaps(gaps)] == ["b", "c"]


def test_demo_diagnostic_is_schema_valid():
    result = analysis._demo_diagnostico("inconcluso")
    assert result["is_demo"] is True
    assert result["blind_spot"] == "inconcluso"


class FakeClient:
    def __init__(self, content=None, error=None):
        self.content = content
        self.error = error
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **_kwargs):
        if self.error:
            raise self.error
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self.content))]
        )


def long_conversation(text="una historia concreta con resultado medible de veinte por ciento"):
    return [item for _ in range(4) for item in (
        {"role": "user", "content": text},
        {"role": "assistant", "content": "repregunta"},
    )]


@pytest.mark.asyncio
async def test_analyze_conversation_fallbacks_and_weighted_success(monkeypatch):
    assert (await analysis.analyze_conversation("missing", []))["error"] is True
    demo = await analysis.analyze_conversation("roberto", [])
    assert demo["is_demo"] is True

    config = analysis.KPIS_BY_SCENARIO["roberto"]
    skills = [
        {"id": item["id"], "name": item["name"], "score": 80, "weight": item["weight"]}
        for item in config["kpis"]
    ]
    payload = {"skills": skills, "overall_score": 1}
    monkeypatch.setattr(analysis, "get_groq_client", lambda: FakeClient(json.dumps(payload)))
    result = await analysis.analyze_conversation("roberto", long_conversation(), 120)
    assert result["overall_score"] == 80
    assert result["duration_seconds"] == 120

    monkeypatch.setattr(analysis, "get_groq_client", lambda: FakeClient("not-json"))
    assert (await analysis.analyze_conversation("roberto", long_conversation()))["error"]
    monkeypatch.setattr(
        analysis, "get_groq_client", lambda: FakeClient(error=RuntimeError("secret"))
    )
    failed = await analysis.analyze_conversation("roberto", long_conversation())
    assert failed["overall_summary"] == "Error temporal generando el analisis"


@pytest.mark.asyncio
async def test_generate_user_profile_success_filters_absence_and_handles_failures(monkeypatch):
    registro = Registro(
        nombre="Ana", rol_objetivo="Lead", industria="Software", experience_level="mid"
    )
    short = await analysis.generate_user_profile([], registro)
    assert short["is_demo"] is True

    valid = analysis._demo_diagnostico()
    valid["is_demo"] = False
    valid["gaps"] = [
        {"skill": "ausencia", "evidence": "No se menciono resultado", "impact": "x", "micro_practice": "x"}
    ]
    monkeypatch.setattr(analysis, "get_groq_client", lambda: FakeClient(json.dumps(valid)))
    result = await analysis.generate_user_profile(
        long_conversation("historia extensa " * 8), registro, vocal_note="tono sereno"
    )
    assert result["gaps"] == []

    monkeypatch.setattr(analysis, "get_groq_client", lambda: FakeClient("bad-json"))
    assert (await analysis.generate_user_profile(long_conversation(), registro))["is_demo"]
    monkeypatch.setattr(
        analysis, "get_groq_client", lambda: FakeClient(error=RuntimeError("provider"))
    )
    assert (await analysis.generate_user_profile(long_conversation(), registro))["is_demo"]
