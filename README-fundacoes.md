# Módulo de Fundações — Sapata, Bloco e Radier

Documentação completa do módulo de fundações do `3DModeler-alunos2`
(branch `IFC`). Cobre os três elementos — **sapata**, **bloco sobre
estacas** e **radier** — do modelo de dados até a interface, com exemplos
de requisição prontos para copiar.

## Sumário

- [Visão geral](#visão-geral)
- [Sapata e bloco: como a geometria é montada](#sapata-e-bloco-como-a-geometria-é-montada)
- [Radier](#radier)
- [Referência da API](#referência-da-api)
- [Dimensionamento preliminar (sugestão, não aplica)](#dimensionamento-preliminar-sugestão-não-aplica)
- [Interface (IfcPanel)](#interface-ifcpanel)
- [Mapa de arquivos](#mapa-de-arquivos)
- [Exemplos testados](#exemplos-testados)
- [Limitações e próximos passos](#limitações-e-próximos-passos)

---

## Visão geral

| Elemento | Classe IFC | `predefined_type` | Forma |
|---|---|---|---|
| Sapata | `IfcFooting` | `PAD_FOOTING` | rodapé reto (opcional) → tronco de pirâmide → pedestal (opcional) |
| Bloco sobre estacas | `IfcFooting` | `PILE_CAP` | mesma pilha, mas sem afunilar (caixa reta) |
| Radier | `IfcSlab` | `BASESLAB` | contorno poligonal + espessura (reaproveita a laje) |

Sapata e bloco compartilham **a mesma função de geometria** — a diferença é
só se o topo do tronco é menor que a base (sapata, afunila) ou igual à base
(bloco, caixa reta). O bloco não desenha as estacas individualmente; nº e
diâmetro ficam como metadados (`Pset_FoundationCommon`) na entidade.

O radier não precisou de nada novo: é um `IfcSlab` comum com
`predefined_type="BASESLAB"`, desenhado com a mesma ferramenta de contorno
poligonal (clique os vértices, feche o polígono) que já existia para laje.

---

## Sapata e bloco: como a geometria é montada

Um tronco de pirâmide não é uma extrusão de perfil constante, então não
cabe no `geometry.add_profile_representation` (usado por parede, coluna,
viga e laje). A geometria é montada como **malha explícita** — vértices e
faces calculados à mão — via `ifcopenshell.api.geometry.add_mesh_representation`
(gera `IfcPolygonalFaceSet` em IFC4).

### Os até 3 estágios empilhados (de baixo para cima)

```
                    ┌──────┐
                    │      │  ← pedestal (prisma reto, opcional)
                    │      │     pedestal_width × pedestal_length × pedestal_height
                   ╱└──────┘╲
                  ╱          ╲  ← tronco de pirâmide
                 ╱            ╲    base_width×base_length → top_width×top_length
                ╱              ╲   altura = height
               └────────────────┘
               │                │ ← rodapé reto (opcional)
               └────────────────┘    base_width × base_length × base_height
```

1. **Rodapé reto** (opcional, `base_height`): caixa de paredes verticais,
   mesma planta da base (`base_width × base_length`). É o "degrau" que
   aparece antes do afunilamento começar em desenhos técnicos de sapata.
   `base_height = 0` (padrão) omite esse estágio inteiramente — o tronco
   começa direto do chão, comportamento idêntico a antes desse campo
   existir.
2. **Tronco de pirâmide**: afunila de `base_width × base_length` até
   `top_width × top_length` ao longo de `height`. Cada face lateral é um
   trapézio plano (é uma propriedade geométrica do tronco: como topo e
   base são retângulos concêntricos e paralelos, cada face lateral fica
   inteiramente num só plano). Se `top_width == base_width` e
   `top_length == base_length`, o tronco degenera numa **caixa reta** — é
   assim que o **bloco** é modelado, reaproveitando a mesma função.
3. **Pedestal reto** (opcional, `pedestal_height`): prisma reto em cima do
   tronco. Por padrão (`pedestal_width`/`pedestal_length` omitidos), tem o
   **mesmo tamanho do topo do tronco** — solda direto, sem degrau
   horizontal. Se você informar um pedestal mais estreito que o topo do
   tronco, sobra uma **aba/moldura horizontal** ao redor da base do
   pedestal (4 faces trapezoidais extras, todas planas por estarem numa
   única cota Z).

### A malha, passo a passo

`_rect(width, length, z)` gera os 4 cantos de um retângulo centrado em
`(0,0)`, num plano `z` — é o único bloco de montagem usado para toda a
malha (base, topo do rodapé, topo do tronco, base/topo do pedestal).

`_footing_mesh(...)` monta a lista de vértices e a lista de faces
(cada face é uma lista de 4 índices, formando um quadrilátero — a API do
IfcOpenShell aceita faces com qualquer número de lados, mas o preview em
Three.js tri-angula cada face em 2 triângulos: `[a,b,c,a,c,d]`):

1. face da base (invertida, `[0,3,2,1]`, pra normal apontar pra baixo)
2. se houver rodapé: 4 faces verticais retas (laterais do rodapé)
3. 4 faces do tronco (trapézios afunilando — usa o topo do rodapé, ou a
   base, como referência inferior)
4. se não houver pedestal: face do topo (encerra aqui)
5. se houver pedestal, e ele for mais estreito que o topo do tronco: 4
   faces de aba (a "moldura")
6. 4 faces laterais retas do pedestal
7. face do topo do pedestal

O **frontend replica exatamente essa lógica** em
`frontend/src/ifc/geometry/footingBox.js` (`footingMesh()`), já
triangulada para `THREE.BufferGeometry` — por isso o preview ao arrastar o
mouse bate pixel a pixel com o resultado gravado no IFC.

### Otimização automática do IfcOpenShell

Quando o pedestal tem o mesmo tamanho do topo do tronco (caso padrão, sem
aba), a malha enviada tem vértices duplicados nessa costura (o topo do
tronco e a base do pedestal ocupam as mesmas coordenadas). O IfcOpenShell
solda esses vértices coincidentes ao processar a tesselação — confirmado
num teste real: uma malha de 16 vértices enviados virou 12 no
`IfcPolygonalFaceSet` final.

---

## Radier

Sem geometria nova: `create_slab()` ganhou um parâmetro opcional
`predefined_type`. Passando `"BASESLAB"`, o `IfcSlab` resultante é
semanticamente um radier — a extrusão continua sendo o polígono desenhado
(mínimo 3 pontos, clicados nas interseções de grid) × espessura, exatamente
como uma laje comum (`predefined_type=None`/`"FLOOR"`).

No `IfcPanel`, ao selecionar "Laje" no formulário, aparece um rádio
Laje/Radier que só troca esse campo.

---

## Referência da API

Todas as rotas de fundação estão sob o mesmo prefixo de geometria das
demais (`/ifc/models/{model_id}/geometry/...`); o dimensionamento
preliminar é a exceção — não depende de modelo (`/design/...`).

### `POST /ifc/models/{model_id}/geometry/footing`

Cria a sapata ou o bloco (o `IfcFooting`).

**Corpo** (`CreateFootingRequest`):

| Campo | Tipo | Padrão | Observação |
|---|---|---|---|
| `name` | `str \| null` | `null` | |
| `predefined_type` | `str` | `"PAD_FOOTING"` | `"PAD_FOOTING"` (sapata) ou `"PILE_CAP"` (bloco) |
| `base_width`, `base_length` | `float > 0` | `1.5` | planta da base (o retângulo mais largo) |
| `base_height` | `float ≥ 0` | `0.0` | altura do rodapé reto; `0` = sem rodapé |
| `top_width`, `top_length` | `float > 0 \| null` | `null` | `null` = igual à base (caixa reta, bloco). Menor que a base nas duas direções → tronco de pirâmide (sapata) |
| `height` | `float > 0` | `0.5` | altura do tronco |
| `pedestal_width`, `pedestal_length` | `float > 0 \| null` | `null` | `null` = igual ao topo do tronco (sem aba) |
| `pedestal_height` | `float ≥ 0` | `0.0` | `0` = sem pedestal |
| `position` | `[x,y,z]` | `[0,0,0]` | face **inferior**, centrada em planta (base do rodapé, ou do tronco se `base_height=0`) |
| `rotation_z` | `float` (rad) | `0.0` | |
| `storey_guid` | `str \| null` | `null` | |
| `pile_count` | `int > 0 \| null` | `null` | só bloco; grava em `Pset_FoundationCommon`, não afeta a geometria |
| `pile_diameter` | `float > 0 \| null` | `null` | idem |

**Resposta**: `{"ok": true, "guid": "...", "id": <int>}`

### `POST /ifc/models/{model_id}/geometry/slab` (radier)

Mesmo endpoint da laje — `CreateSlabRequest` ganhou `predefined_type:
str | null` (`"BASESLAB"` para radier, `null`/`"FLOOR"` para laje comum).
Demais campos (`polyline`, `thickness`, `position`, etc.) inalterados.

---

## Dimensionamento preliminar (sugestão, não aplica)

Duas rotas **stateless** (sem `model_id`) que calculam uma geometria
recomendada a partir de carga/solo/estaca. **Elas não criam nada no modelo
e o frontend não aplica o resultado nos campos automaticamente** — o botão
"Calcular sugestão" só exibe o texto; quem decide o que digitar em
base/topo/pedestal é a pessoa usando o app.

### `POST /design/foundation/pad-footing`

Método rígido/bielas simplificado (base NBR 6122): a partir de `N` (carga
de serviço, kN) e `σadm` do solo (kPa), calcula a área necessária (+5% de
margem para peso próprio), resolve os balanços iguais nas duas direções
`(L−a)/2 = (B−b)/2` e define a altura pelo critério de rigidez
(`altura ≥ balanço` → sapata rígida).

```json
// requisição
{"axial_load_kn": 800, "column_width": 0.3, "column_depth": 0.3, "soil_bearing_kpa": 200}
// resposta
{"width": 2.05, "length": 2.05, "height": 0.9, "area": 4.2, "cantilever": 0.87,
 "rigid": true, "notes": ["..."]}
```

### `POST /design/foundation/pile-cap`

Calcula nº de estacas (`N / capacidade_estaca`, arredondado pra cima) e
escolhe um arranjo entre 6 padrões cadastrados (1 a 6 estacas — linha,
triangular, quadrado, retangular), com espaçamento `2,5×Ø` entre eixos e
borda `1×Ø`; altura pelo método de bielas (ângulo ~45–55° entre a face do
pilar e o eixo da estaca mais afastada).

```json
// requisição
{"axial_load_kn": 1500, "pile_capacity_kn": 300, "pile_diameter": 0.4}
// resposta
{"pile_count": 5, "width": 2.2, "length": 2.2, "height": 0.85,
 "pile_spacing": 1.0, "edge_distance": 0.4, "arrangement": [[-0.5,-0.5], ...],
 "notes": ["..."]}
```

⚠️ **Estimativas preliminares.** Cada resposta traz `notes` avisando isso.
Não substituem a verificação completa de punção (NBR 6118, 19.5), flexão,
bielas e tirantes (NBR 6118, 22), nem o memorial assinado por profissional
habilitado, exigidos pela NBR 6122 antes da execução.

---

## Interface (IfcPanel)

No dropdown "Novo elemento", escolher **"Fundação (sapata/bloco)"** abre um
formulário próprio (não usa a renderização genérica de campos — os campos
mudam de acordo com o tipo escolhido):

1. **Tipo**: rádio Sapata / Bloco (estacas)
2. **Geometria**: base largura/comprimento, rodapé (altura), altura do
   tronco; topo largura/comprimento aparece só para Sapata (Bloco força
   topo = base)
3. Se Bloco: nº de estacas, Ø da estaca (metadados, `Pset_FoundationCommon`)
4. **Pedestal** (checkbox): se marcado, mostra largura/comprimento/altura
   do pedestal
5. **Sugestão de dimensionamento (não aplica)**: N, σadm do solo (ou
   capacidade da estaca), dimensões do pilar → botão "Calcular sugestão" →
   texto informativo, sem alterar os campos acima

A inserção em si é de um clique só (diferente do pilar, que arrasta a
altura com o mouse): clique numa interseção de grid no nível ativo e a
fundação é criada com a face inferior `altura total` abaixo do ponto
clicado (o topo do pedestal, ou do tronco se não houver pedestal, encosta
no nível — mesma convenção do `axisRef="top"` da laje).

Para radier: usar "Laje" no dropdown e marcar o rádio "Radier" — o fluxo de
desenho (clicar o contorno, fechar com 1º ponto/duplo-clique/Enter) é
idêntico ao de laje comum.

---

## Mapa de arquivos

```
backend/
  app/services/geometry_service.py    _rect, _footing_mesh, create_footing
                                        create_slab (predefined_type)
  app/services/foundation_design_service.py
                                        suggest_pad_footing, suggest_pile_cap
  app/models/schemas.py                CreateFootingRequest, CreateSlabRequest,
                                        SuggestPadFootingRequest, SuggestPileCapRequest
  app/api/geometry.py                  POST /geometry/footing, /geometry/slab
  app/api/design.py                    POST /design/foundation/pad-footing, /pile-cap
  app/main.py                          registra o router design

frontend/
  src/ifc/geometry/footingBox.js       footingMesh() — preview Three.js
  src/ifc/tools/footingTool.js         footingTool — máquina de estados de inserção
  src/ifc/tools/slabTool.js            + predefinedType (radier)
  src/ifc/tools/index.js               registra footingTool
  src/services/ifcApi.js               createFooting, suggestPadFooting, suggestPileCap
  src/components/IfcPanel.jsx          formulário de Fundação + rádio Laje/Radier
```

---

## Exemplos testados

Todos os exemplos abaixo foram executados de verdade contra o backend
(`curl` + `uvicorn`), não são só ilustrativos.

**Sapata no estilo clássico** (rodapé reto + tronco afunilando liso até o
pedestal, sem degrau):

```bash
curl -X POST http://127.0.0.1:8000/ifc/models/$MODEL_ID/geometry/footing \
  -H "Content-Type: application/json" \
  -d '{
    "name": "F1", "predefined_type": "PAD_FOOTING",
    "base_width": 2.0, "base_length": 2.0, "base_height": 0.15,
    "top_width": 0.6, "top_length": 0.6, "height": 0.4,
    "pedestal_width": 0.6, "pedestal_length": 0.6, "pedestal_height": 0.5,
    "position": [0, 0, -1.05]
  }'
```
→ malha final: 16 vértices (soldados), 28 triângulos, bounding box de
altura 1,05 m (0,15 + 0,4 + 0,5) — confirmado via `GET /mesh/{guid}`.

**Bloco sobre estacas** (caixa reta + pedestal, 5 estacas):

```bash
curl -X POST http://127.0.0.1:8000/ifc/models/$MODEL_ID/geometry/footing \
  -H "Content-Type: application/json" \
  -d '{
    "name": "B1", "predefined_type": "PILE_CAP",
    "base_width": 2.2, "base_length": 2.2, "height": 0.85,
    "pedestal_width": 0.5, "pedestal_length": 0.5, "pedestal_height": 0.6,
    "position": [10, 0, -0.85], "pile_count": 5, "pile_diameter": 0.4
  }'
```

**Radier**:

```bash
curl -X POST http://127.0.0.1:8000/ifc/models/$MODEL_ID/geometry/slab \
  -H "Content-Type: application/json" \
  -d '{
    "name": "R1", "length": 6, "width": 6, "thickness": 0.3,
    "predefined_type": "BASESLAB", "position": [0, 10, 0]
  }'
```

---

## Limitações e próximos passos

Fora do escopo até agora — deixados de propósito para uma próxima rodada:

- **Edição de dimensões** da fundação já criada (o endpoint `dimensions`
  hoje só existe para parede; precisaria de um `edit_footing_dimensions`
  que reconstrua a malha, no mesmo padrão de `edit_wall_dimensions`).
- **Posicionamento automático sob o pilar selecionado** — hoje a inserção é
  sempre por clique manual numa interseção de grid, igual à coluna; para
  automatizar, seria preciso ler o `ObjectPlacement` do `IfcColumn` já
  modelado.
- **Verificação de punção** (perímetro crítico a `d/2` da face do
  pilar/estaca) como uma segunda etapa do dimensionamento preliminar, além
  da geometria recomendada.
- **Desenho individual das estacas** do bloco (hoje só ficam como
  metadados/Pset, não como geometria) — deliberadamente fora de escopo por
  custo de geometria vs. valor no LOD deste app.
