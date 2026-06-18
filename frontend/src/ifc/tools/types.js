/**
 * src/ifc/tools/types.js
 *
 * Contrato (apenas JSDoc — o projeto não usa TypeScript) das ferramentas de
 * inserção. Cada geometria é UM objeto `InsertionTool`. O `InsertionController`
 * cria o `InsertionContext` e chama os callbacks da ferramenta.
 *
 * Este arquivo não exporta código — serve de documentação e de "molde" para o
 * aluno. Para criar uma geometria nova, copie `columnTool.js`.
 */

/**
 * @typedef {Object} LevelRef
 * @property {string|null} guid
 * @property {string} name
 * @property {number} elevation
 */

/**
 * Tudo que uma ferramenta recebe. Não há React nem acesso direto à cena aqui.
 * @typedef {Object} InsertionContext
 * @property {InsertionTool} tool       a própria ferramenta
 * @property {LevelRef} level           nível-base travado no início
 * @property {string} phase             estado da máquina (a ferramenta define)
 * @property {Object} form              valores atuais do formulário (atualizados a cada evento)
 * @property {Object} api               o ifcApi (createWall, createColumn…)
 * @property {{begin:Function, solid:Function, line:Function, clear:Function}} preview
 *
 * @property {(ev:PointerEvent) => ({point:import("three").Vector3}|null)} snapToGrid
 * @property {(ev:PointerEvent) => import("three").Vector3|null} pointOnLevel
 * @property {(raw:number) => {height:number, level:LevelRef|null}} snapHeight
 * @property {(ev:PointerEvent) => number} dragHeight  altura corrente do arraste vertical
 *
 * @property {(msg:string) => void} setStatus
 * @property {(msg?:string) => void} cancel
 * @property {() => string} nextName    próximo nome sequencial (W3, C2…)
 * @property {(apiFn:Function, payload:Object, label:string) => Promise<void>} commit
 *
 * // campos livres que a ferramenta guarda entre eventos: p0, p1, base, points,
 * // height, heightStartY, snapLevelGuid, candidate…
 */

/**
 * @typedef {Object} InsertionTool
 * @property {string}   id              "wall" | "slab" | "column" | "beam"
 * @property {string}   label           rótulo na UI ("Pilar")
 * @property {string}   prefix          prefixo do nome sequencial ("C")
 * @property {string[]} fields          campos numéricos exibidos no formulário
 * @property {Object}   defaults        valores iniciais do formulário
 * @property {number}   [minIntersections] interseções de grid exigidas (0 = não exige)
 *
 * @property {(ctx:InsertionContext) => string} start
 *           inicializa ctx.phase e retorna a mensagem inicial.
 * @property {(ctx:InsertionContext, ev:PointerEvent) => void} onPointerDown
 *           avança a máquina de estados; ao final chama ctx.commit.
 * @property {(ctx:InsertionContext, ev:PointerEvent) => void} [onPointerMove]
 *           atualiza o preview ao mover o mouse.
 * @property {(ctx:InsertionContext, key:string, ev:KeyboardEvent) => void} [onKey]
 * @property {(ctx:InsertionContext, ev:MouseEvent) => void} [onDoubleClick]
 */

export {};
