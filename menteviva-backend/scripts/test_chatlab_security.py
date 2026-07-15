"""
Test de seguridad para verificar el token de acceso del ChatLab.
Levanta TestClient sobre la app de FastAPI y simula llamadas HTTP.
"""

import sys
from pathlib import Path
from fastapi.testclient import TestClient

# Añadir el path del backend
sys.path.append(str(Path(__file__).resolve().parent.parent))

from app.main import app
from app.config import settings

OUT = Path(__file__).resolve().parent.parent / "logs" / "chatlab_security.txt"
OUT.parent.mkdir(parents=True, exist_ok=True)

def run_tests():
    client = TestClient(app)
    log_lines = []

    log_lines.append("=== INICIANDO PRUEBAS DE SEGURIDAD CHATLAB ===")
    
    # Caso 1: Token configurado
    token_value = "secret-chatlab-token-123"
    settings.chatlab_token = token_value
    log_lines.append(f"Configurando settings.chatlab_token = '{token_value}'")

    # 1.a) Petición sin header -> 401 Expected
    r_no_header = client.get("/api/chat/avatars")
    log_lines.append(f"GET /api/chat/avatars sin header: Status={r_no_header.status_code}")
    assert r_no_header.status_code == 401, "Error: Debería denegar acceso sin header (401)"
    assert r_no_header.json()["detail"] == "Token de acceso al ChatLab faltante o inválido."

    # 1.b) Petición con token incorrecto -> 401 Expected
    r_wrong_header = client.get("/api/chat/avatars", headers={"X-ChatLab-Token": "token-incorrecto"})
    log_lines.append(f"GET /api/chat/avatars con token incorrecto: Status={r_wrong_header.status_code}")
    assert r_wrong_header.status_code == 401, "Error: Debería denegar acceso con token incorrecto (401)"

    # 1.c) Petición con token correcto -> 200 Expected
    r_correct = client.get("/api/chat/avatars", headers={"X-ChatLab-Token": token_value})
    log_lines.append(f"GET /api/chat/avatars con token correcto: Status={r_correct.status_code}")
    assert r_correct.status_code == 200, "Error: Debería permitir acceso con token correcto (200)"
    assert "avatars" in r_correct.json(), "Error: Respuesta inválida del endpoint"

    # Caso 2: Token vacío (desarrollo local / passthrough)
    settings.chatlab_token = ""
    log_lines.append("Configurando settings.chatlab_token = '' (passthrough local)")

    r_passthrough = client.get("/api/chat/avatars")
    log_lines.append(f"GET /api/chat/avatars sin header (passthrough): Status={r_passthrough.status_code}")
    assert r_passthrough.status_code == 200, "Error: Debería permitir acceso sin token en passthrough (200)"

    log_lines.append("\n✓ ¡TODAS LAS ASerciones DE SEGURIDAD PASARON CORRECTAMENTE!")
    
    # Escribir logs
    output_text = "\n".join(log_lines)
    OUT.write_text(output_text, encoding="utf-8")
    print("Pruebas de seguridad completadas con éxito. Logs guardados en logs/chatlab_security.txt")

if __name__ == "__main__":
    run_tests()
