/**
 * src/ifc/tools/index.js
 *
 * Registro das ferramentas de inserção. Para adicionar uma geometria nova:
 *   1. crie src/ifc/geometry/<forma>.js (função pura → BufferGeometry);
 *   2. crie src/ifc/tools/<forma>Tool.js (copie columnTool.js);
 *   3. adicione UMA linha aqui.
 *
 * O IfcPanel monta o seletor, os campos do formulário e o botão a partir deste
 * objeto — não há `if` por tipo na UI.
 */
import { wallTool } from "./wallTool.js";
import { slabTool } from "./slabTool.js";
import { beamTool } from "./beamTool.js";
import { columnTool } from "./columnTool.js";

export const INSERTION_TOOLS = {
  [wallTool.id]: wallTool,
  [slabTool.id]: slabTool,
  [beamTool.id]: beamTool,
  [columnTool.id]: columnTool,
};
