@echo off
cd /d "%~dp0"
docker compose up -d --build
echo.
echo Sistema listo en http://localhost:8080
start http://localhost:8080
pause
