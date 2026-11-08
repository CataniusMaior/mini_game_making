@echo off
chcp 65001 >nul
rem DRIFT ARK のコンテナを止めて片付ける（driftark-start.bat のウィンドウを閉じて終わったときなど）。
cd /d "%~dp0"
echo DRIFT ARK のコンテナを止めて片付けます（docker compose down）...
docker compose down
echo.
pause
