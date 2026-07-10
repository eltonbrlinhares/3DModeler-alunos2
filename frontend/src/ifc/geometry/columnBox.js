/**
 * src/ifc/geometry/columnBox.js
 *
 * Função PURA: caixa width×depth extrudada de base.z até base.z + height (o
 * eixo vertical da coluna sempre sobe a partir do ponto clicado — sem
 * ambiguidade de topo/centro/base, diferente de viga/laje).
 *
 * O que muda é por qual ponto da SEÇÃO (planta) o eixo vertical passa,
 * definido por `refX`/`refY`:
 *   - refX: "start" (face esquerda), "center" (padrão, centroide), "end" (face direita)
 *   - refY: "start" (face frontal),  "center" (padrão, centroide), "end" (face posterior)
 * Ex.: refX="start", refY="start" → o eixo passa pelo canto (x0,y0) da seção.
 */
import * as THREE from "three";

function axisOffset(size, ref) {
  if (ref === "start") return size / 2; // clicado = face inicial -> centro desloca +size/2
  if (ref === "end") return -size / 2; // clicado = face final -> centro desloca -size/2
  return 0; // "center" (padrão)
}

/**
 * @param {THREE.Vector3} base ponto clicado (referência em planta, no nível)
 * @param {number} width largura X da seção (m)
 * @param {number} depth profundidade Y da seção (m)
 * @param {number} height altura de extrusão (m)
 * @param {"start"|"center"|"end"} [refX="center"] o que `base.x` representa na largura
 * @param {"start"|"center"|"end"} [refY="center"] o que `base.y` representa na profundidade
 * @returns {THREE.BufferGeometry}
 */
export function columnBox(base, width, depth, height, refX = "center", refY = "center") {
  const cx = base.x + axisOffset(width, refX);
  const cy = base.y + axisOffset(depth, refY);
  const hw = width / 2;
  const hd = depth / 2;
  const z0 = base.z;
  const z1 = z0 + Math.max(0.02, height);
  const x0 = cx - hw;
  const x1 = cx + hw;
  const y0 = cy - hd;
  const y1 = cy + hd;
  const verts = [
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ];
  const idx = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
