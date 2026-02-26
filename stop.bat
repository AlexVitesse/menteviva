@echo off
title Mente Viva - Stop
color 0C

echo.
echo  Deteniendo Mente Viva...
echo.

:: Matar procesos de uvicorn (backend)
taskkill /f /im uvicorn.exe >nul 2>&1
taskkill /f /im python.exe /fi "WINDOWTITLE eq Mente Viva - Backend*" >nul 2>&1

:: Matar procesos de node (frontend)
taskkill /f /im node.exe /fi "WINDOWTITLE eq Mente Viva - Frontend*" >nul 2>&1

echo   [OK] Procesos detenidos
echo.
pause
