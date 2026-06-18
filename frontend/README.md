# Frontend - 3DModeler.js

Aplicacao React/Vite para modelagem 3D no navegador. A interface combina um canvas Three.js para desenho geometrico, OpenCascade.js para solidos B-Rep, `mesh.wasm` para geracao de malhas e um painel IFC integrado ao backend FastAPI.

## Stack

| Tecnologia | Papel |
| --- | --- |
| React 19 | UI e estado da aplicacao |
| Vite 6 | Dev server, build e preview |
| Three.js 0.177 | Viewport 3D, camera, controles, raycast e geometria visual |
| OpenCascade.js 1.1 | Kernel CAD/B-Rep em WebAssembly |
| mesh.js + mesh.wasm | Geracao de malhas 2D, superficie e volume no navegador |
| ESLint 9 | Analise estatica |

## Como Executar

```powershell
cd frontend
npm install
npm run dev
```

Disponivel em `http://localhost:5173`.

Scripts:

```powershell
npm run dev
npm run build
npm run preview
npm run lint
```

O backend IFC padrao e `http://localhost:8000`. Para apontar para outra URL:

```powershell
$env:VITE_IFC_API="http://localhost:8000"
npm run dev
```

## Headers WASM

`vite.config.js` injeta os headers abaixo em `server` e `preview`, necessarios para contexto isolado e `SharedArrayBuffer`:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Em producao, o servidor HTTP tambem precisa enviar esses headers.

## Fluxos Principais

### Sketching, Superficies e Malha FEM

1. Selecionar ferramenta: linha, polilinha, arco ou spline.
2. Desenhar no plano de trabalho `XY`, `XZ` ou `YZ`.
3. Selecionar curvas e gerar superficie (`SF`).
4. Ajustar subdivisoes de curvas (`SBD`).
5. Selecionar uma superficie e gerar malha (`MSH`).
6. Exportar/importar o estado do canvas em JSON (`EXP`/`IMP`).

Curvas sao construidas em `src/curves/NURBSBuilders.js`. Superficies sao geradas em `src/components/canvas/generateSurface.js` usando funcoes do editor de superficies OCCT.

### Editor Volumetrico OCCT

O botao `3D` abre `VolumeEditorUI`, que inicializa OpenCascade.js e usa sketches do canvas para gerar solidos:

- extrusao;
- revolucao em torno de X, Y ou Z;
- loft entre sketches;
- booleanas: uniao, subtracao e intersecao;
- undo/redo;
- export STEP.

Implementacao principal:

- `src/components/VolumeEditorUI.jsx`
- `src/occt/VolumeEditor.js`
- `src/occt/VolumeEditorAdvanced.js`
- `src/occt/CurveEditor.js`
- `src/occt/SurfaceEditor.js`

### Editor IFC

O botao `IFC` abre `IfcPanel`, que conversa com o backend por `src/services/ifcApi.js` e renderiza os produtos IFC na mesma cena Three.js.

Recursos atuais:

- criar modelo IFC novo ou fazer upload `.ifc`;
- bootstrap de Site, Building e Storey;
- criar parede, laje, coluna e viga;
- listar e selecionar elementos por lista ou raycast;
- mover e girar produtos com `TransformControls`;
- editar dimensoes de parede e renomear elementos;
- criar/editar/remover niveis;
- criar/remover grids;
- undo/redo pelo backend;
- salvar, baixar `.ifc` e exportar `.glb`.

Modulos IFC:

- `src/components/IfcPanel.jsx`
- `src/services/ifcApi.js`
- `src/ifc/IfcSceneManager.js`
- `src/ifc/IfcDatumManager.js`
- `src/ifc/ifcMeshLoader.js`

## Ferramentas da Toolbar

