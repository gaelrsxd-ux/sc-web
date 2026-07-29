@echo off
title  *** SERVIDOR DE LA WEB - NO CERRES ESTA VENTANA ***
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

cls
echo.
echo   ==================================================================
echo.
echo      SERVIDOR ARRANCANDO...
echo.
echo      Cuando aparezca "Web servida", abre el navegador y entra a:
echo.
echo               http://localhost:8090
echo.
echo      NO CIERRES ESTA VENTANA mientras uses la web.
echo      Esta ventana ES el servidor: si la cierras, la web deja de
echo      responder y veras "no se puede acceder".
echo      Puedes minimizarla. Para parar: cierra la ventana.
echo.
echo   ==================================================================
echo.

node servidor.js 8090

echo.
echo   El servidor se ha detenido. Doble clic en abrir-web para volver.
pause
