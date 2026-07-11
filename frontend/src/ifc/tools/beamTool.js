/**
 * src/ifc/tools/beamTool.js — ferramenta de inserção de VIGA.
 *
 * Máquina de estados: first (interseção de grid do início do eixo) → second
 * (interseção do fim) → conclui. A seção (width×depth) vem do formulário, e
 * `ctx.form.axisRef` ("top" | "center" | "bottom") define o que o eixo
 * clicado (linha de grid) representa na viga — ver beamBox.js.
 */
import { beamBox } from "../geometry/beamBox.js";
import { BEAM_MIN_LENGTH } from "../insertion/constants.js";

function drawBeam(ctx, p1) {
  const width = Number(ctx.form.width) || 0.2;
  const depth = Number(ctx.form.depth) || 0.3;
  const axisRef = ctx.form.axisRef || "top";
  const geo = beamBox(ctx.p0, p1, width, depth, axisRef);
  if (!geo) return;
  ctx.preview
    .begin("ifc-beam-construction-preview")
    .solid(geo, { fill: 0xf97316, edge: 0xffedd5, opacity: 0.46 })
    .line([ctx.p0, p1], { color: 0xffffff, opacity: 1, depthTest: false });
}

// deslocamento (em Z) do centro da seção em relação ao eixo clicado,
// conforme o que esse eixo representa
function centerOffset(depth, axisRef) {
  if (axisRef === "bottom") return depth / 2;
  if (axisRef === "center") return 0;
  return -depth / 2; // "top" (padrão)
}

function finishBeam(ctx) {
  if (!ctx.p0 || !ctx.p1) return;
  const width = Number(ctx.form.width) || 0.2;
  const depth = Number(ctx.form.depth) || 0.3;
  const axisRef = ctx.form.axisRef || "top";
  const dx = ctx.p1.x - ctx.p0.x;
  const dy = ctx.p1.y - ctx.p0.y;
  const length = Math.hypot(dx, dy);
  if (length < BEAM_MIN_LENGTH) {
    ctx.setStatus("Viga: escolha uma segunda interseção diferente.");
    return;
  }
  const rotation_z = Math.atan2(dy, dx);
  const origin = ctx.p0.clone();
  origin.z += centerOffset(depth, axisRef);
  const { profile, shape, h, b, tw, tf } = ctx.form;
  ctx.commit(
    ctx.api.createBeam,
    {
      name: ctx.nextName(),
      width,
      depth,
      length,
      position: [origin.x, origin.y, origin.z],
      rotation_z,
      storey_guid: ctx.level.guid,
      // perfil real (I/H/U/L/tubular), quando um perfil de catálogo ou
      // personalizado estiver selecionado no formulário (aba "Metálica")
      ...(profile && shape && h && b && tw && tf
        ? { profile, shape, h: Number(h), b: Number(b), tw: Number(tw), tf: Number(tf) }
        : {}),
    },
    "Viga"
  );
}

export const beamTool = {
  id: "beam",
  label: "Viga",
  prefix: "B",
  fields: ["width", "depth"],
  defaults: { width: 0.2, depth: 0.3, axisRef: "top" },
  minIntersections: 2,

  start(ctx) {
    ctx.phase = "first";
    return `Viga: clique uma interseção de grid no nível ${ctx.level.name ?? ""}.`;
  },

  onPointerDown(ctx, ev) {
    const snap = ctx.snapToGrid(ev);
    if (!snap) {
      ctx.setStatus("Viga: aproxime o mouse de uma interseção grid/nível.");
      return;
    }
    if (ctx.phase === "first") {
      ctx.p0 = snap.point.clone();
      ctx.phase = "second";
      ctx.setStatus("Viga: clique a segunda interseção para definir o eixo.");
    } else if (ctx.phase === "second") {
      if (snap.point.distanceTo(ctx.p0) < BEAM_MIN_LENGTH) {
        ctx.setStatus("Viga: escolha uma segunda interseção diferente.");
        return;
      }
      ctx.p1 = snap.point.clone();
      drawBeam(ctx, ctx.p1);
      finishBeam(ctx);
    }
  },

  onPointerMove(ctx, ev) {
    if (ctx.phase === "second" && ctx.p0) {
      const snap = ctx.snapToGrid(ev);
      if (snap) drawBeam(ctx, snap.point);
    }
  },
};
