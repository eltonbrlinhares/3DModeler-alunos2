/**
 * src/ifc/geometry/beamBox.js
 *
 * Função PURA: viga de seção width×depth posicionada em relação ao eixo
 * p0→p1 conforme `axisRef`:
 *   - "top"    (padrão): o eixo marca o TOPO da viga (viga pendurada abaixo)
 *   - "bottom": o eixo marca a BASE da viga (viga levantada acima)
 *   - "center": o eixo marca o CENTRO da seção (viga distribuída meio a meio)
 * Devolve a `THREE.BufferGeometry`.
 */
import * as THREE from "three";

/**
 * @param {THREE.Vector3} p0 início do eixo
 * @param {THREE.Vector3} p1 fim do eixo
 * @param {number} width largura da seção (m)
 * @param {number} depth altura da seção (m)
 * @param {"top"|"bottom"|"center"} [axisRef="top"] o que o eixo p0→p1 representa
 * @returns {THREE.BufferGeometry|null}
 */
export function beamBox(p0, p1, width, depth, axisRef = "top") {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = Math.hypot(dir.x, dir.y);
  if (len < 1e-6) return null;
  dir.set(dir.x / len, dir.y / len, 0);
  const perp = new THREE.Vector3(-dir.y, dir.x, 0).multiplyScalar(width / 2);
  const d = Math.max(0.02, depth);
  let topZ;
  if (axisRef === "bottom") {
    topZ = p0.z + d;
  } else if (axisRef === "center") {
    topZ = p0.z + d / 2;
  } else {
    topZ = p0.z; // "top" (padrão / compatibilidade)
  }
  const bottomZ = topZ - d;
  const a = p0.clone().add(perp);
  const b = p1.clone().add(perp);
  const c = p1.clone().sub(perp);
  const dd = p0.clone().sub(perp);
  const verts = [
    a.x, a.y, topZ, b.x, b.y, topZ, c.x, c.y, topZ, dd.x, dd.y, topZ,
    a.x, a.y, bottomZ, b.x, b.y, bottomZ, c.x, c.y, bottomZ, dd.x, dd.y, bottomZ,
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
