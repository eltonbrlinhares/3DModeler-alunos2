/**
 * src/ifc/geometry/wallBox.js
 *
 * Função PURA: dado o eixo da parede (p0→p1) em planta, a espessura e a altura,
 * devolve a `THREE.BufferGeometry` da caixa para o preview. Sem estado, sem React.
 */
import * as THREE from "three";

/**
 * @param {THREE.Vector3} p0 início do eixo em planta (z = base)
 * @param {THREE.Vector3} p1 fim do eixo em planta
 * @param {number} thickness espessura (m)
 * @param {number} height altura (m)
 * @returns {THREE.BufferGeometry|null}
 */
export function wallBox(p0, p1, thickness, height) {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = Math.hypot(dir.x, dir.y);
  if (len < 1e-6) return null;
  dir.set(dir.x / len, dir.y / len, 0);
  const perp = new THREE.Vector3(-dir.y, dir.x, 0).multiplyScalar(thickness / 2);
  const z0 = p0.z;
  const z1 = z0 + Math.max(0.02, height);
  const a = p0.clone().add(perp);
  const b = p1.clone().add(perp);
  const c = p1.clone().sub(perp);
  const d = p0.clone().sub(perp);
  const verts = [
    a.x, a.y, z0, b.x, b.y, z0, c.x, c.y, z0, d.x, d.y, z0,
    a.x, a.y, z1, b.x, b.y, z1, c.x, c.y, z1, d.x, d.y, z1,
  ];
  const idx = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
