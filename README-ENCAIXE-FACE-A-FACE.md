# Encaixe automático face a face entre elementos estruturais

A conectividade anterior reconhecia alguns pares de elementos, mas o recorte
da viga ainda dependia da coincidência entre os **eixos centrais em 3D**. Isso
falhava principalmente quando a viga era criada pela referência de topo ou
base: a conexão era registrada, porém a geometria continuava atravessando o
pilar.

## Comportamento implementado

- **Viga–pilar:** a ponta da viga é recortada na face real do pilar.
- **Viga–viga:** a viga de menor seção é tratada como secundária e termina na
  face da principal, tanto em cantos quanto em encontros em T.
- **Referência vertical:** topo, centro e base das seções são comparados; vigas
  com alturas diferentes podem se conectar mantendo os topos alinhados.
- **Pilares girados:** o corte acompanha a face inclinada, não uma caixa
  alinhada aos eixos globais.
- **Perfis metálicos:** a envoltória usa `b` e `h` reais do perfil, em vez dos
  valores padrão de largura e altura do formulário.
- **Edição e exclusão:** mover, girar ou redimensionar recalcula os encaixes. Ao
  apagar o elemento receptor, a viga remanescente recupera automaticamente o
  comprimento lógico original.

O comprimento armazenado em `Pset_ParametricSource` continua sendo o
comprimento lógico eixo a eixo. Apenas a representação geométrica IFC recebe
os planos de corte, preservando a edição paramétrica e o posicionamento pelos
eixos de grid.

## Arquivos principais

- `backend/app/services/connectivity_service.py`: detecção por envoltórias
  orientadas, decisão da viga secundária e cálculo dos planos de corte.
- `backend/app/services/geometry_service.py`: geração dos
  `IfcBooleanClippingResult` com normais de corte arbitrárias.
- `backend/app/api/edit.py`: exclusão e reconstrução dos encaixes na mesma
  transação de desfazer/refazer.
- `backend/tests/test_smoke.py`: testes de regressão dos novos casos.

## Validação

Foram validados 36 testes de backend, incluindo:

1. viga pelo topo entre dois pilares de 30 cm: geometria de `0,15 m` a
   `3,85 m`, mantendo comprimento lógico de `4,00 m`;
2. pilar metálico W usando a largura real da mesa;
3. pilar girado a 45° com plano de corte oblíquo coincidente com sua face;
4. encontro em T entre vigas com alturas diferentes e topo alinhado;
5. remoção da viga principal restaurando o recorte da secundária.
