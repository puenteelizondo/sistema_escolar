@echo off
cd /d "%~dp0"
echo ESTO BORRA los alumnos, pagos, tickets y asistencias actuales y carga alumnos de ejemplo.
echo (Se conservan usuarios, cursos, planteles, instructores y la configuracion.)
set /p ok=Escribe SI para continuar: 
if /i not "%ok%"=="SI" exit /b
docker compose exec -T backend python -m app.reset_demo --si
pause
