@echo off
title Mente Viva - Launcher
color 0A

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║            MENTE VIVA - Demo Launcher                    ║
echo  ║         Entrenamiento de Soft Skills con IA              ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: Verificar que existan las carpetas
if not exist "menteviva-backend" (
    echo [ERROR] No se encontro la carpeta menteviva-backend
    pause
    exit /b 1
)

if not exist "menteviva-frontend" (
    echo [ERROR] No se encontro la carpeta menteviva-frontend
    pause
    exit /b 1
)

:: Verificar .env del backend
if not exist "menteviva-backend\.env" (
    echo [AVISO] No existe .env en el backend
    echo Creando .env desde .env.example...
    copy "menteviva-backend\.env.example" "menteviva-backend\.env" >nul
    echo.
    echo [IMPORTANTE] Edita menteviva-backend\.env y agrega tu GROQ_API_KEY
    echo Puedes obtenerla gratis en: https://console.groq.com
    echo.
    pause
)

:: Levantar Postgres dev (Docker) si esta detenido; sin el, el backend se
:: queda colgado abriendo el pool y nunca escucha en :8000.
docker start menteviva-pg-dev >nul 2>&1
if errorlevel 1 (
    echo [AVISO] No se pudo iniciar menteviva-pg-dev. ^(Docker Desktop apagado?^)
    echo         El backend no arrancara sin Postgres en :5433.
)

echo [1/2] Iniciando Backend (FastAPI - Puerto 8000)...
start "Mente Viva - Backend" cmd /k "cd /d "%~dp0menteviva-backend" && poetry run python -m app"

:: Esperar un poco para que el backend inicie
timeout /t 3 /nobreak >nul

echo [2/2] Iniciando Frontend (Vite - Puerto 5173)...
start "Mente Viva - Frontend" cmd /k "cd /d "%~dp0menteviva-frontend" && npm run dev"

echo.
echo ══════════════════════════════════════════════════════════════
echo.
echo   Backend:  http://localhost:8000
echo   API Docs: http://localhost:8000/docs
echo   Frontend: http://localhost:5173
echo.
echo   Se abrieron 2 ventanas de terminal.
echo   Cierra esta ventana o presiona cualquier tecla para abrir el navegador.
echo.
echo ══════════════════════════════════════════════════════════════

pause >nul

:: Abrir el navegador con el frontend
start http://localhost:5173
