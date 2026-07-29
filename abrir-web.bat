@echo off
title Servidor de la web S&C - NO CERRAR ESTA VENTANA
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   No encuentro Node.js en este equipo.
  echo   Instalalo desde https://nodejs.org y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

echo.
echo   ============================================================
echo     Arrancando el servidor de la web
echo   ============================================================
echo.
echo     La web se abrira sola en el navegador.
echo.
echo     DEJA ESTA VENTANA ABIERTA mientras uses la web.
echo     Si la cierras, la web deja de responder.
echo.
echo     Para parar el servidor: pulsa Ctrl+C, o cierra la ventana.
echo   ============================================================
echo.

start "" "http://localhost:8090"
node servidor.js 8090

echo.
echo   El servidor se ha detenido.
pause
