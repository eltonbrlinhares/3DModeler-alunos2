# Backend - 3DModeler.js

Backend em Python para edicao de modelos IFC usando FastAPI e IfcOpenShell. A API mantem modelos em memoria durante a execucao do processo e salva arquivos IFC em `backend/storage/`.

## Stack

- Python 3.11+
- FastAPI + Uvicorn
- IfcOpenShell
- Pydantic v2
- NumPy
- pytest + httpx para testes

## Como Executar

```powershell
cd backend

pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

URLs uteis:

- Health: `http://localhopython -m venv .venv
.\.venv\Scripts\Activate.ps1st:8000/health`
- Swagger/OpenAPI: `http://localhost:8000/docs`

O CORS esta liberado para qualquer porta de `localhost` e `127.0.0.1`, para funcionar com Vite em `5173`, `5174` etc.

## Testes

```powershell
cd backend
pytest
```

Os testes de smoke cobrem criacao de modelo, geometria parametrica, tessellacao, placement, undo/redo, validacao, GLB, niveis e grids.

## API Principal

### Saude

| Metodo | Rota | Descricao |
| --- | --- | --- |
| `GET` | `/health` | Retorna `{ "status": "ok" }`. |

### Modelos IFC

| Metodo | Rota | Descricao |
| --- | --- | --- |
| `GET` | `/ifc/models` | Lista modelos abertos no processo. |
| `POST` | `/ifc/models` | Cria um modelo IFC4 em branco. Body: `{ "name": "editor" }`. |
| `POST` | `/ifc/models/upload` | Faz upload de um arquivo `.ifc`. |
| `GET` | `/ifc/models/{model_id}/summary` | Retorna schema, dirty flag, total de entidades e contagem por tipo. |
| `GET` | `/ifc/models/{model_id}/entities?type=IfcProduct` | Lista entidades de um tipo IFC. |
| `GET` | `/ifc/models/{model_id}/entity/{guid}` | Retorna atributos e property sets de uma entidade. |
| `POST` | `/ifc/models/{model_id}/save` | Valida e salva em `storage/{model_id}.ifc`. |
| `GET` | `/ifc/models/{model_id}/download` | Baixa o arquivo IFC salvo. |
| `GET` | `/ifc/models/{model_id}/export/glb` | Exporta GLB a partir do IFC. |
| `DELETE` | `/ifc/models/{model_id}` | Fecha/remove o modelo do registro em memoria. |

### Geometria Parametrica

Todas as coordenadas usam a convencao IFC: Z-up, metros. `rotation_z` usa radianos.

| Metodo | Rota | Descricao |
| --- | --- | --- |
| `POST` | `/ifc/models/{model_id}/geometry/wall` | Cria `IfcWall` com comprimento, altura e espessura. |
| `POST` | `/ifc/models/{model_id}/geometry/slab` | Cria `IfcSlab` com comprimento, largura e espessura. |
| `POST` | `/ifc/models/{model_id}/geometry/column` | Cria `IfcColumn` com largura, profundidade e altura. |
| `POST` | `/ifc/models/{model_id}/geometry/beam` | Cria `IfcBeam` horizontal, com comprimento em X e secao Y/Z. |
| `POST` | `/ifc/models/{model_id}/geometry/placement` | Edita placement absoluto ou aplica transformacao relativa. |
| `POST` | `/ifc/models/{model_id}/geometry/dimensions` | Regenera dimensoes de parede. |

Exemplo:

```json
{
  "name": "W1",
  "length": 5.0,
  "height": 3.0,
  "thickness": 0.2,
  "position": [0.0, 0.0, 0.0],
  "rotation_z": 0.0,
  "storey_guid": null
}
```

`placement` aceita uma destas formas:

- `matrix`: matriz 4x4 plana com 16 valores;
- `position` e opcionalmente `rotation_z`;
- `translate` e/ou `rotate_z` para deltas relativos, usados pelo gizmo do frontend.

### Edicao de Dados

| Metodo | Rota | Descricao |
| --- | --- | --- |
| `POST` | `/ifc/models/{model_id}/edit/attributes` | Edita atributos IFC via `ifcopenshell.api`. |
| `POST` | `/ifc/models/{model_id}/edit/pset` | Cria/edita property set. |
| `POST` | `/ifc/models/{model_id}/edit/wall` | Rota legada para criar parede simples. |
| `POST` | `/ifc/models/{model_id}/edit/delete` | Remove produto por GUID. |

### Estrutura Espacial, Niveis e Grids

| Metodo | Rota | Descricao |
| --- | --- | --- |
| `POST` | `/ifc/models/{model_id}/spatial/bootstrap` | Cria Site, Building e storeys iniciais. |
| `POST` | `/ifc/models/{model_id}/spatial/assign` | Associa um produto a um container espacial. |
| `GET` | `/ifc/models/{model_id}/spatial/tree` | Retorna arvore espacial do projeto. |
| `GET` | `/ifc/models/{model_id}/levels` | Lista `IfcBuildingStorey` como niveis/datum. |
| `POST` | `/ifc/models/{model_id}/levels` | Cria nivel. |
| `PATCH` | `/ifc/models/{model_id}/levels/{guid}` | Edita nome e/ou elevacao. |
| `DELETE` | `/ifc/models/{model_id}/levels/{guid}?force=false` | Remove nivel; retorna 409 se contem elementos sem `force=true`. |
| `GET` | `/ifc/models/{model_id}/grids` | Lista grids IFC. |
| `POST` | `/ifc/models/{model_id}/grids` | Cria `IfcGrid` com eixos U/V. |
| `DELETE` | `/ifc/models/{model_id}/grids/{guid}` | Remove grid. |

### Historico, Validacao e Malha

| Metodo | Rota | Descricao |
| --- | --- | --- |
| `POST` | `/ifc/models/{model_id}/history/undo` | Restaura snapshot anterior. |
| `POST` | `/ifc/models/{model_id}/history/redo` | Reaplica snapshot. |
| `GET` | `/ifc/models/{model_id}/history` | Retorna profundidade das pilhas undo/redo. |
| `GET` | `/ifc/models/{model_id}/validate` | Retorna `{ valid, issues }`. |
| `GET` | `/ifc/models/{model_id}/mesh` | Tessella todos os produtos IFC para Three.js. |
| `GET` | `/ifc/models/{model_id}/mesh/{guid}` | Retessella um produto especifico. |

## Formato da Tessellacao

As rotas de mesh retornam produtos com vertices, indices e bbox, prontos para conversao em `THREE.BufferGeometry` pelo frontend.

```json
{
  "products": [
    {
      "guid": "...",
      "type": "IfcWall",
      "name": "W1",
      "vertices": [0, 0, 0],
      "indices": [0, 1, 2],
      "bbox": { "min": [0, 0, 0], "max": [5, 0.2, 3] }
    }
  ],
  "bbox": { "min": [0, 0, 0], "max": [5, 0.2, 3] }
}
```

## Estrutura

```text
backend/
  app/
    main.py              entrada FastAPI e CORS
    config.py            paths e schema IFC
    api/                 rotas REST por dominio
    models/schemas.py    contratos Pydantic
    services/
      ifc_service.py     registro em memoria, save, consultas
      geometry_service.py criacao/edicao de geometria IFC
      spatial_service.py Site/Building/Storey e niveis
      grid_service.py    IfcGrid e eixos
      mesh_service.py    tessellacao via IfcOpenShell
      history_service.py undo/redo por snapshots
      validate_service.py validacao leve
      export_service.py  export GLB
  tests/
    test_smoke.py
  requirements.txt
```
