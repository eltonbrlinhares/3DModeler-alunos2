# Reconciliado com o GitHub atual (commit `8c9221b`, PR #7)

Puxei o repositório de verdade antes de continuar (obrigado pelo aviso) —
achei que o modelo tinha avançado bastante desde a última vez que eu tinha
uma cópia: alguém (você, ou com ajuda) reescreveu boa parte do
`connectivity_service.py` com uma abordagem bem melhor que a minha original
— retângulo ORIENTADO (não só caixa alinhada aos eixos — agora funciona com
pilar girado), envoltória real do perfil metálico (`b`/`h`, não o campo
nominal `width`/`depth`), e um `resync_all_connections`/
`delete_product_and_resync` pra corrigir um bug real (viga secundária
ficava com corte "fantasma" depois de apagar quem a sustentava). Isso é uma
evolução de qualidade — mantive tudo, não voltei pra minha versão antiga.

## Bug real que encontrei nesse código e corrigi

Rodei a suíte de testes de vocês (que também cresceu bastante — 37 testes
agora) e um deles estava falhando:
`test_face_fit_right_angle_beams_share_corner_without_gap_even_on_column`.

**Causa**: em `_pick_fitting`, o código sempre priorizava o pilar sobre a
viga (`(priority, distance, ...)` como chave de ordenação) — então, num
canto de 90° onde duas vigas de mesma seção se encontram EM CIMA de um
pilar, uma das duas vigas (a que "ganha" a prioridade por critério de
GlobalId em `_is_secondary`) nunca chegava a considerar a face da outra
viga como candidata de corte — só a face do pilar (mais larga, 0,15m em vez
de 0,10m), deixando uma pequena folga entre as duas vigas no canto.

**Correção** (2 mudanças pequenas em `connectivity_service.py`):
1. `_pick_fitting` agora ordena por **distância primeiro** (a face mais
   próxima é sempre a fisicamente correta — é o que realmente delimita o
   material presente ali), com `priority` só como desempate.
2. O laço viga↔viga de `beam_end_fittings` não filtra mais por
   `_is_secondary` na hora de GERAR o candidato de corte (isso continua
   sendo usado em `_check_pair` pra decidir o sentido da relação de
   conectividade — não mudei isso). Geometricamente isso é seguro: numa
   viga em T normal, as pontas da viga "principal" nunca caem dentro da
   envoltória da secundária, então nada muda pra esse caso — só afeta o
   canto simétrico, que agora aperta certo pros dois lados.

Rodei a suíte inteira de novo depois da correção: **37/37 passando**
(antes: 36/37).

## O que mais tem neste zip (Fase 2 — cotas manuais + vistas como IfcAnnotation)

Isso ainda não estava no GitHub (a última atualização de lá é anterior à
Fase 2), então é tudo novo:

1. **Removi** a cota automática de grid da vez passada, como pedido.
2. **Botão "MEDIR"** na toolbar (separado do "COTA", que já existia pra
   medir/editar parede — não mexi nele): clique em 2 pontos quaisquer do
   modelo → linha de prévia tracejada com distância ao vivo → cota real
   criada como `IfcAnnotation` (curvas + `IfcTextLiteral`), desenhada na
   tela por um gerenciador isolado (`DimensionManager.js`, mesmo padrão do
   `IfcDatumManager` — não toquei no `ThreeCanvas.jsx`). Lista no canto
   superior direito pra apagar cada cota.
3. **Vistas como `IfcAnnotation`** (backend pronto, rotas
   `GET`/`POST`/`DELETE /view-annotations`) — ainda **não ligado ao
   frontend** (nada chama isso ainda quando você cria/edita uma vista no
   `ProjectBrowser`); separei de propósito, mesmo cuidado de sempre.

### Testado
- Cota em planta (0,0,0)→(4,3,0): comprimento **5,00** (3-4-5). Cota em
  elevação vertical: **3,00** (caso degenerado tratado por fallback).
- Vistas: criei 2, atualizei uma pelo mesmo `view_id` (não duplicou),
  apaguei uma — sobrevive a save/reload, confirmado com `ifcopenshell` puro.
- Retestei TUDO junto nesse ambiente reconciliado: pilar+viga com
  conectividade e recorte de face (0,15 a 3,85m, exato), material/
  quantitativo (0,27m³/675kgf), cota manual e vista de anotação — no MESMO
  modelo, sem nenhum erro. `/validate` sempre `valid: true`.
- `pytest`: 37/37. `npm run build`: limpo. `npm run lint`: mesmo baseline
  de sempre (49 problemas, todos em arquivos que ninguém de nós tocou).

## Como instalar

Isso pressupõe que seu repositório já está no commit `8c9221b` (o HEAD
atual do GitHub). Extrai por cima — só estes 12 arquivos mudam:

```powershell
Expand-Archive -Path <este-zip>.zip -DestinationPath . -Force
```

## Lição (de novo, mas dessa vez ao contrário)

Da vez passada o erro foi eu trabalhar numa cópia desatualizada e te
mandar de volta algo mais antigo que o que você já tinha. Dessa vez, você
me avisou que o GitHub tinha avançado — e isso foi o que permitiu eu achar
o bug real do canto antes de continuar construindo em cima. Se puder
continuar avisando quando fizer push de mudanças relevantes (ou eu
perguntar/conferir antes de entregas grandes), a gente evita os dois tipos
de problema.
