# Inicia o backend (FastAPI/uvicorn) e o frontend (Vite) em janelas separadas.
# Equivalente a start.bat, mas para PowerShell.
# Uso: .\start.ps1

$Root     = $PSScriptRoot
$Backend  = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$VenvDir  = Join-Path $Backend ".venv"
$VenvPy   = Join-Path $VenvDir "Scripts\python.exe"

# ── Valida pastas ─────────────────────────────────────────────────────────────
if (-not (Test-Path $Backend)) {
    Write-Error "[ERRO] Pasta backend nao encontrada: $Backend"
    exit 1
}
if (-not (Test-Path $Frontend)) {
    Write-Error "[ERRO] Pasta frontend nao encontrada: $Frontend"
    exit 1
}

Write-Host "[INFO] Root:     $Root"
Write-Host "[INFO] Backend:  $Backend"
Write-Host "[INFO] Frontend: $Frontend"

# ── Descobre Python (py -3 tem prioridade sobre python) ───────────────────────
$PyCmds = @("py -3", "python")
$PyExe  = $null
foreach ($cmd in $PyCmds) {
    $bin = ($cmd -split ' ')[0]
    if (Get-Command $bin -ErrorAction SilentlyContinue) {
        & $bin ($cmd -split ' ')[1..99] -c "import sys" 2>$null
        if ($LASTEXITCODE -eq 0) { $PyExe = $cmd; break }
    }
}
if (-not $PyExe) {
    Write-Error "[ERRO] Python nao encontrado. Instale Python 3.11+ e habilite 'py' ou 'python' no PATH."
    exit 1
}

# ── Cria venv se ausente ──────────────────────────────────────────────────────
if (-not (Test-Path $VenvPy)) {
    Write-Host "[INFO] Criando ambiente virtual em backend\.venv ..."
    Invoke-Expression "$PyExe -m venv `"$VenvDir`""
    if ($LASTEXITCODE -ne 0) { Write-Error "[ERRO] Falha ao criar venv."; exit 1 }
}

# ── Valida saude do venv; recria se corrompido ────────────────────────────────
& $VenvPy -c "import sys" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[WARN] Ambiente virtual invalido/corrompido. Recriando backend\.venv ..."
    Remove-Item $VenvDir -Recurse -Force
    Invoke-Expression "$PyExe -m venv `"$VenvDir`""
    if ($LASTEXITCODE -ne 0) { Write-Error "[ERRO] Falha ao recriar venv."; exit 1 }
}

# ── Instala/atualiza dependencias do backend ──────────────────────────────────
Write-Host "[INFO] Instalando/atualizando dependencias do backend..."
& $VenvPy -m pip install --upgrade pip | Out-Null
& $VenvPy -m pip install -r "$Backend\requirements.txt"
if ($LASTEXITCODE -ne 0) { Write-Error "[ERRO] Falha ao instalar dependencias do backend."; exit 1 }

# ── Instala dependencias do frontend se ausentes ──────────────────────────────
if (-not (Test-Path (Join-Path $Frontend "node_modules"))) {
    Write-Host "[INFO] node_modules nao encontrado. Executando npm install no frontend..."
    Push-Location $Frontend
    npm install
    $npmExit = $LASTEXITCODE
    Pop-Location
    if ($npmExit -ne 0) { Write-Error "[ERRO] Falha ao instalar dependencias do frontend."; exit 1 }
}

# ── Inicia servidores em janelas separadas ────────────────────────────────────
Write-Host "[INFO] Iniciando backend em nova janela (http://localhost:8000) ..."
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "Set-Location '$Backend'; & '$VenvPy' -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000" `
    -WindowStyle Normal

Write-Host "[INFO] Iniciando frontend em nova janela (http://localhost:5173) ..."
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "Set-Location '$Frontend'; npm run dev" `
    -WindowStyle Normal

Write-Host ""
Write-Host "[OK] Comandos disparados."
Write-Host "[OK] Frontend: http://localhost:5173"
Write-Host "[OK] Backend : http://localhost:8000"
Write-Host "[OK] Swagger : http://localhost:8000/docs"
