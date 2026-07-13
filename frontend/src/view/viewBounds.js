import * as THREE from "three";

function finiteBoxFromObject(object) {
  if (!object) return null;
  object.updateWorldMatrix?.(true, true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  const values = [...box.min.toArray(), ...box.max.toArray()];
  return values.every(Number.isFinite) ? box : null;
}

/**
 * Retorna limites úteis para enquadrar uma vista BIM.
 *
 * A cena não pode ser usada inteira como fallback porque os planos visuais de
 * nível são deliberadamente enormes (lado mínimo de 1000 m). Incluí-los faria
 * grids e elementos residenciais parecerem minúsculos ou invisíveis.
 */
export function getBimContentBounds({ scene, pivot, gridHalfSize = 5 }) {
  const root = scene?.getObjectByName?.("ifc-root");
  if (root?.children?.length) {
    const modelBox = finiteBoxFromObject(root);
    if (modelBox) return modelBox;
  }

  const datumGrids = scene?.getObjectByName?.("datum-grids");
  if (datumGrids?.children?.length) {
    const gridBox = finiteBoxFromObject(datumGrids);
    if (gridBox) {
      if (Math.abs(gridBox.max.z - gridBox.min.z) < 1e-6) {
        const z = Number.isFinite(pivot?.position?.z)
          ? pivot.position.z
          : gridBox.min.z;
        gridBox.min.z = z - 0.5;
        gridBox.max.z = z + 0.5;
      }
      return gridBox;
    }
  }

  const half = Math.max(1, Number(gridHalfSize) || 5);
  const cx = Number.isFinite(pivot?.position?.x) ? pivot.position.x : 0;
  const cy = Number.isFinite(pivot?.position?.y) ? pivot.position.y : 0;
  const cz = Number.isFinite(pivot?.position?.z) ? pivot.position.z : 0;

  return new THREE.Box3(
    new THREE.Vector3(cx - half, cy - half, cz - 0.5),
    new THREE.Vector3(cx + half, cy + half, cz + 0.5),
  );
}

export default getBimContentBounds;
