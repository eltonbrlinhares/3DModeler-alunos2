# Conectividade física entre elementos estruturais

Fundação, pilar, viga e laje agora registram automaticamente **quem toca em
quem** — não é análise estrutural (sem esforços/reações), é topologia: uma
`IfcRelConnectsElements` para cada par de elementos fisicamente conectado.

## O que é detectado

| Par | Kind | Quando |
|---|---|---|
| fundação → pilar | `apoio` | topo da fundação encosta na base do pilar |
| pilar → viga | `apoio` | topo do pilar encosta numa extremidade da viga |
| viga → viga (canto) | `cruzamento` | as pontas de duas vigas se tocam |
| viga → viga (T) | `cruzamento` | a ponta de uma viga encosta no MEIO do vão de outra (viga secundária apoiando numa principal) |
| viga/pilar ↔ laje | `apoio_laje` | o ponto de conexão do elemento cai dentro do contorno da laje, na cota do fundo ou do topo dela |

Tolerância: **5 cm** (constante `TOLERANCE` em `connectivity_service.py`) —
folga pra pequenas imprecisões de digitação/posicionamento.

## Como usar

Nada a fazer — é automático. Ao criar, editar (dimensão) ou mover/girar
(gizmo) uma fundação/pilar/viga/laje, o backend recalcula sozinho as conexões
daquele elemento. No painel de propriedades, ao selecionar um elemento
conectado aparece uma seção **"Conectividade física"** listando quem ele
sustenta/é sustentado por/cruza/etc.

Ao apagar um elemento com conexões, aparece uma confirmação listando o quê
está conectado antes de prosseguir (os elementos conectados não são
apagados junto — só a relação é removida).

## Limitações conscientes

- **Não é o modelo de análise estrutural do IFC** (`IfcStructuralConnection`,
  membros 1D idealizados, cargas) — isso é vocabulário de software de
  cálculo, fora do escopo de uma ferramenta de modelagem.
- A detecção depende do `Pset_ParametricSource` (gravado desde a edição em
  vivo). Elementos de um IFC externo, ou muito antigos, simplesmente não
  entram na detecção.
- A laje só participa pela ÁREA do seu contorno original — mudar a
  espessura é considerado (topo/fundo da laje respeitam a nova espessura),
  mas hoje não dá pra editar o contorno em planta sem recriar a laje (mesma
  limitação já documentada na edição paramétrica).

## Arquitetura

Novo serviço `backend/app/services/connectivity_service.py`, independente de
`geometry_service.py` (importa dele, nunca o contrário — evita import
circular). Pontos de conexão são calculados a partir de duas fontes já
existentes, nunca duplicando lógica:

1. o `ObjectPlacement` de fato gravado no IFC (`ifcopenshell.util.placement.
   get_local_placement`);
2. as dimensões persistidas em `Pset_ParametricSource` (`geometry_service.
   get_params_f`, a mesma fonte usada pela edição em vivo).

Funções principais:
- `_point_endpoints(f, inst)`: pontos de conexão pontuais (pilar: base/topo;
  viga: 3 candidatos por ponta — centro, face inferior, face superior, para
  cobrir a referência vertical topo/centro/base da viga sem ambiguidade;
  fundação: topo).
- `_slab_bearing(f, inst)`: matriz + polígono local + cotas fundo/topo da
  laje, pra teste de "ponto dentro do contorno" (ray casting, em
  `_point_in_local_polygon`).
- `_check_pair(f, a, b)`: decide se dois elementos se tocam e cria a relação
  certa — inclusive o caso de viga secundária em T (`_point_segment_distance`,
  ponto-a-segmento).
- `_resync_connections(f, guid)`: remove as conexões antigas de `guid` e
  detecta de novo contra todos os outros elementos estruturais — chamada
  **dentro do mesmo `with mutate(entry) as f:`** de quem criou/editou o
  elemento (ver `resync_connections`/`_resync_connections`, a distinção
  entre as duas existe justamente pra isso: a versão com `_` não abre uma
  nova transação de undo).
- `list_connections(entry, guid)`: pra UI e pro aviso de apagar.

### Onde é chamado
Sempre nas ROTAS (`app/api/geometry.py`, `app/api/edit.py`), nunca dentro de
`geometry_service.py` — isso evita import circular (`connectivity_service`
importa `geometry_service`, nunca o inverso) e mantém cada serviço
responsável só pelo que já fazia:
- toda rota `POST /geometry/{wall|slab|footing|column|beam}` (exceto
  wall, que não é estrutural pra fins de conectividade) chama
  `conn.resync_connections(entry, guid)` logo após criar;
- toda rota `PATCH /geometry/{column|beam|footing|slab}/{guid}` idem
  (dimensão pode mover um ponto de conexão);
- `POST /geometry/placement` idem (mover/girar);
- `POST /edit/delete` chama `conn.remove_connections_for(entry, guid)`
  **antes** de `edit_service.delete_product`, pra não deixar
  `IfcRelConnectsElements` órfã.

### Rotas novas
- `GET /ifc/models/{model_id}/connectivity/{guid}` — lista as conexões.
- `POST /ifc/models/{model_id}/connectivity/{guid}/resync` — recálculo
  manual (normalmente desnecessário; existe como fallback).

### Frontend
- `frontend/src/services/ifcApi.js`: `connections()`, `resyncConnections()`.
- `frontend/src/components/IfcPanel.jsx`: `selectGuid` busca as conexões
  junto com o `detail`; `refreshAfterEdit` (dimensão) e `applyTransform`
  (gizmo) as re-buscam depois de qualquer mudança; `remove()` avisa antes de
  apagar um elemento conectado; painel de propriedades ganhou a seção
  "Conectividade física".

## Testado

- `pytest backend/tests/test_smoke.py` — 30/30 passando (sem nada quebrado).
- `npm run build` / `npm run lint` — sem erros novos.
- Cenário completo via `curl`: fundação→pilar→viga→laje encostando de
  propósito — todas as 5 conexões esperadas detectadas corretamente, com o
  sentido certo (`supports`/`supported_by`/`bears_slab`/`slab_bearing`).
  Mover a fundação para longe fez a conexão sumir sozinha. Apagar um pilar
  ainda conectado a uma viga limpou a relação sem deixar o modelo inválido
  (`/validate` continuou `valid: true`). Duas vigas cruzando ponta-com-meio
  (T) também detectado corretamente depois do ajuste que adicionou esse caso.
