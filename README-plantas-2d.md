# Planta 2D → 3D para Pilar / Viga / Fundação / Laje

Upgrade do fluxo que já existia só para parede (`WallSketchController`):
agora **pilar, viga, fundação (sapata/bloco) e laje/radier** também podem ser
desenhados em planta, por nível, e convertidos em elementos 3D reais com um
clique — em vez de posicionar cada um diretamente no espaço 3D.

## Arquivos novos

```
frontend/src/ifc/planSketch/
  planSketchSnap.js          — snap compartilhado (sempre em interseção de grid/datum)
  ColumnSketchController.js  — Pilar: clique = marcador (ponto)
  FootingSketchController.js — Fundação (sapata/bloco): clique = marcador (ponto)
  BeamSketchController.js    — Viga: clique = polilinha (cadeia de trechos)
  SlabSketchController.js    — Laje/Radier: clique = contorno fechado (polígono)
```

## Arquivos alterados

- `frontend/src/components/TopToolbar.jsx` — 4 botões novos (PIL/VIG/FUND/LAJE)
  na barra superior; o campo "altura 3D" agora é genérico (só aparece para
  Parede/Pilar, que precisam dele — as outras já têm altura/espessura no
  formulário lateral).
- `frontend/src/components/IfcPanel.jsx` — instancia os 4 controllers novos,
  generaliza o botão **3D** (antes só falava com a parede) para despachar
  para a ferramenta de planta atualmente selecionada, e generaliza o
  desfazer/refazer global para guardar um snapshot de **todas** as plantas
  (não só a parede) a cada ação.

## Como funciona (igual à parede, só que por tipo de elemento)

1. Clique num botão da toolbar (PIL, VIG, FUND ou LAJE). Isso também troca o
   formulário lateral para a aba daquele elemento — os mesmos campos que já
   existiam na inserção direta em 3D (largura/profundidade, perfil metálico,
   dimensões da fundação, espessura da laje...).
2. Clique nas interseções de grid do nível ativo:
   - **Pilar / Fundação**: cada clique cria um marcador (a seção é lida do
     formulário *naquele instante* — dá pra variar pilar a pilar).
   - **Viga**: clique os pontos do eixo (2×clique/Enter/clique no 1º ponto
     fecha a cadeia, igual à parede).
   - **Laje/Radier**: clique o contorno (mínimo 3 pontos; mesmas três formas
     de fechar).
3. Clique **3D** na toolbar: converte tudo que estiver pendente do tipo
   selecionado em elementos reais (chama `createColumn`/`createBeam`/
   `createFooting`/`createSlab`, um por marcador/trecho/contorno). Clicar de
   novo com algo já convertido volta para a planta (apaga os elementos e
   redesenha os marcadores/contornos).
4. Desfazer/Refazer (↶/↷) cobre normalmente qualquer combinação de edições em
   planta e conversões em 3D, mesmo alternando entre ferramentas.

## Decisões de projeto

- **Snap sempre em grid/datum** (`planSketchSnap.js`), diferente da parede
  (que também aceita ponto livre): pilar/viga/fundação/laje já usavam só
  interseção de grid no modo de inserção direta — manter isso evita que a
  planta gere elementos em posições que o modo antigo nunca permitiria.
- **Marcadores/contornos são sempre achatados** (~3 cm de altura) em planta,
  nunca mostram a geometria 3D real antes da conversão — mesmo princípio da
  parede (linha dupla fina), só que aplicado a caixa achatada (pilar/
  fundação) ou preenchimento fino (laje). A geometria real só aparece depois
  do clique em **3D**, quando o backend efetivamente cria o elemento.
- **Viga não usa miter join** nos cantos (ao contrário da parede): cada
  trecho da polilinha vira uma `IfcBeam` independente.
- **Laje/Radier**: um contorno fechado = **uma única** `IfcSlab` (não
  segmentada), igual ao `slabTool.js` do modo direto. `predefinedType` é
  capturado do formulário no instante do fechamento (`null`/`"FLOOR"` = laje
  comum, `"BASESLAB"` = radier).
- **Altura do pilar**: como o clique em planta não tem a fase de arraste de
  altura que o modo direto usa, foi adicionado um campo "altura 3D" (estado
  `columnHeight`) na toolbar, igual ao que a parede já tinha — aplicado a
  todos os marcadores pendentes no momento da conversão.

## Testado

- `npx esbuild` resolvendo toda a árvore de imports reais do repositório a
  partir de `IfcPanel.jsx` (bundle limpo, sem erro de sintaxe/import) — não
  substitui rodar o Vite, mas garante que não há erro de digitação em
  caminho de import/nome exportado antes de você testar na UI.

## O que ainda falta (não coberto por este patch)

- A ferramenta **Cota** (`DimensionController`) continua só medindo/editando
  paredes — não foi estendida para pilar/viga/fundação/laje.
- Não há edição paramétrica de um marcador já colocado (só adicionar/remover
  clicando de novo perto dele); mover um pilar em planta = remover e clicar
  de novo no lugar certo.
- `predefinedType` da fundação (sapata × bloco) e da laje (laje × radier) é
  lido do formulário lateral no instante do clique/fechamento — se você
  mudar a aba do formulário no meio de uma planta com marcadores pendentes,
  os já colocados NÃO mudam retroativamente (isso é intencional, mas vale
  saber).
