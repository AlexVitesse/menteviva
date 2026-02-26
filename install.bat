@echo off
title Mente Viva - Instalador
color 0B

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║            MENTE VIVA - Instalador                       ║
echo  ║         Instalando dependencias...                       ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: ===== VERIFICAR REQUISITOS =====
echo [0/4] Verificando requisitos...
echo.

:: Verificar Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python no esta instalado o no esta en el PATH
    echo Descargalo de: https://www.python.org/downloads/
    pause
    exit /b 1
)
echo   [OK] Python encontrado

:: Verificar Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js no esta instalado o no esta en el PATH
    echo Descargalo de: https://nodejs.org/
    pause
    exit /b 1
)
echo   [OK] Node.js encontrado

:: Verificar Poetry
poetry --version >nul 2>&1
if errorlevel 1 (
    echo   [!] Poetry no encontrado. Instalando...
    pip install poetry
    if errorlevel 1 (
        echo [ERROR] No se pudo instalar Poetry
        pause
        exit /b 1
    )
)
echo   [OK] Poetry encontrado
echo.

:: ===== INSTALAR BACKEND =====
echo [1/4] Instalando dependencias del Backend...
cd /d "%~dp0menteviva-backend"

poetry install
if errorlevel 1 (
    echo [ERROR] Fallo la instalacion del backend
    pause
    exit /b 1
)
echo   [OK] Backend instalado
echo.

:: ===== CREAR .ENV =====
echo [2/4] Configurando variables de entorno...
if not exist ".env" (
    copy ".env.example" ".env" >nul
    echo   [OK] Archivo .env creado
) else (
    echo   [OK] Archivo .env ya existe
)
echo.

:: ===== INSTALAR FRONTEND =====
echo [3/4] Instalando dependencias del Frontend...
cd /d "%~dp0menteviva-frontend"

call npm install
if errorlevel 1 (
    echo [ERROR] Fallo la instalacion del frontend
    pause
    exit /b 1
)
echo   [OK] Frontend instalado
echo.

:: ===== FINALIZADO =====
echo [4/4] Instalacion completada!
echo.
echo ══════════════════════════════════════════════════════════════
echo.
echo   IMPORTANTE: Antes de ejecutar, edita el archivo:
echo   menteviva-backend\.env
echo.
echo   Y agrega tu GROQ_API_KEY:
echo   GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxx
echo.
echo   Obtenla gratis en: https://console.groq.com
echo.
echo   Luego ejecuta: start.bat
echo.
echo ══════════════════════════════════════════════════════════════
echo.
pause
