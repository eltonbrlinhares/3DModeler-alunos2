# edIFC-UnB / 3DModeler.js - Projeto do Curso

Aplicacao web para modelagem geometrica 3D, edicao IFC e geracao de malhas.
Esta versao do repositorio dos alunos inclui:

- `frontend/`: interface React + Three.js + Vite.
- `backend/`: API FastAPI + IfcOpenShell para criar, editar, salvar e exportar IFC.
- `mesh_server/`: scripts/apoio para servidor de malha quando usado na disciplina.
- `start.ps1` e `start.bat`: inicializacao do frontend e backend no Windows.

## Requisitos

- Node.js LTS e npm.
- Python 3.11+.
- Navegador moderno com WebAssembly.

## Inicio rapido no Windows

Na raiz do repositorio:

```powershell
.\start.ps1
```

Ou:

```bat
start.bat
```

Os scripts criam/validam `backend/.venv`, instalam dependencias Python,
instalam `frontend/node_modules` quando necessario e abrem:

- Frontend: http://localhost:5173
- Backend: http://localhost:8000
- Swagger/OpenAPI: http://localhost:8000/docs

## Execucao manual

Backend:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Se o backend estiver em outra URL:

```powershell
$env:VITE_IFC_API="http://localhost:8000"
npm run dev
```

## Funcionalidades principais

- Viewport 3D com Three.js, grid editavel, planos de trabalho e snaps.
- Desenho de curvas, superficies e malhas no frontend.
- Editor IFC integrado `edIFC-UnB` com niveis, grids, datums, paredes, lajes,
  colunas, vigas, selecao por raycast e gizmo local de translacao/rotacao.
- Snap de insercao nas intersecoes de planos/niveis/grids.
- Backend IFC para upload, criacao, edicao, validacao, save, download `.ifc`
  e exportacao `.glb`.

## Fluxo de trabalho dos alunos

```bash
git clone https://github.com/amirandaspace/3DModeler-alunos.git
cd 3DModeler-alunos
git checkout -b aluno/seu-nome
```

Depois de implementar:

```bash
git add .
git commit -m "descricao da implementacao"
git push origin aluno/seu-nome
```

Evite commitar arquivos gerados como `node_modules`, `frontend/dist`,
`backend/.venv` e `backend/storage`.

## Testes

Backend:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest tests\test_smoke.py
```

Frontend:

```powershell
cd frontend
npm run lint
npm run build
```

## Observacoes

- Coordenadas: Z-up, em metros, tanto no frontend quanto no backend IFC.
- O backend libera CORS para `localhost`/`127.0.0.1` durante desenvolvimento.
- Modelos salvos localmente ficam em `backend/storage`, que nao deve ser commitado.
