/**
 * src/ifc/geometry/beamBox.js
 *
 * Função PURA: viga de seção width×depth pendurada ABAIXO do eixo superior
 * p0→p1 (o eixo marca o topo da viga). Devolve a `THREE.BufferGeometry`.
 */
import * as THREE from "three";

/**
 * @param {THREE.Vector3} p0 início do eixo superior
 * @param {THREE.Vector3} p1 fim do eixo superior
 * @param {number} width largura da seção (m)
 * @param {number} depth altura da seção (m)
 * @returns {THREE.BufferGeometry|null}
 */
export function beamBox(p0, p1, width, depth) {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = Math.hypot(dir.x, dir.y);
  if (len < 1e-6) return null;
  dir.set(dir.x / len, dir.y / len, 0);
  const perp = new THREE.Vector3(-dir.y, dir.x, 0).multiplyScalar(width / 2);
  const topZ = p0.z;
  const bottomZ = topZ - Math.max(0.02, depth);
  const a = p0.clone().add(perp);
  const b = p1.clone().add(perp);
  const c = p1.clone().sub(perp);
  const d = p0.clone().sub(perp);
  const verts = [
    a.x, a.y, topZ, b.x, b.y, topZ, c.x, c.y, topZ, d.x, d.y, topZ,
    a.x, a.y, bottomZ, b.x, b.y, bottomZ, c.x, c.y, bottomZ, d.x, d.y, bottomZ,
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
