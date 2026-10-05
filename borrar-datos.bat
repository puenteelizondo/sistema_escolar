@echo off
cd /d "%~dp0"
echo ESTO BORRA TODOS LOS DATOS (alumnos, pagos, tickets, respaldos).
set /p ok=Escribe SI para continuar: 
if /i not "%ok%"=="SI" exit /b
docker compose down -v
pause
