# Fase 1: material, Psets padrão, quantitativos + remoção de nomes de fabricante

## Material, Pset padrão e quantitativos (novo)

Todo pilar/viga/fundação/laje agora ganha, automaticamente, na criação e a
cada edição de dimensão:

- **`IfcMaterial`** — "Concreto C25" ou "Aço A572 Gr. 50", decidido pelo
  mesmo critério que já existia pra escolher o perfil (`profile`/`shape`
  preenchidos = perfil metálico → aço; senão → concreto). Nomes genéricos,
  sem fabricante — valores de referência comuns (NBR 6118 pro concreto,
  ASTM A572 Gr.50 é o grau mais usual pra perfil laminado tipo W/HP no
  Brasil).
- **Pset certificado** (`Pset_ColumnCommon`, `Pset_BeamCommon`,
  `Pset_SlabCommon`, `Pset_FootingCommon`) — `LoadBearing=True`,
  `IsExternal=False`. Isso é o que faz um visualizador de terceiro (Solibri,
  BIMcollab, ou qualquer app IFC que não seja o de vocês) reconhecer "isso é
  estrutural" sem entender o `Pset_ParametricSource` (que é nosso, informal).
- **`IfcElementQuantity`** — volume, peso, e (coluna/viga) comprimento ou
  (laje) área/espessura.

Tudo isso fica **em paralelo** ao `Pset_ParametricSource` que já existia — um
não substitui o outro. O `Pset_ParametricSource` continua sendo a fonte pra
edição em vivo (formulário pré-preenchido); os novos são o "vocabulário
oficial" pro resto do mundo IFC.

### Por que peso = volume real × densidade, não o "peso nominal" do catálogo

O volume vem da **malha real já tessellada** (`ifcopenshell.geom` +
`ifcopenshell.util.shape.get_volume`), não uma fórmula de prisma — então já
reflete o recorte de viga na face do pilar (se ela estiver cortada, o
volume/peso já saem menores) e a forma não-prismática da sapata (tronco +
rodapé + pedestal). Multiplicar esse volume por uma densidade (2500 kgf/m³
pro concreto — NBR 6118; 7850 kgf/m³ pro aço) funciona **igual** pra perfil
de catálogo e pra seção personalizada, sem precisar guardar mais nenhum
campo. Validei contra um caso real: pilar W250X73 de 3m — peso calculado
saiu **215,6 kgf** (71,9 kgf/m), contra o peso nominal do catálogo de
**73 kgf/m** — diferença de ~1,6%, esperada porque não modelamos os raios de
concordância do perfil (só a alma/mesa retas). É uma boa conferência de que
a conta está certa.

### Onde fica no código

- **Novo**: `backend/app/services/semantics_service.py` — um ponto de
  entrada só, `apply_semantics(entry, guid)`, com transação própria (mesmo
  padrão de `connectivity_service.resync_connections`).
- **`backend/app/api/geometry.py`**: chama `sem.apply_semantics(entry, guid)`
  logo depois de cada `POST /geometry/{slab,footing,column,beam}` e
  `PATCH /geometry/{column,beam,footing,slab}/{guid}` — os mesmos 8 pontos
  onde a conectividade já era re-sincronizada. Não precisa rodar em
  `/placement` (mover/girar não muda volume nem material).

### Testado (não só leitura de código)

- 30/30 testes de backend passando, build/lint do frontend sem erro novo.
- Criei pilar de concreto (0,3×0,3×3,0) → `Qto_ColumnBaseQuantities`:
  volume **0,27 m³** (exato), peso **675 kgf** (0,27×2500, exato), material
  Concreto C25.
- Criei pilar metálico W250X73 → volume **0,0275 m³** (da seção real I),
  peso **215,6 kgf**, material Aço A572 Gr. 50 (validação do peso vs.
  catálogo acima).
- Criei fundação, viga (0,2×0,4×4,0 → volume 0,32 exato, peso 800 kgf) e
  laje (4×3×0,12 → volume 1,44, área 12,0 m², peso 3600 kgf) — todos exatos.
- Editei um pilar de concreto pra metálico via `PATCH` e conferi: as
  quantidades mudaram pro valor certo do perfil, e **só uma**
  `IfcRelAssociatesMaterial` ficou associada (o material antigo foi trocado,
  não duplicado — `material.assign_material` da API do ifcopenshell já
  desfaz a associação anterior sozinho).

### Limitação honesta

Os nomes dos Psets/Qtos usados (`Pset_ColumnCommon`, `Qto_BeamBaseQuantities`
etc.) seguem a convenção oficial do IFC4, mas as propriedades gravadas em
cada um são as mais básicas e universais (`LoadBearing`, volume, peso,
comprimento/área) — não é uma cobertura exaustiva do template oficial
completo (que tem dezenas de propriedades opcionais por tipo). Suficiente
pra qualquer visualizador reconhecer os elementos como estruturais e
quantificáveis; se quiser mais propriedades específicas depois, é só
estender o dicionário `properties` de cada tipo em `semantics_service.py`.

## Remoção de nomes de fabricante

Tirei "Gerdau" e "ArcelorMittal" de todo o código-fonte (busca confirmada
sem nenhuma ocorrência restante, fora do `mudancas-10-07-Diego.md`, que é
seu changelog pessoal e referencia os nomes dos arquivos `.txt` originais
que você usou — não editei esse por ser um registro histórico seu, me avise
se quiser que eu troque também):

- `frontend/src/data/steelColumnProfiles.js` / `steelBeamProfiles.js`:
  comentário de cabeçalho e os `label` de cada família (ex.: `"HP (Gerdau
  laminado)"` → `"HP (perfil laminado)"`, `"CVS (ArcelorMittal soldado)"` →
  `"CVS (perfil soldado)"`).
- `frontend/src/components/IfcPanel.jsx`: comentários que citavam os
  fabricantes na origem dos catálogos.

Os **códigos dos perfis em si** (HP, W, CVS, VS, CS) não foram tocados —
são designações de série de perfil estrutural, não nomes de fabricante,
então continuam aparecendo normalmente nos formulários.

Build do frontend confirmado limpo depois da troca.
