/**
 * src/ifc/tools/columnTool.js — ferramenta de inserção de PILAR.
 *
 * Máquina de estados: base (interseção de grid) → height (arrasta a altura com
 * snap nos níveis superiores) → conclui. A seção (width×depth) vem do
 * formulário; a altura é definida pelo mouse (sem campo no formulário).
 */
import { columnBox } from "../geometry/columnBox.js";
import { WALL_MIN_HEIGHT } from "../insertion/constants.js";

const status = (snapLevel, height) =>
  snapLevel
    ? `Pilar: topo encaixado no nível ${snapLevel.name ?? "superior"} (${height.toFixed(2)} m). Clique para concluir.`
    : "Pilar: mova o mouse para ajustar a altura e clique para concluir.";

function drawColumn(ctx, height, snapLevel) {
  const width = Number(ctx.form.width) || 0.4;
  const depth = Number(ctx.form.depth) || 0.4;
  const geo = columnBox(ctx.base, width, depth, height);
  if (!geo) return;
  const snapped = Boolean(snapLevel);
  ctx.preview.begin("ifc-column-construction-preview").solid(geo, {
    fill: snapped ? 0xf59e0b : 0xa78bfa,
    edge: snapped ? 0xfff7ed : 0xede9fe,
    opacity: snapped ? 0.5 : 0.42,
  });
  ctx.height = height;
}

function finishColumn(ctx) {
  if (!ctx.base) return;
  const width = Number(ctx.form.width) || 0.4;
  const depth = Number(ctx.form.depth) || 0.4;
  const height = Math.max(
    WALL_MIN_HEIGHT,
    Number(ctx.height) || Number(ctx.form.height) || 3
  );
  const origin = ctx.base.clone();
  ctx.commit(
    ctx.api.createColumn,
    {
      name: ctx.nextName(),
      width,
      depth,
      height,
      position: [origin.x, origin.y, origin.z],
      rotation_z: 0,
      storey_guid: ctx.level.guid,
    },
    "Pilar"
  );
}

export const columnTool = {
  id: "column",
  label: "Coluna",
  prefix: "C",
  // altura é definida pelo mouse → sem campo "height" no formulário
  fields: ["width", "depth"],
  defaults: { width: 0.4, depth: 0.4, height: 3 },
  minIntersections: 1,

  start(ctx) {
    ctx.phase = "base";
    return `Pilar: clique a interseção de grid da base no nível ${ctx.level.name ?? ""}.`;
  },

  onPointerDown(ctx, ev) {
    if (ctx.phase === "base") {
      const snap = ctx.snapToGrid(ev);
      if (!snap) {
        ctx.setStatus("Pilar: aproxime o mouse de uma interseção grid/nível.");
        return;
      }
      ctx.base = snap.point.clone();
      ctx.phase = "height";
      ctx.heightStartY = ev.clientY;
      const snapH = ctx.snapHeight(Number(ctx.form.height) || 3);
      ctx.snapLevelGuid = snapH.level?.guid ?? null;
      drawColumn(ctx, snapH.height, snapH.level);
      ctx.setStatus(status(snapH.level, snapH.height));
    } else if (ctx.phase === "height") {
      finishColumn(ctx);
    }
  },

  onPointerMove(ctx, ev) {
    if (ctx.phase !== "height" || !ctx.base) return;
    const { height, level } = ctx.snapHeight(ctx.dragHeight(ev));
    drawColumn(ctx, height, level);
    const guid = level?.guid ?? null;
    if (guid !== ctx.snapLevelGuid) {
      ctx.snapLevelGuid = guid;
      ctx.setStatus(status(level, height));
    }
  },
};
