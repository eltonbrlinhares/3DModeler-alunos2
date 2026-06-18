/**
 * src/ifc/tools/wallTool.js — ferramenta de inserção de PAREDE.
 *
 * Máquina de estados: first (1º ponto em planta) → second (2º ponto, eixo) →
 * height (arrasta a altura com snap nos níveis superiores) → conclui.
 */
import * as THREE from "three";
import { wallBox } from "../geometry/wallBox.js";
import { WALL_MIN_HEIGHT } from "../insertion/constants.js";

const status = (snapLevel, height) =>
  snapLevel
    ? `Parede: altura encaixada no nível ${snapLevel.name ?? "superior"} (${height.toFixed(2)} m). Clique para concluir.`
    : "Parede: mova o mouse para ajustar a altura e clique para concluir.";

const insertionPoint = (ctx, ev) =>
  ctx.snapToGrid(ev)?.point ?? ctx.pointOnLevel(ev);

function drawWall(ctx, p1, height, snapLevel, mode = "height") {
  const thickness = Number(ctx.form.thickness) || 0.2;
  const geo = wallBox(ctx.p0, p1, thickness, height);
  if (!geo) return;
  const snapped = Boolean(snapLevel);
  const opacity = mode === "height" ? (snapped ? 0.5 : 0.42) : 0.28;
  ctx.preview.begin("ifc-wall-construction-preview").solid(geo, {
    fill: snapped ? 0xf59e0b : 0x22d3ee,
    edge: snapped ? 0xfff7ed : 0xe0f2fe,
    opacity,
  });
  ctx.height = height;
}

function finishWall(ctx) {
  if (!ctx.p0 || !ctx.p1) return;
  const thickness = Number(ctx.form.thickness) || 0.2;
  const height = Math.max(
    WALL_MIN_HEIGHT,
    Number(ctx.height) || Number(ctx.form.height) || 3
  );
  const dx = ctx.p1.x - ctx.p0.x;
  const dy = ctx.p1.y - ctx.p0.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.05) {
    ctx.cancel("Parede muito curta. Inserção cancelada.");
    return;
  }
  const rotation_z = Math.atan2(dy, dx);
  const perp = new THREE.Vector3(-Math.sin(rotation_z), Math.cos(rotation_z), 0);
  const origin = ctx.p0.clone().addScaledVector(perp, -thickness / 2);
  ctx.commit(
    ctx.api.createWall,
    {
      name: ctx.nextName(),
      length,
      height,
      thickness,
      position: [origin.x, origin.y, origin.z],
      rotation_z,
      storey_guid: ctx.level.guid,
    },
    "Parede"
  );
}

export const wallTool = {
  id: "wall",
  label: "Parede",
  prefix: "W",
  fields: ["thickness"],
  defaults: { height: 3, thickness: 0.2 },
  minIntersections: 0,

  start(ctx) {
    ctx.phase = "first";
    return `Parede: clique o primeiro ponto no nível ${ctx.level.name ?? ""}.`;
  },

  onPointerDown(ctx, ev) {
    if (ctx.phase === "first") {
      const p = insertionPoint(ctx, ev);
      if (!p) return;
      ctx.p0 = p.clone();
      ctx.phase = "second";
      ctx.setStatus("Parede: clique o segundo ponto do eixo em planta.");
    } else if (ctx.phase === "second") {
      const p = insertionPoint(ctx, ev);
      if (!p || p.distanceTo(ctx.p0) < 0.05) return;
      ctx.p1 = p.clone();
      ctx.phase = "height";
      ctx.heightStartY = ev.clientY;
      const snap = ctx.snapHeight(Number(ctx.form.height) || 3);
      ctx.snapLevelGuid = snap.level?.guid ?? null;
      drawWall(ctx, ctx.p1, snap.height, snap.level);
      ctx.setStatus(status(snap.level, snap.height));
    } else if (ctx.phase === "height") {
      finishWall(ctx);
    }
  },

  onPointerMove(ctx, ev) {
    if (ctx.phase === "second" && ctx.p0) {
      const p = insertionPoint(ctx, ev);
      if (p) drawWall(ctx, p, 0.04, null, "plan");
    } else if (ctx.phase === "height" && ctx.p0 && ctx.p1) {
      const { height, level } = ctx.snapHeight(ctx.dragHeight(ev));
      drawWall(ctx, ctx.p1, height, level);
      const guid = level?.guid ?? null;
      if (guid !== ctx.snapLevelGuid) {
        ctx.snapLevelGuid = guid;
        ctx.setStatus(status(level, height));
      }
    }
  },
};
