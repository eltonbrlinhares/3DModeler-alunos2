@echo off
setlocal EnableExtensions EnableDelayedExpansion

title 3DModeler.js - Start Frontend + Backend

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

set "BACKEND_DIR=%ROOT_DIR%\backend"
set "FRONTEND_DIR=%ROOT_DIR%\frontend"
set "VENV_DIR=%BACKEND_DIR%\.venv"
set "PY_CMD="

if not exist "%BACKEND_DIR%" (
  echo [ERRO] Pasta backend nao encontrada: "%BACKEND_DIR%"
  exit /b 1
)

if not exist "%FRONTEND_DIR%" (
  echo [ERRO] Pasta frontend nao encontrada: "%FRONTEND_DIR%"
  exit /b 1
)

echo [INFO] Root: %ROOT_DIR%
echo [INFO] Backend: %BACKEND_DIR%
echo [INFO] Frontend: %FRONTEND_DIR%

REM --- Python command discovery ---
where py >nul 2>nul
if not errorlevel 1 (
  set "PY_CMD=py -3"
) else (
  where python >nul 2>nul
  if not errorlevel 1 (
    set "PY_CMD=python"
  )
)

if "%PY_CMD%"=="" (
  echo [ERRO] Python nao encontrado. Instale Python 3.11+ e habilite 'py' ou 'python' no PATH.
  exit /b 1
)

%PY_CMD% -c "import sys" >nul 2>nul
if errorlevel 1 (
  echo [ERRO] O comando Python encontrado no PATH nao esta funcional.
  echo [ERRO] Instale/repare o Python 3.11+ e tente novamente.
  exit /b 1
)

REM --- Backend setup (venv + deps) ---
if not exist "%VENV_DIR%\Scripts\python.exe" (
  echo [INFO] Criando ambiente virtual em backend\.venv ...
  %PY_CMD% -m venv "%VENV_DIR%"
  if errorlevel 1 (
    echo [ERRO] Falha ao criar venv.
    exit /b 1
  )
)

REM --- Validate venv health; recreate if broken ---
"%VENV_DIR%\Scripts\python.exe" -c "import sys" >nul 2>nul
if errorlevel 1 (
  echo [WARN] Ambiente virtual invalido/corrompido. Recriando backend\.venv ...
  rmdir /s /q "%VENV_DIR%"
  %PY_CMD% -m venv "%VENV_DIR%"
  if errorlevel 1 (
    echo [ERRO] Falha ao recriar venv.
    exit /b 1
  )
)

echo [INFO] Instalando/atualizando dependencias do backend...
"%VENV_DIR%\Scripts\python.exe" -m pip install --upgrade pip >nul
"%VENV_DIR%\Scripts\python.exe" -m pip install -r "%BACKEND_DIR%\requirements.txt"
if errorlevel 1 (
  echo [ERRO] Falha ao instalar dependencias do backend.
  exit /b 1
)

REM --- Frontend deps ---
if not exist "%FRONTEND_DIR%\node_modules" (
  echo [INFO] node_modules nao encontrado. Executando npm install no frontend...
  pushd "%FRONTEND_DIR%"
  call npm install
  set "NPM_EXIT=!ERRORLEVEL!"
  popd
  if not "!NPM_EXIT!"=="0" (
    echo [ERRO] Falha ao instalar dependencias do frontend.
    exit /b 1
  )
)

REM --- Start servers in separate terminals ---
echo [INFO] Iniciando backend em nova janela (http://localhost:8000) ...
start "3DModeler Backend" cmd /k "cd /d "%BACKEND_DIR%" && "%VENV_DIR%\Scripts\python.exe" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

echo [INFO] Iniciando frontend em nova janela (http://localhost:5173) ...
start "3DModeler Frontend" cmd /k "cd /d "%FRONTEND_DIR%" && npm run dev"

echo.
echo [OK] Comandos disparados.
echo [OK] Frontend: http://localhost:5173
echo [OK] Backend : http://localhost:8000
echo [OK] Swagger : http://localhost:8000/docs

endlocal
exit /b 0
