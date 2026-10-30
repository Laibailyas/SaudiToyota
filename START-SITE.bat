@echo off
REM Starts the Saudi Toyota site WITH its backend (forms, dashboard, registrations) on this computer.
REM Double-click this file, keep the black window open, and use the pages it opens.
cd /d "%~dp0"
if "%ADMIN_PASSWORD%"=="" set ADMIN_PASSWORD=ChangeMe-2026-Admin
echo.
echo  Site:      http://127.0.0.1:3000/registration.html
echo  Dashboard: http://127.0.0.1:3000/dashboard   (user: admin  password: %ADMIN_PASSWORD%)
echo.
start "" "http://127.0.0.1:3000/registration.html"
python server.py
if errorlevel 1 py server.py
pause
