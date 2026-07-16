# Viga encaixando na FACE do pilar (não no eixo)

> **Atualização:** o encaixe não depende mais da coincidência entre os eixos
> centrais em 3D. A versão atual compara topo/centro/base, usa a envoltória
> real de perfis metálicos e respeita pilares girados, gerando inclusive plano
> de corte oblíquo alinhado à face receptora. Consulte
> `README-ENCAIXE-FACE-A-FACE.md`.

Antes: uma viga entre dois pilares ia de eixo a eixo (centro a centro), então
sempre sobrepunha a seção inteira de cada pilar na ponta. Agora, quando uma
ponta da viga está apoiada num pilar (a mesma detecção da conectividade
física), a **geometria real exportada** é cortada na face do pilar — como o
"Join Geometry" do Revit ou o "fitting" do Tekla.

## O que muda, e o que NÃO muda

- **Muda**: a `Representation` (o sólido de fato, o que é exportado no
  `.ifc` e o que aparece no viewport) — ela para na face do pilar.
- **NÃO muda**: o comprimento LÓGICO da viga (eixo a eixo), que é o que
  aparece no formulário de edição em vivo e o que é usado pra detectar
  conexões. Isso é proposital — ver "por que separar as duas coisas" abaixo.

É automático: não tem toggle, não precisa fazer nada. Acontece toda vez que
a conectividade é recalculada (criar, editar dimensão, mover/girar — tanto
da própria viga quanto do pilar em que ela se apoia).

## Escopo desta primeira versão

Só **viga apoiada em pilar** (as duas pontas, se for o caso). Não cobre:
- viga apoiada em fundação diretamente (sem pilar);
- viga-viga (canto ou T) — continua indo até o eixo da outra viga;
- pilar não é cortado por nada (só a viga é encurtada, nunca o pilar — como
  nas ferramentas de referência: quem "chega" é cortado, quem "recebe" não).

Motivo do escopo: era literalmente o caso pedido (pilar → viga em cima
dele), e os pilares neste app nunca giram (`rotation_z` sempre 0), o que
torna o cálculo da face uma conta fechada simples — os outros casos
(viga-viga, fundação) têm geometria mais variada e ficam pra uma extensão
futura se fizer falta.

## Por que separar comprimento lógico de geometria cortada

Se o "comprimento oficial" da viga passasse a ser o comprimento já cortado,
duas coisas quebrariam:
1. **Edição em vivo**: o formulário mostraria um número que não bate com a
   distância real entre os pilares (confuso pra quem está desenhando).
2. **Detecção de conectividade**: ela compara os PONTOS de conexão
   (extremidades do eixo) — se o comprimento "oficial" já viesse cortado, a
   extremidade da viga nunca coincidiria exatamente com o topo do pilar, e a
   conexão deixaria de ser detectada.

Por isso o corte é tratado como um detalhe de baixo nível da
`Representation`, recalculado toda vez, nunca como o dado "de verdade" da
viga.

## Como funciona (arquitetura)

Tudo em `backend/app/services/connectivity_service.py` +
`geometry_service.py`, sem nenhuma mudança no frontend — a malha final
sempre vem do backend (`ifcApi.productMesh`/`refreshMesh`), então o corte já
aparece sozinho assim que a página recarrega a malha.

1. `connectivity_service._box_exit_distance(dx, dy, width, depth)`: distância
   do centro de uma caixa alinhada aos eixos (a seção do pilar — sempre
   alinhada ao mundo nesta aplicação) até a face dela, numa direção — conta
   trigonométrica fechada (`min(hw/|dx|, hd/|dy|)`).
2. `connectivity_service.beam_end_trims(f, beam)`: para cada ponta da viga,
   procura um pilar cuja base OU topo coincide com aquele ponto (mesma
   tolerância de 5cm da conectividade); se achar, calcula o quanto encurtar
   com a função acima. Tem uma trava de segurança: nunca deixa o corte total
   passar de 90% do comprimento (evita comprimento residual negativo em
   vãos muito curtos).
3. `geometry_service._beam_profile_representation(...)`: gera a
   `Representation` com `clippings` (um `IfcBooleanClippingResult` de
   `IfcHalfSpaceSolid` por ponta cortada) — API nativa do
   `ifcopenshell.api.geometry.add_profile_representation`, não é gambiarra.
   Convenção de sinal **validada empiricamente** (não só por doc): criei uma
   viga de teste, apliquei o clipping e conferi a bounding box resultante
   antes de integrar.
4. `geometry_service._set_beam_end_trims_f(f, guid, trim_start, trim_end)`:
   regenera a Representation da viga com o corte atual — chamada de dentro
   de um `with mutate(entry) as f:` já aberto (não abre uma transação de
   undo nova).
5. `connectivity_service._resync_connections`: depois de recalcular as
   relações de conectividade de `guid`, também reaplica o corte —
   - se `guid` é a própria viga: reaplica nela;
   - se `guid` é um pilar: reaplica em **todas** as vigas do modelo (não só
     nas que ainda estão conectadas!) — necessário pra "desfazer" o corte de
     uma viga cujo pilar se afastou. Na escala de uma casa térrea isso é
     barato; não valeria a pena numa torre de 40 pavimentos, mas não é o
     caso aqui.

Nada disso mexe em `create_beam`/`edit_beam_dimensions` diretamente — eles
continuam gerando a viga "quadrada" (sem corte); o corte é sempre aplicado
*depois*, pelo mesmo passo de resync de conectividade que já rodava.

## Testado

- `pytest backend/tests/test_smoke.py` — 30/30 passando.
- Cenário real: 2 pilares (0,3×0,3) a 4m de distância, viga entre eles.
  Inspecionei a malha REAL exportada (`ifcopenshell.geom`, coordenadas de
  mundo) — foi de **0,15 a 3,85** (exatamente meia-largura de pilar cortada
  em cada ponta), não 0 a 4 como seria eixo-a-eixo.
- Movi um dos pilares pra longe e reexportei: aquele lado da viga **voltou
  sozinho pra ponta reta** (0 a 4,0), mantendo o outro lado cortado — prova
  de que o recorte se desfaz corretamente quando a conexão deixa de existir.
- `Pset_ParametricSource` da viga continuou com `length: 4.0` (o valor
  lógico, eixo-a-eixo) em todos os passos acima — confirmando que o
  formulário de edição não é afetado pelo corte.
- `/validate` continuou `valid: true` em todos os passos.
