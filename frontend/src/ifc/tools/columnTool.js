/**
 * src/ifc/tools/columnTool.js — ferramenta de inserção de PILAR.
 *
 * Máquina de estados: base (interseção de grid) → height (arrasta a altura com
 * snap nos níveis superiores) → conclui. A seção (width×depth) vem do
 * formulário; a altura é definida pelo mouse (sem campo no formulário).
 *
 * O eixo vertical da coluna sempre sobe a partir do ponto clicado (sem
 * ambiguidade de topo/centro/base). `ctx.form.refX`/`ctx.form.refY`
 * ("start" | "center" | "end") definem por qual ponto da SEÇÃO em planta esse
 * eixo passa — ver columnBox.js.
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
  const refX = ctx.form.refX || "center";
  const refY = ctx.form.refY || "center";
  const geo = columnBox(ctx.base, width, depth, height, refX, refY);
  if (!geo) return;
  const snapped = Boolean(snapLevel);
  ctx.preview.begin("ifc-column-construction-preview").solid(geo, {
    fill: snapped ? 0xf59e0b : 0xa78bfa,
    edge: snapped ? 0xfff7ed : 0xede9fe,
    opacity: snapped ? 0.5 : 0.42,
  });
  ctx.height = height;
}

// deslocamento (em X/Y) do CENTRO da seção (o que o backend espera em
// `position`) em relação ao ponto clicado, conforme por qual ponto da seção
// esse ponto passa
function centerOffset(size, ref) {
  if (ref === "start") return size / 2;
  if (ref === "end") return -size / 2;
  return 0; // "center" (padrão)
}

function finishColumn(ctx) {
  if (!ctx.base) return;
  const width = Number(ctx.form.width) || 0.4;
  const depth = Number(ctx.form.depth) || 0.4;
  const height = Math.max(
    WALL_MIN_HEIGHT,
    Number(ctx.height) || Number(ctx.form.height) || 3
  );
  const refX = ctx.form.refX || "center";
  const refY = ctx.form.refY || "center";
  const origin = ctx.base.clone();
  origin.x += centerOffset(width, refX);
  origin.y += centerOffset(depth, refY);
  const { profile, shape, h, b, tw, tf } = ctx.form;
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
      top_level_guid: ctx.snapLevelGuid ?? null,
      base_offset: 0,
      top_offset: 0,
      // perfil real (I/H/U/L/tubular), quando um perfil de catálogo ou
      // personalizado estiver selecionado no formulário (aba "Metálica")
      ...(profile && shape && h && b && tw && tf
        ? { profile, shape, h: Number(h), b: Number(b), tw: Number(tw), tf: Number(tf) }
        : {}),
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
  defaults: { width: 0.4, depth: 0.4, height: 3, refX: "center", refY: "center" },
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
