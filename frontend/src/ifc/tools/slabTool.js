/**
 * src/ifc/tools/slabTool.js — ferramenta de inserção de LAJE.
 *
 * Máquina de estados: polygon (clica interseções de grid formando o contorno).
 * Fecha de três formas: clicar no 1º ponto, duplo-clique ou Enter.
 * `ctx.form.axisRef` ("top" | "center" | "bottom") define o que o contorno
 * clicado representa na espessura da laje — ver slabPrism.js.
 */
import {
  slabPrism,
  polygonAreaXY,
  localSlabPolyline,
} from "../geometry/slabPrism.js";
import { BEAM_MIN_LENGTH, SLAB_MIN_AREA } from "../insertion/constants.js";

function drawSlab(ctx, candidate = null) {
  if (!ctx.points?.length) return;
  const thickness = Number(ctx.form.thickness) || 0.25;
  const axisRef = ctx.form.axisRef || "top";
  const pts = candidate ? [...ctx.points, candidate.clone()] : [...ctx.points];
  const pv = ctx.preview.begin("ifc-slab-construction-preview");
  if (pts.length >= 2) {
    pv.line([...pts, pts[0]], { color: 0xffffff, opacity: 1, depthTest: false });
  }
  if (pts.length >= 3) {
    const geo = slabPrism(pts, thickness, axisRef);
    if (geo) pv.solid(geo, { fill: 0x38bdf8, edge: 0xe0f2fe, opacity: 0.38 });
  }
  ctx.candidate = candidate?.clone() ?? null;
}

// deslocamento (em Z) da BASE de extrusão (o que o backend espera em
// `position`) em relação ao contorno clicado, conforme o que ele representa
function baseOffset(thickness, axisRef) {
  if (axisRef === "bottom") return 0; // contorno já é a base
  if (axisRef === "center") return -thickness / 2;
  return -thickness; // "top" (padrão): contorno é o topo
}

function finishSlab(ctx) {
  if (!ctx.points || ctx.points.length < 3) {
    ctx.setStatus("Laje: informe ao menos 3 pontos.");
    return;
  }
  if (Math.abs(polygonAreaXY(ctx.points)) < SLAB_MIN_AREA) {
    ctx.setStatus("Laje: o polígono está muito pequeno ou inválido.");
    return;
  }
  const thickness = Number(ctx.form.thickness) || 0.25;
  const axisRef = ctx.form.axisRef || "top";
  const origin = ctx.points[0].clone();
  origin.z += baseOffset(thickness, axisRef);
  ctx.commit(
    ctx.api.createSlab,
    {
      name: ctx.nextName(),
      thickness,
      polyline: localSlabPolyline(ctx.points),
      position: [origin.x, origin.y, origin.z],
      rotation_z: 0,
      storey_guid: ctx.level.guid,
    },
    "Laje"
  );
}

export const slabTool = {
  id: "slab",
  label: "Laje",
  prefix: "S",
  fields: ["thickness"],
  defaults: { thickness: 0.25, axisRef: "top" },
  minIntersections: 3,

  start(ctx) {
    ctx.phase = "polygon";
    ctx.points = [];
    return `Laje: clique as interseções no nível ${ctx.level.name ?? ""}. Para fechar: clique no 1º ponto, duplo-clique ou Enter.`;
  },

  onPointerDown(ctx, ev) {
    const snap = ctx.snapToGrid(ev);
    if (!snap) {
      ctx.setStatus("Laje: aproxime o mouse de uma interseção grid/nível.");
      return;
    }
    const point = snap.point.clone();
    const first = ctx.points[0];
    const last = ctx.points[ctx.points.length - 1];
    if (first && ctx.points.length >= 3 && point.distanceTo(first) < BEAM_MIN_LENGTH) {
      finishSlab(ctx);
      return;
    }
    if (last && point.distanceTo(last) < BEAM_MIN_LENGTH) {
      ctx.setStatus("Laje: escolha uma próxima interseção diferente.");
      return;
    }
    if (ctx.points.some((p) => p.distanceTo(point) < BEAM_MIN_LENGTH)) {
      ctx.setStatus("Laje: esse ponto já foi usado. Clique o primeiro ponto para fechar.");
      return;
    }
    ctx.points.push(point);
    drawSlab(ctx);
    ctx.setStatus(
      ctx.points.length < 3
        ? "Laje: continue clicando interseções do contorno."
        : "Laje: clique mais pontos ou feche (1º ponto, duplo-clique ou Enter)."
    );
  },

  onPointerMove(ctx, ev) {
    if (!ctx.points?.length) return;
    const snap = ctx.snapToGrid(ev);
    drawSlab(ctx, snap?.point ?? null);
  },

  onKey(ctx, key) {
    if (key === "Enter") finishSlab(ctx);
  },

  onDoubleClick(ctx, ev) {
    if ((ctx.points?.length ?? 0) >= 3) {
      ev.preventDefault?.();
      ev.stopPropagation?.();
      finishSlab(ctx);
    }
  },
};
