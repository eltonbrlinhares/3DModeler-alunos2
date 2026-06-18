/**
 * src/ifc/tools/beamTool.js — ferramenta de inserção de VIGA.
 *
 * Máquina de estados: first (interseção de grid do início do eixo superior) →
 * second (interseção do fim) → conclui. A seção (width×depth) vem do formulário.
 */
import { beamBox } from "../geometry/beamBox.js";
import { BEAM_MIN_LENGTH } from "../insertion/constants.js";

function drawBeam(ctx, p1) {
  const width = Number(ctx.form.width) || 0.2;
  const depth = Number(ctx.form.depth) || 0.3;
  const geo = beamBox(ctx.p0, p1, width, depth);
  if (!geo) return;
  ctx.preview
    .begin("ifc-beam-construction-preview")
    .solid(geo, { fill: 0xf97316, edge: 0xffedd5, opacity: 0.46 })
    .line([ctx.p0, p1], { color: 0xffffff, opacity: 1, depthTest: false });
}

function finishBeam(ctx) {
  if (!ctx.p0 || !ctx.p1) return;
  const width = Number(ctx.form.width) || 0.2;
  const depth = Number(ctx.form.depth) || 0.3;
  const dx = ctx.p1.x - ctx.p0.x;
  const dy = ctx.p1.y - ctx.p0.y;
  const length = Math.hypot(dx, dy);
  if (length < BEAM_MIN_LENGTH) {
    ctx.setStatus("Viga: escolha uma segunda interseção diferente.");
    return;
  }
  const rotation_z = Math.atan2(dy, dx);
  const origin = ctx.p0.clone();
  origin.z -= depth / 2;
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
    },
    "Viga"
  );
}

export const beamTool = {
  id: "beam",
  label: "Viga",
  prefix: "B",
  fields: ["width", "depth"],
  defaults: { width: 0.2, depth: 0.3 },
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
      ctx.setStatus("Viga: clique a segunda interseção para definir o eixo superior.");
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
