import os
import re
import urllib.request
import urllib.error
import json
import sys

# Forzar codificación UTF-8 en salida si es posible
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

KEYS_FILE = r"C:\Users\pcdec\OneDrive\Documentos\Mente Viva\TESTDECLAVES.txt"

def load_keys(file_path):
    keys = {}
    if not os.path.exists(file_path):
        print(f"Error: No se encontró el archivo en {file_path}")
        return keys
    
    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            # Omitir comentarios o líneas vacías
            if not line or line.startswith('#'):
                continue
            # Intentar parsear CLAVE=VALOR
            match = re.match(r'^([A-Z0-9_]+)\s*=\s*(.+)$', line)
            if match:
                key_name = match.group(1)
                key_value = match.group(2).strip()
                keys[key_name] = key_value
    return keys

def test_anthropic(key):
    print("Probando Anthropic API Key...")
    url = "https://api.anthropic.com/v1/models"
    headers = {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "accept": "application/json"
    }
    
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req) as response:
            if response.status == 200:
                res_data = json.loads(response.read().decode('utf-8'))
                models = [m.get("id") for m in res_data.get("data", [])]
                models_str = ", ".join(models[:5])
                if len(models) > 5:
                    models_str += f" y {len(models) - 5} mas"
                return True, f"Clave valida y con acceso completo. Modelos disponibles: {models_str}"
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return False, "Clave invalida (No autorizada / 401)"
        try:
            err_body = e.read().decode('utf-8')
            err_json = json.loads(err_body)
            error_msg = err_json.get("error", {}).get("message", err_body)
            return True, f"Clave autenticada, pero retorno error ({e.code}): {error_msg}"
        except Exception:
            return True, f"Clave autenticada, pero retorno error HTTP {e.code}: {e.reason}"
    except Exception as e:
        return False, f"Error de conexion: {str(e)}"

def test_google_maps(key):
    print("Probando Google Maps API Key...")
    url = f"https://maps.googleapis.com/maps/api/timezone/json?location=39.6034810,-119.6822510&timestamp=1331147413&key={key}"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            status = res_data.get("status")
            if status == "OK":
                return True, "Clave valida (Conexion exitosa)"
            elif status == "REQUEST_DENIED":
                return False, f"Clave invalida o denegada por Google. Detalle: {res_data.get('errorMessage', 'Sin mensaje')}"
            else:
                return True, f"Clave autenticada. Google API retorno estado: {status}"
    except urllib.error.HTTPError as e:
        if e.code == 400 or e.code == 403:
            return False, f"Clave invalida (Error HTTP {e.code})"
        return False, f"Error HTTP {e.code}: {e.reason}"
    except Exception as e:
        return False, f"Error de conexion: {str(e)}"

def test_brave(key):
    print("Probando Brave Search API Key...")
    url = "https://api.search.brave.com/res/v1/web/search?q=test"
    headers = {
        "Accept": "application/json",
        "X-Subscription-Token": key
    }
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req) as response:
            if response.status == 200:
                return True, "Clave valida (Conexion exitosa)"
    except urllib.error.HTTPError as e:
        if e.code == 401 or e.code == 403:
            return False, f"Clave invalida (No autorizada / {e.code})"
        try:
            err_body = e.read().decode('utf-8')
            err_json = json.loads(err_body)
            error_msg = err_json.get("message", err_body)
            return True, f"Clave autenticada, pero con error ({e.code}): {error_msg}"
        except Exception:
            return True, f"Clave autenticada, pero con error HTTP {e.code}: {e.reason}"
    except Exception as e:
        return False, f"Error de conexion: {str(e)}"

def test_elevenlabs(key):
    print("Probando ElevenLabs API Key...")
    url = "https://api.elevenlabs.io/v1/user"
    headers = {
        "xi-api-key": key
    }
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req) as response:
            if response.status == 200:
                return True, "Clave valida y con acceso completo"
    except urllib.error.HTTPError as e:
        # ElevenLabs retorna 401 si falta permiso o la clave es incorrecta
        try:
            err_body = e.read().decode('utf-8')
            err_json = json.loads(err_body)
            error_msg = err_json.get("detail", {}).get("message", err_body)
            if "permission" in error_msg.lower():
                return True, f"Clave autentica y activa, pero le faltan permisos (e.g., user_read): {error_msg}"
            return False, f"Clave invalida o sin autorizacion (401): {error_msg}"
        except Exception:
            return False, f"Error HTTP {e.code}: {e.reason}"
    except Exception as e:
        return False, f"Error de conexion: {str(e)}"

def main():
    keys = load_keys(KEYS_FILE)
    if not keys:
        print("No se encontraron claves validas para probar en el archivo.")
        return

    results = {}
    
    tests = {
        "ANTHROPIC_API_KEY": test_anthropic,
        "GOOGLE_MAPS_API_KEY": test_google_maps,
        "BRAVE_API_KEY": test_brave,
        "ELEVENLABS_API_KEY": test_elevenlabs
    }
    
    print("\n--- INICIANDO PRUEBAS DE API KEYS ---")
    for key_name, key_value in keys.items():
        if key_name in tests:
            success, message = tests[key_name](key_value)
            results[key_name] = (success, message)
            status_str = "VALIDA (OK)" if success else "INVALIDA (FAIL)"
            print(f"Resultado para {key_name}: [{status_str}]")
            print(f"Detalle: {message}\n")
        else:
            print(f"Aviso: No hay una prueba configurada para la variable {key_name}.\n")

    print("--- RESUMEN DE RESULTADOS ---")
    for key_name, (success, message) in results.items():
        status = "VALIDA" if success else "INVALIDA"
        print(f"{key_name}: {status}")

if __name__ == "__main__":
    main()
