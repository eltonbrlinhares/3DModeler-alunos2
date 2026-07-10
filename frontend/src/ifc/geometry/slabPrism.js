/**
 * src/ifc/geometry/slabPrism.js
 *
 * Funções PURAS para a laje: área assinada do polígono, prisma extrudado a
 * partir do contorno clicado, e conversão do contorno para coordenadas locais
 * (relativas ao primeiro ponto) no formato que o backend espera.
 */
import * as THREE from "three";
import { SLAB_MIN_AREA } from "../insertion/constants.js";

/** Área assinada (XY) do polígono — positiva se anti-horário. */
export function polygonAreaXY(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/**
 * Prisma da laje a partir do contorno clicado (lista de Vector3 no nível).
 * `axisRef` define o que o contorno clicado representa na espessura:
 *   - "top"    (padrão): contorno = TOPO da laje, extruda para baixo
 *   - "bottom": contorno = BASE da laje, extruda para cima
 *   - "center": contorno = CENTRO (meia espessura), extruda para os dois lados
 * @param {THREE.Vector3[]} points contorno (>= 3 pontos)
 * @param {number} thickness espessura (m)
 * @param {"top"|"center"|"bottom"} [axisRef="top"] o que o contorno representa
 * @returns {THREE.BufferGeometry|null}
 */
export function slabPrism(points, thickness, axisRef = "top") {
  if (points.length < 3 || Math.abs(polygonAreaXY(points)) < SLAB_MIN_AREA) {
    return null;
  }
  const t = Math.max(0.02, thickness);
  let topZ;
  if (axisRef === "bottom") {
    topZ = points[0].z + t;
  } else if (axisRef === "center") {
    topZ = points[0].z + t / 2;
  } else {
    topZ = points[0].z; // "top" (padrão)
  }
  const bottomZ = topZ - t;
  const shapePoints = points.map((p) => new THREE.Vector2(p.x, p.y));
  const triangles = THREE.ShapeUtils.triangulateShape(shapePoints, []);
  if (!triangles.length) return null;
  const verts = [];
  points.forEach((p) => verts.push(p.x, p.y, topZ));
  points.forEach((p) => verts.push(p.x, p.y, bottomZ));

  const idx = [];
  const ccw = polygonAreaXY(points) > 0;
  triangles.forEach(([a, b, c]) => {
    if (ccw) idx.push(a, c, b);
    else idx.push(a, b, c);
  });
  const offset = points.length;
  triangles.forEach(([a, b, c]) => {
    if (ccw) idx.push(offset + a, offset + b, offset + c);
    else idx.push(offset + a, offset + c, offset + b);
  });
  for (let i = 0; i < points.length; i += 1) {
    const j = (i + 1) % points.length;
    if (ccw) idx.push(i, j, offset + j, i, offset + j, offset + i);
    else idx.push(i, offset + j, j, i, offset + i, offset + j);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Contorno em coordenadas locais (relativas ao 1º ponto): [[dx,dy], …]. */
export function localSlabPolyline(points) {
  const origin = points[0];
  return points.map((p) => [p.x - origin.x, p.y - origin.y]);
}
