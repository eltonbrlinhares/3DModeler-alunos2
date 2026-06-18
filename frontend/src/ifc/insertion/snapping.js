/**
 * src/ifc/insertion/snapping.js
 *
 * Helpers de geometria de tela ↔ mundo usados por todas as ferramentas:
 *   - projetar o mouse num plano de nível;
 *   - encontrar a interseção de grid mais próxima do mouse;
 *   - encaixar uma altura nas elevações dos níveis superiores.
 *
 * Funções puras: recebem `{ camera, dom, grids, levels }` explicitamente,
 * sem ler nenhum estado global. Isso as torna fáceis de testar e de entender.
 */
import * as THREE from "three";
import {
  DATUM_SNAP_PIXEL_RADIUS,
  WALL_MIN_HEIGHT,
  WALL_HEIGHT_SNAP_TOLERANCE,
} from "./constants.js";

/** Cópia "congelada" do nível ativo no início da inserção. */
export const lockedLevelCopy = (level) => ({
  guid: level?.guid ?? null,
  name: level?.name ?? "Level 0",
  elevation: Number(level?.elevation ?? 0) || 0,
});

/** Posições únicas dos eixos de grid na direção "u" (X) ou "v" (Y). */
export function uniqueAxisPositions(grids, direction) {
  const axes = (grids ?? []).flatMap((grid) =>
    direction === "u" ? grid.u_axes ?? [] : grid.v_axes ?? []
  );
  const values = axes.map((axis) =>
    direction === "u"
      ? ((axis.p0?.[0] ?? 0) + (axis.p1?.[0] ?? 0)) / 2
      : ((axis.p0?.[1] ?? 0) + (axis.p1?.[1] ?? 0)) / 2
  );
  return Array.from(new Map(values.map((v) => [v.toFixed(6), v])).values()).sort(
    (a, b) => a - b
  );
}

/** Todas as interseções U×V de grid no plano do nível (Vector3). */
export function gridLevelIntersections(grids, level) {
  const xs = uniqueAxisPositions(grids, "u");
  const ys = uniqueAxisPositions(grids, "v");
  const z = Number(level?.elevation ?? 0) || 0;
  const points = [];
  for (const x of xs) {
    for (const y of ys) points.push(new THREE.Vector3(x, y, z));
  }
  return points;
}

/** Ponto no plano Z = elevação sob o mouse (sem snap). */
export function eventPointOnLevel(ev, elevation, { camera, dom }) {
  if (!camera || !dom) return null;
  const rect = dom.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((ev.clientX - rect.left) / rect.width) * 2 - 1,
    -((ev.clientY - rect.top) / rect.height) * 2 + 1
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -elevation);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
}

/** Interseção de planos de datum mais próxima do mouse, dentro do raio de snap (px). */
export function snapPointOnGridLevel(ev, level, { camera, dom, grids, datumPoints }) {
  if (!camera || !dom) return null;
  const rect = dom.getBoundingClientRect();
  const mouseX = ev.clientX - rect.left;
  const mouseY = ev.clientY - rect.top;
  let best = null;
  const z = Number(level?.elevation ?? 0) || 0;
  const levelDatumPoints = (datumPoints ?? []).filter(
    (point) => Math.abs(point.z - z) <= 1e-6
  );
  const points = levelDatumPoints.length
    ? levelDatumPoints
    : gridLevelIntersections(grids, level);
  for (const point of points) {
    const projected = point.clone().project(camera);
    if (projected.z < -1 || projected.z > 1) continue;
    const x = (projected.x * 0.5 + 0.5) * rect.width;
    const y = (-projected.y * 0.5 + 0.5) * rect.height;
    const distance = Math.hypot(mouseX - x, mouseY - y);
    if (distance <= DATUM_SNAP_PIXEL_RADIUS && (!best || distance < best.distance)) {
      best = { point: point.clone(), distance };
    }
  }
  return best;
}

/**
 * Encaixa `rawHeight` na elevação de um nível acima do nível-base, se houver um
 * dentro da tolerância. Retorna `{ height, level }` (level = null se livre).
 */
export function snappedWallHeight(levels, baseLevel, rawHeight) {
  const height = Math.max(WALL_MIN_HEIGHT, rawHeight);
  const baseElevation = Number(baseLevel?.elevation ?? 0) || 0;
  const snap = (levels ?? [])
    .map((level) => ({
      level: lockedLevelCopy(level),
      height: (Number(level.elevation ?? 0) || 0) - baseElevation,
    }))
    .filter(({ height: h }) => h > WALL_MIN_HEIGHT)
    .sort((a, b) => a.height - b.height)
    .find(({ height: h }) => Math.abs(h - height) <= WALL_HEIGHT_SNAP_TOLERANCE);
  return snap ? { height: snap.height, level: snap.level } : { height, level: null };
}
