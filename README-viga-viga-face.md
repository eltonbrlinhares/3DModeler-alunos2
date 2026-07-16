# Encaixe pela face — agora em todos os pares que precisam disso

> **Atualização:** encontros em T e de canto agora são detectados pela
> envoltória orientada da viga receptora e pelas faces topo/centro/base. Isso
> corrige vigas com alturas diferentes e permite corte oblíquo alinhado à face.
> Consulte `README-ENCAIXE-FACE-A-FACE.md`.

Estendendo o corte pilar→viga: agora **viga→viga** (canto e T) também é
cortada pela face, não pelo eixo. Só um arquivo mudou desta vez
(`connectivity_service.py`) — `geometry_service.py` já tinha tudo que era
preciso (o helper de recorte já é genérico).

## Por que fundação→pilar e viga/pilar↔laje NÃO precisaram de nada

Fui conferir antes de "implementar em tudo por implementar": esses dois
pares **já não se sobrepõem**, do jeito que este app posiciona os
elementos. O pilar nasce exatamente na cota Z do topo da fundação (nunca
mais fundo); a laje começa exatamente na cota de quem a sustenta. Eles se
tocam por um PLANO, nunca um entra no volume do outro. O problema de
sobreposição só existe quando um elemento é desenhado eixo-a-eixo *através*
da seção de outro — e isso só acontece com viga (indo de centro a centro de
quem ela liga). Por isso só pilar e (agora) viga são as fontes de recorte;
fundação e laje nunca são cortadas, e a própria viga é sempre a única
cortada (nunca quem a sustenta).

## Viga → viga: quem corta, quem é cortada

Regra: a viga de **menor seção transversal** (largura × altura) é a
"secundária" — cortada na face da "principal". Empate (seções iguais) é
resolvido por GlobalId, só pra ser determinístico. Cobre os dois casos:

- **Canto** (as pontas de duas vigas se encontram, tipo L): a secundária
  é cortada até a face da principal.
- **T** (a ponta de uma viga encosta no MEIO do vão de outra — viga
  secundária "framing into" uma principal): mesma lógica, secundária
  cortada até a face lateral da principal.

A principal nunca é cortada — segue reta, como framing member primário em
qualquer BIM de referência.

## Limitação consciente

O cálculo assume que a viga secundária chega **perpendicular** (ou perto
disso) à principal — cobre bem o caso comum de uma casa (grade retangular de
vigas). Encontros em ângulo muito oblíquo (bem diferente de 90°) não têm
tratamento especial; o corte ainda acontece, mas o ângulo do corte na
prática não é "chanfrado" pro encontro, é sempre reto (perpendicular ao eixo
da viga cortada) — suficiente pro escopo deste projeto, mas vale saber que
existe.

## O que já existia e continua igual
- Fundação → pilar, pilar → viga (pontas E agora meio de outra viga), e
  apoio em laje continuam sendo DETECTADOS e registrados
  (`IfcRelConnectsElements`) do jeito que já estava.
- O recorte de pilar → viga (implementado antes) não mudou.
- Nenhuma mudança de frontend — o mesh final sempre vem do backend.

## Testado

- `pytest backend/tests/test_smoke.py` — 30/30 passando.
- **T-junction real**: viga principal 0,3×0,5m de 4m; viga secundária
  0,2×0,3m começando exatamente no meio do vão dela. Malha exportada da
  secundária: **2,15 a 4,0** (cortada 0,15m = metade da largura da
  principal). Malha da principal: **0 a 4,0**, intacta.
- **Canto real**: duas vigas de seções diferentes se encontrando ponta a
  ponta. A de seção menor foi cortada exatamente na face da maior; a maior
  ficou com o comprimento total intacto.
- `/validate` continuou `valid: true` nos dois cenários.
