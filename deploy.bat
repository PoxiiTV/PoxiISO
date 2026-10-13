@echo off
cd /d "%~dp0"
if exist deploy-hosting rmdir /s /q deploy-hosting
mkdir deploy-hosting
xcopy /e /i /y release deploy-hosting >nul
echo Listo en deploy-hosting
