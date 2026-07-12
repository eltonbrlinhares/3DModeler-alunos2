# Edição paramétrica em vivo (coluna, viga, fundação, laje)

Agora dá pra mudar as propriedades de um pilar, viga, fundação ou laje **já
inserido** sem apagar e recriar o elemento. Basta selecioná-lo no canvas: um
formulário próprio aparece no painel lateral, pré-preenchido com os valores
atuais.

## Como usar

1. Clique no elemento no viewport 3D (pilar, viga, sapata/bloco ou laje/radier).
2. O painel lateral mostra um fieldset "**\<Tipo\> — editar em vivo**" com os
   campos daquele elemento (seção, altura/comprimento, perfil de catálogo,
   dimensões da fundação, espessura da laje...).
3. Altere os valores e clique **Aplicar**.
4. A geometria é regenerada na hora — o `GlobalId` e a posição do elemento
   **não mudam**, só a forma.

O que continua igual a antes:
- Mover/girar: arraste o gizmo (nenhuma mudança aqui).
- Renomear/apagar: mesmos botões de sempre.
- Undo/redo: cada edição entra no histórico normalmente.

## O que é editável em vivo, por tipo

| Tipo | Campos editáveis |
|---|---|
| Pilar (`IfcColumn`) | seção (concreto `width`/`depth` OU perfil de catálogo Gerdau/ArcelorMittal/personalizado) + altura |
| Viga (`IfcBeam`) | seção (idem pilar) + comprimento |
| Fundação (`IfcFooting`) | base, topo, rodapé, pedestal (dimensões e presença), nº/Ø de estacas (só bloco) |
| Laje/Radier (`IfcSlab`) | espessura |

**O que NÃO é editável em vivo** (continua exigindo recriar o elemento a
partir do esboço 2D): o contorno em planta da laje, o traçado da viga/parede,
e o tipo sapata↔bloco de uma fundação já criada. Essas propriedades estão
amarradas ao esboço 2D que originou o elemento — mudar o storey/posição de
base já é possível pelo gizmo, mas "redesenhar" a planta é fora do escopo
desta funcionalidade.

## Por que algumas versões antigas do modelo não mostram o formulário

O formulário de edição é reconstruído a partir de um Pset próprio,
`Pset_ParametricSource` (campo único `ParamsJSON`), gravado no elemento a
cada criação/edição. Elementos criados **antes** desta atualização, ou
importados de um IFC externo, não têm esse Pset — o painel mostra um aviso e
a edição em vivo fica indisponível para eles especificamente (a malha em si
continua válida; só não é reeditável sem recriar).

## Arquitetura (para quem for mexer no código depois)

Segue exatamente o padrão que já existia para parede
(`edit_wall_dimensions` → `POST /geometry/dimensions`), generalizado:

```
1. remove a Representation (Body) antiga do IfcProduct
2. gera uma nova representação com os novos parâmetros
   (mesma função geométrica usada na criação — create_column/create_beam
   reaproveitam _profile_entity_for(); create_footing reaproveita
   _footing_mesh())
3. reatribui a representação nova ao MESMO IfcProduct
   → GlobalId e ObjectPlacement preservados
4. regrava Pset_ParametricSource com os parâmetros atuais
```

### Backend

- `backend/app/services/geometry_service.py`
  - `write_params()` / `get_params()`: grava/lê o Pset_ParametricSource
    (idempotente — reaproveita o Pset se já existir, não duplica).
  - `_replace_body_representation()`: helper compartilhado do passo 1+3
    acima (extraído de `edit_wall_dimensions`, que passou a usá-lo também).
  - `_profile_entity_for()`: a escolha de perfil (I/H/U/L/tubular/retângulo)
    que antes estava duplicada dentro de `create_column`/`create_beam`,
    extraída para ser reaproveitada também pelas novas `edit_*`.
  - `edit_column_dimensions()`, `edit_beam_dimensions()`,
    `edit_footing_dimensions()`, `edit_slab_dimensions()`: novas.
  - `create_column/create_beam/create_footing/create_slab`: cada uma agora
    termina chamando `write_params()` para deixar o elemento reeditável.
  - `create_footing` ganhou `pile_count`/`pile_diameter` como parâmetros
    diretos (antes isso era uma chamada de `edit_pset` separada, feita pela
    rota depois de criar — consolidado numa única mutação/undo-step).

- `backend/app/models/schemas.py`: `EditColumnRequest`, `EditBeamRequest`,
  `EditFootingRequest`, `EditSlabRequest` — mesmos campos das
  `Create*Request` correspondentes, sem posição/rotação/storey (isso
  continua sendo editado só via `/geometry/placement`).

- `backend/app/api/geometry.py`: novas rotas, seguindo a mesma convenção já
  usada em `PATCH /levels/{guid}`:
  - `PATCH /ifc/models/{model_id}/geometry/column/{guid}`
  - `PATCH /ifc/models/{model_id}/geometry/beam/{guid}`
  - `PATCH /ifc/models/{model_id}/geometry/footing/{guid}`
  - `PATCH /ifc/models/{model_id}/geometry/slab/{guid}`

### Frontend

- `frontend/src/services/ifcApi.js`: `editColumn`, `editBeam`,
  `editFooting`, `editSlab` (PATCH nas rotas acima).

- `frontend/src/components/IfcPanel.jsx`:
  - `applyEditParamsFromDetail(d)`: chamada dentro de `selectGuid`, faz
    `JSON.parse` do `Pset_ParametricSource.ParamsJSON` e popula o novo
    estado de edição (`editForm`, `editKind`, `editSteelFamily`,
    `editSteelProfileValue`, `editProfileCustom`, `editUsePedestal`).
  - Dois `useEffect` novos (logo após os já existentes de
    `beamSteelFamily`) recalculam `editForm.{width,depth,h,b,tw,tf,shape,
    profile}` a partir da aba Concreto/Metálica selecionada — mesma lógica
    dos `useEffect` da inserção (linhas ~423-582), só que escrevendo em
    `editForm` em vez de `form`, e escopados ao elemento selecionado
    (`isColumn`/`isBeam`) em vez do `elemType` da inserção.
  - `applyColumnEdit/applyBeamEdit/applyFootingEdit/applySlabEdit`: chamam
    o `ifcApi.editX` correspondente e depois `refreshAfterEdit(guid)`
    (busca a malha nova + o `detail` atualizado, sem perder a seleção nem
    o gizmo).
  - Os quatro fieldsets de edição foram inseridos no painel de propriedades
    do elemento selecionado, logo depois do fieldset "Dimensões da parede"
    já existente (mesmo padrão visual).

  Esse formulário de edição é **intencionalmente separado** do formulário
  de inserção (`form`/`elemType` e as abas Concreto/Metálica que já
  existiam) — estado próprio (`editForm` etc.), para não arriscar quebrar o
  fluxo de inserção (esboço 2D → "Converter 3D") já testado.

## Testado

- `pytest backend/tests/test_smoke.py` — 30/30 passando.
- `npm run build` e `npm run lint` no frontend — sem erros novos.
- Ciclo completo via `curl` para os 4 tipos (criar → `PATCH` → conferir
  `GlobalId` inalterado, `Pset_ParametricSource` atualizado sem duplicar,
  `/mesh` exportando e `/validate` retornando `valid: true`).
