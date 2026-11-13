@echo off
rem Avvia il prototipo Gherardi - Area ordini in locale
cd /d "%~dp0"
start "" http://localhost:5173/
python -m http.server 5173 --bind 127.0.0.1
