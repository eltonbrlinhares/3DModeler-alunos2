# Níveis e vistas BIM

Esta versão adiciona ao editor IFC um fluxo de navegação inspirado no Revit. O recurso foi implementado como uma camada de vistas sobre o modelo IFC existente, sem substituir as ferramentas de desenho, perfis metálicos, fundações, malhas ou operações geométricas do projeto.

## Como usar

1. Abra ou crie um modelo IFC.
2. No painel de níveis, crie as cotas necessárias, por exemplo: Fundação, Térreo e Cobertura.
3. Use o **Navegador do Projeto**, no canto inferior esquerdo, para abrir a vista 3D, as plantas estruturais ou as elevações.
4. Um clique em um nível o torna ativo. Um duplo clique abre sua planta.
5. Na planta, ajuste plano superior, plano de corte, plano inferior, profundidade e visibilidade das categorias.
6. Em **Cortes**, use **Novo corte**, escolha o eixo, a coordenada e a profundidade. A direção pode ser invertida nas propriedades.
7. Na vista 3D, a seção **Caixa de corte 3D** permite limitar o volume mostrado.
8. O botão **Enquadrar** reposiciona a câmera para mostrar o modelo.

## Vínculos entre níveis e elementos

Paredes e pilares criados com o topo encaixado em outro nível passam a armazenar:

- nível-base;
- nível-superior;
- deslocamento da base;
- deslocamento do topo.

Quando a cota do nível superior muda, a altura é recalculada. Quando a cota-base muda, o elemento é deslocado e sua altura é recalculada para continuar conectado ao topo.

Vigas, lajes e fundações permanecem hospedadas no pavimento IFC. Como os produtos deste projeto usam coordenadas globais, a edição da cota do pavimento também desloca os elementos contidos nele.

## Arquitetura principal

- `frontend/src/components/ProjectBrowser.jsx`: navegador e propriedades das vistas.
- `frontend/src/view/viewModel.js`: modelos de vista, criação e reconciliação com níveis.
- `frontend/src/view/viewStorage.js`: persistência das vistas no navegador.
- `frontend/src/components/ThreeCanvas.jsx`: câmeras, clipping, visibilidade e caixa de corte.
- `frontend/src/components/IfcPanel.jsx`: integração entre níveis IFC, vistas e ferramentas.
- `backend/app/services/spatial_service.py`: movimentação de elementos hospedados e regeneração de paredes/pilares vinculados.
- `backend/app/services/geometry_service.py`: gravação dos vínculos no `Pset_ParametricSource`.

## Limitações atuais

- O corte é criado por eixo e coordenada; ainda não há marcador interativo de dois pontos desenhado diretamente na planta.
- O plano de corte da planta controla a faixa visível, mas ainda não gera hachura automática nas faces cortadas.
- As vistas são persistidas no `localStorage` usando o identificador do modelo aberto; elas ainda não são gravadas como entidades IFC.
- As elevações padrão possuem profundidade de visualização, mas ainda não têm alças gráficas para editar a região de recorte no viewport.

## Fluxo de modelagem corrigido

Ao abrir o painel edIFC-UnB, um modelo em branco é inicializado automaticamente e a planta do primeiro nível é aberta. O usuário não precisa mais clicar em **Novo** antes de criar níveis ou grids.

Para pilares, vigas, fundações e lajes:

1. crie um grid U/V no painel lateral;
2. escolha o nível ativo no Navegador do Projeto;
3. clique em **PIL**, **VIG**, **FUND** ou **LAJE**;
4. o programa abre automaticamente a planta correspondente;
5. clique nas interseções do grid;
6. use **3D** para converter os elementos desenhados em objetos IFC.

Quando uma ferramenta que depende do grid é acionada sem existir um grid, o programa agora apresenta uma mensagem explícita em vez de ignorar o clique.

## Correção do enquadramento do grid

Os planos visuais de nível têm extensão mínima de 1000 m. Eles não podem fazer
parte do cálculo automático da câmera, pois reduziriam um grid residencial a
poucos pixels. O enquadramento agora usa, nesta ordem:

1. as malhas do modelo IFC;
2. os eixos do grid IFC, quando o modelo ainda está vazio;
3. o plano de trabalho local como fallback.

Assim, ao clicar em **+ Grid**, os eixos e pontos de interseção permanecem em
escala utilizável para inserir pilares, vigas, fundações e lajes.
