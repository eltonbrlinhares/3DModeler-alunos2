/**
 * src/ifc/geometry/columnBox.js
 *
 * Função PURA: caixa width×depth centrada em `base` (XY), extrudada de base.z
 * até base.z + height — igual ao backend, que extruda o IfcRectangleProfileDef
 * centrado no placement, na vertical (+Z).
 */
import * as THREE from "three";

/**
 * @param {THREE.Vector3} base ponto-base (centro da seção, no nível)
 * @param {number} width largura X da seção (m)
 * @param {number} depth profundidade Y da seção (m)
 * @param {number} height altura de extrusão (m)
 * @returns {THREE.BufferGeometry}
 */
export function columnBox(base, width, depth, height) {
  const hw = width / 2;
  const hd = depth / 2;
  const z0 = base.z;
  const z1 = z0 + Math.max(0.02, height);
  const x0 = base.x - hw;
  const x1 = base.x + hw;
  const y0 = base.y - hd;
  const y1 = base.y + hd;
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
