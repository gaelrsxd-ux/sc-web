@echo off
title  *** SERVIDOR DE LA WEB - NO CERRES ESTA VENTANA ***
cd /d "%~dp0"

REM Finales de linea CRLF a proposito: un .bat con finales de Unix rompe los
REM bloques if(...) y la ventana se cierra al instante sin decir nada.
REM Por eso tampoco se usan parentesis multilinea aqui.

where node >nul 2>nul
if errorlevel 1 goto sinnode

cls
echo.
echo   ==================================================================
echo.
echo      SERVIDOR DE LA WEB
echo.
echo      Cuando abajo aparezca  Web servida en...  abre el navegador y
echo      entra a esta direccion:
echo.
echo               http://localhost:8090
echo.
echo      NO CIERRES ESTA VENTANA mientras uses la web.
echo      Esta ventana ES el servidor. Puedes minimizarla.
echo.
echo   ==================================================================
echo.

node servidor.js 8090

echo.
echo   El servidor se detuvo. Doble clic en abrir-web para volver a empezar.
pause
exit /b 0

:sinnode
echo.
echo   No encuentro Node.js en este equipo.
echo   Instalalo desde https://nodejs.org y vuelve a abrir este archivo.
echo.
pause
exit /b 1
