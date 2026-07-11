/**
 * src/ifc/tools/footingTool.js — ferramenta de inserção de FUNDAÇÃO RASA.
 *
 * Cria um IfcFooting: sapata isolada (PAD_FOOTING, tronco de pirâmide) ou
 * bloco sobre estacas (PILE_CAP, caixa reta) — ambos com pedestal opcional
 * em cima. Todos os campos vêm do formulário (sem UI genérica: os campos
 * mudam conforme `predefinedType`, então o IfcPanel monta o formulário
 * específico — ver bloco `elemType === "footing"`).
 *
 * Máquina de estados: single click na interseção de grid → conclui. Sem fase
 * de arraste de altura (ao contrário do pilar): as alturas da fundação são
 * sempre valores fixos vindos do formulário.
 */
import { footingMesh } from "../geometry/footingBox.js";

function readForm(ctx) {
  const isPileCap = ctx.form.predefinedType === "PILE_CAP";
  const baseWidth = Number(ctx.form.baseWidth) || 1.5;
  const baseLength = Number(ctx.form.baseLength) || 1.5;
  // bloco: caixa reta -> topo sempre igual à base (sem afunilamento)
  const topWidth = isPileCap ? baseWidth : Number(ctx.form.topWidth) || baseWidth;
  const topLength = isPileCap ? baseLength : Number(ctx.form.topLength) || baseLength;
  const height = Number(ctx.form.height) || 0.5;
  // "rodapé" reto opcional antes do afunilamento (o degrau na base do desenho)
  const baseHeight = Number(ctx.form.baseHeight) || 0;
  const usePedestal = Boolean(ctx.form.usePedestal);
  const pedestalWidth = usePedestal ? Number(ctx.form.pedestalWidth) || topWidth : null;
  const pedestalLength = usePedestal ? Number(ctx.form.pedestalLength) || topLength : null;
  const pedestalHeight = usePedestal ? Number(ctx.form.pedestalHeight) || 0 : 0;
  return {
    isPileCap,
    baseWidth,
    baseLength,
    topWidth,
    topLength,
    height,
    baseHeight,
    pedestalWidth,
    pedestalLength,
    pedestalHeight,
  };
}

function drawFooting(ctx, point) {
  const p = readForm(ctx);
  const geo = footingMesh(
    point,
    p.baseWidth,
    p.baseLength,
    p.topWidth,
    p.topLength,
    p.height,
    p.pedestalWidth,
    p.pedestalLength,
    p.pedestalHeight,
    p.baseHeight
  );
  if (!geo) return;
  ctx.preview.begin("ifc-footing-construction-preview").solid(geo, {
    fill: p.isPileCap ? 0xf97316 : 0x22c55e,
    edge: p.isPileCap ? 0xffedd5 : 0xbbf7d0,
    opacity: 0.42,
  });
}

function finishFooting(ctx, point) {
  const p = readForm(ctx);
  const totalHeight = p.baseHeight + p.height + p.pedestalHeight;
  // base da fundação: altura total abaixo do ponto clicado (o topo do
  // pedestal — ou do tronco, se não houver pedestal — encosta no nível
  // ativo, mesma convenção do axisRef="top" da laje).
  const origin = point.clone();
  origin.z -= totalHeight;
  ctx.commit(
    ctx.api.createFooting,
    {
      name: ctx.nextName(),
      predefined_type: p.isPileCap ? "PILE_CAP" : "PAD_FOOTING",
      base_width: p.baseWidth,
      base_length: p.baseLength,
      top_width: p.topWidth,
      top_length: p.topLength,
      height: p.height,
      ...(p.baseHeight > 0 ? { base_height: p.baseHeight } : {}),
      ...(p.pedestalHeight > 0
        ? {
            pedestal_width: p.pedestalWidth,
            pedestal_length: p.pedestalLength,
            pedestal_height: p.pedestalHeight,
          }
        : {}),
      position: [origin.x, origin.y, origin.z],
      rotation_z: 0,
      storey_guid: ctx.level.guid,
      ...(p.isPileCap && ctx.form.pileCount
        ? {
            pile_count: Number(ctx.form.pileCount),
            ...(ctx.form.pileDiameter
              ? { pile_diameter: Number(ctx.form.pileDiameter) }
              : {}),
          }
        : {}),
    },
    p.isPileCap ? "Bloco" : "Sapata"
  );
}

export const footingTool = {
  id: "footing",
  label: "Fundação (sapata/bloco)",
  prefix: "F",
  // campos renderizados manualmente no IfcPanel (mudam com predefinedType)
  fields: [],
  defaults: {
    predefinedType: "PAD_FOOTING",
    baseWidth: 1.5,
    baseLength: 1.5,
    baseHeight: 0.15,
    topWidth: 0.6,
    topLength: 0.6,
    height: 0.4,
    usePedestal: true,
    // por padrao igual ao topo do tronco -> pedestal "solda" direto, sem aba
    // horizontal (estilo sapata trapezoidal classica: base larga, tronco
    // afunilando ate o pedestal, sem degrau). Digite valores menores que
    // topWidth/topLength se quiser uma aba visivel.
    pedestalWidth: 0.6,
    pedestalLength: 0.6,
    pedestalHeight: 0.5,
    pileCount: 4,
    pileDiameter: 0.4,
  },
  minIntersections: 1,

  start(ctx) {
    ctx.phase = "base";
    return `Fundação: clique a interseção de grid no nível ${ctx.level.name ?? ""}.`;
  },

  onPointerDown(ctx, ev) {
    const snap = ctx.snapToGrid(ev);
    if (!snap) {
      ctx.setStatus("Fundação: aproxime o mouse de uma interseção grid/nível.");
      return;
    }
    finishFooting(ctx, snap.point.clone());
  },

  onPointerMove(ctx, ev) {
    const snap = ctx.snapToGrid(ev);
    if (!snap) return;
    drawFooting(ctx, snap.point.clone());
  },
};