| Botao | Acao |
| --- | --- |
| `select` | Selecionar objetos e usar controles de transformacao. |
| `L` | Linha de 2 pontos. |
| `PL` | Polilinha com N pontos; finaliza com Enter ou duplo clique. |
| `A` | Arco por 3 pontos. |
| `SP` | Spline interpolante; finaliza com Enter ou duplo clique. |
| `SF` | Gera superficie a partir de 2 ou mais curvas selecionadas. |
| `SBD` | Configura subdivisoes de curvas selecionadas. |
| `MSH` | Gera malha FEM na superficie selecionada. |
| `3D` | Abre/fecha editor volumetrico OCCT. |
| `EXP` | Exporta curvas, superficies e malhas do canvas para JSON. |
| `IMP` | Importa JSON salvo pelo canvas. |
| `IFC` | Abre editor IFC integrado ao backend. |

## Malha em WebAssembly

`src/mesh/MeshModule.js` carrega `/mesh.js`, inicializa `mesh.wasm` e expoe uma API assincrona:

- `msh2d`: `bilinear`, `collbilinear`, `loft`, `trilinear`, `contraction`, `quadbound`, `shape`, `seam`, `template`;
- `mshsurf`: `bilinear`, `collbilinear`, `loft`, `trilinear`, `template`, `edge2d`, `edge`;
- `msh3d`: `extrusion`, `sweeping`, `mapp`, `curvesweep`, `template`.

`src/mesh/useMesh.js` fornece um hook React para chamadas genericas no formato `lib.algoritmo`, por exemplo `mshsurf.template`.

## Arquitetura de Componentes

```text
App
  ThreeGrid
    Toolbar
    ModeIndicator
    ViewCube
    CoordsDisplay
    CurveSubdivDialog
    SurfaceMeshPanel
    VolumeEditorUI
    IfcPanel
    ThreeCanvas
```

`ThreeGrid.jsx` coordena o estado da UI. `ThreeCanvas.jsx` expoe uma API imperativa via `forwardRef`/`useImperativeHandle`, usada por toolbar, editor volumetrico e painel IFC.

Metodos importantes do canvas:

- `setActiveTool`, `setCenter`, `setPlane`;
- `setGridVisible`, `setGridSize`, `setGridSnap`;
- `setTranslationSnap`, `setRotationSnap`, `setWorkPlaneControls`;
- `generateSurfaceFromSelection`;
- `applySubdivisions`, `getSelectedSubdivParams`;
- `meshSurface`, `getSurfaceBoundarySubdivs`;
- `exportModel`, `importModel`;
- `getScene`, `getCamera`, `getPivot`, `getOrbitControls`.

## Estrutura

```text
frontend/
  public/
    mesh.js              glue Emscripten
    mesh.wasm            binario de malha, quando gerado/copiado
  src/
    App.jsx
    ThreeGrid.jsx
    components/
      ThreeCanvas.jsx
      Toolbar.jsx
      CoordsDisplay.jsx
      ViewCube.jsx
      ModeIndicator.jsx
      CurveSubdivDialog.jsx
      SurfaceMeshPanel.jsx
      VolumeEditorUI.jsx
      IfcPanel.jsx
      canvas/
        sceneSetup.js
        curveUtils.js
        surfaceOrderUtils.js
        generateSurface.js
        meshSurface.js
        femUtils.js
        modelIO.js
    curves/
      NURBSBuilders.js
    ifc/
      IfcSceneManager.js
      IfcDatumManager.js
      ifcMeshLoader.js
    mesh/
      MeshModule.js
      useMesh.js
    occt/
      CurveEditor.js
      SurfaceEditor.js
      VolumeEditor.js
      VolumeEditorAdvanced.js
    services/
      ifcApi.js
  package.json
  vite.config.js
```

## Convencoes

- O viewport e o backend IFC usam Z-up e metros.
- `camera.up = (0, 0, 1)`.
- O plano inicial e `XY`.
- `rotation_z` enviado ao backend usa radianos.
- A API IFC do frontend e configurada por `VITE_IFC_API`.
