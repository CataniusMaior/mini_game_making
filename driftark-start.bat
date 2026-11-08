@echo off
chcp 65001 >nul
rem ===================================================================
rem  DRIFT ARK を Docker で遊ぶ（Windows 用）
rem
rem  ダブルクリックすると:
rem    1. Docker Desktop が動いていなければ起動して待つ
rem    2. ゲームを最新の版に更新する（git pull）
rem    3. イメージを作り直す（docker compose build。変わった部分だけ作り直すので、2回目からは速い）
rem    4. ゲームのサーバーを起動して（docker compose up）、ブラウザで開く
rem  終わるときは、この画面で Ctrl+C を押す。
rem
rem  ポートなどの設定は compose.yaml ではなく compose.override.yaml に書く
rem  （例: compose.override.example.yaml）。compose.yaml を書き換えると、更新とぶつかることがある。
rem ===================================================================

rem git pull がこのファイル自体を書き換えることがある（cmd はバッチファイルを読みながら実行する）ので、
rem 一時フォルダにコピーしたものを実行する
if "%DRIFTARK_START_COPY%"=="1" goto main
set "DRIFTARK_HOME=%~dp0"
set "DRIFTARK_START_COPY=1"
copy /y "%~f0" "%TEMP%\driftark-start.bat" >nul
"%TEMP%\driftark-start.bat" %*
:main
set "DRIFTARK_START_COPY="
cd /d "%DRIFTARK_HOME%"
set "DRIFTARK_HOME="
setlocal

echo.
echo ===== DRIFT ARK (Docker) =====
echo.

where docker >nul 2>&1
if errorlevel 1 goto no_docker
docker compose version >nul 2>&1
if errorlevel 1 goto no_compose

rem --- 1. Docker Desktop -------------------------------------------------
docker info >nul 2>&1
if not errorlevel 1 goto docker_ready
echo Docker Desktop を起動しています（1〜2分かかることがあります）...
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
for /l %%i in (1,1,90) do (
  timeout /t 2 /nobreak >nul
  docker info >nul 2>&1 && goto docker_ready
)
echo.
echo Docker が起動しませんでした。Docker Desktop を起動してから、もう一度実行してください。
goto fail
:docker_ready

rem --- 2. 更新 ------------------------------------------------------------
if not exist ".git" goto no_git_folder
where git >nul 2>&1
if errorlevel 1 goto no_git
echo [1/3] 最新の版を取ってきています（git pull）...
git pull --ff-only
if errorlevel 1 goto pull_failed
goto updated
:pull_failed
echo.
echo 更新できませんでした。今の版のまま起動します。
echo   ネットワークを確かめてください。手元でファイルを書き換えていると、更新できないことがあります
echo   （設定は compose.override.yaml に書くと、更新とぶつかりません。README の「Docker で遊ぶ」）。
goto updated
:no_git_folder
echo [1/3] git で取ってきたフォルダではないので、更新はしません。
goto build
:no_git
echo [1/3] git が見つからないので、更新はしません（Git for Windows を入れると自動で更新できます）。
goto build
:updated
git log -1 --date=short --format="      今の版: %%cd %%h %%s"

rem --- 3. イメージ --------------------------------------------------------
:build
echo.
echo [2/3] イメージを作っています（docker compose build。初回は1〜2分、2回目からは変わった部分だけ）...
docker compose build
if errorlevel 1 goto build_failed

rem 前回の残り（ウィンドウを閉じて終わったときなど）を片付ける
docker compose down >nul 2>&1

rem --- 4. 起動 ------------------------------------------------------------
rem ゲームが開けるようになったら、ふだんのブラウザで開く（ポートは compose の設定から読む）。
rem 裏で待つだけで、5分で諦める
start "DRIFT ARK" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$port = 9410; try { $c = docker compose config --format json 2>$null | Out-String | ConvertFrom-Json; $p = $c.services.game.ports | Where-Object { $_.target -eq 9410 } | Select-Object -First 1; if ($p.published) { $port = $p.published } } catch {}; $u = 'http://localhost:' + $port + '/'; for ($i = 0; $i -lt 300; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $u | Out-Null; Start-Process $u; exit } catch { Start-Sleep -Seconds 1 } }"

echo.
echo [3/3] ゲームを起動します。準備ができるとブラウザが開きます
echo       （開かないときは http://localhost:9410/ を開いてください）。
echo       終わるときは、この画面で Ctrl+C を押してください。
echo.
docker compose up

docker compose down >nul 2>&1
echo.
echo 終わりました。
pause
exit /b 0

:no_docker
echo Docker が見つかりません。Docker Desktop をインストールして、起動しておいてください:
echo   https://www.docker.com/products/docker-desktop/
goto fail
:no_compose
echo "docker compose" が使えません。Docker Desktop を新しい版にしてください。
goto fail
:build_failed
echo.
echo イメージを作れませんでした。上のメッセージを確かめてください。
goto fail

:fail
echo.
pause
exit /b 1
