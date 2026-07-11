/**
 * src/ifc/geometry/footingBox.js
 *
 * Malha de preview (Three.js) de uma fundação rasa: TRONCO DE PIRÂMIDE
 * retangular (base -> topo, com altura) + PEDESTAL opcional (prisma reto)
 * em cima. Espelha exatamente `_footing_mesh` do backend
 * (`geometry_service.py`) — mesmos vértices/faces, só que já triangulado
 * para `BufferGeometry`.
 *
 * Se `topWidth === baseWidth` e `topLength === baseLength`, o tronco
 * degenera numa caixa reta (usado pelo bloco). Se `pedestalHeight` for 0/nulo,
 * não há pedestal.
 *
 * @param {THREE.Vector3} base ponto clicado (centro em planta, face inferior em Z)
 */
import * as THREE from "three";

function rect(w, l, z) {
  const hw = w / 2;
  const hl = l / 2;
  return [
    [-hw, -hl, z],
    [hw, -hl, z],
    [hw, hl, z],
    [-hw, hl, z],
  ];
}

export function footingMesh(
  base,
  baseWidth,
  baseLength,
  topWidth,
  topLength,
  height,
  pedestalWidth = null,
  pedestalLength = null,
  pedestalHeight = 0,
  baseHeight = 0
) {
  const hasBaseLip = Boolean(baseHeight && baseHeight > 0);
  const hasPedestal = Boolean(pedestalHeight && pedestalHeight > 0);
  const pw = hasPedestal && pedestalWidth ? pedestalWidth : topWidth;
  const pl = hasPedestal && pedestalLength ? pedestalLength : topLength;

  const zFrustumBottom = hasBaseLip ? baseHeight : 0;
  const zFrustumTop = zFrustumBottom + height;

  const bottom = rect(baseWidth, baseLength, 0);
  let verts = [...bottom];
  const quads = [[0, 3, 2, 1]]; // base (normal p/ baixo)

  let frustumBottomIdx = 0;
  if (hasBaseLip) {
    const lipTop = rect(baseWidth, baseLength, zFrustumBottom);
    frustumBottomIdx = verts.length;
    verts = [...verts, ...lipTop];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quads.push([i, j, frustumBottomIdx + j, frustumBottomIdx + i]); // rodapé reto
    }
  }

  const top = rect(topWidth, topLength, zFrustumTop);
  const topIdx = verts.length;
  verts = [...verts, ...top];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quads.push([
      frustumBottomIdx + i,
      frustumBottomIdx + j,
      topIdx + j,
      topIdx + i,
    ]); // laterais do tronco (afunilando)
  }

  if (hasPedestal) {
    const pb = rect(pw, pl, zFrustumTop);
    const pt = rect(pw, pl, zFrustumTop + pedestalHeight);
    const iPb = verts.length;
    const iPt = iPb + 4;
    verts = [...verts, ...pb, ...pt];

    const sameFootprint =
      Math.abs(pw - topWidth) < 1e-6 && Math.abs(pl - topLength) < 1e-6;
    if (!sameFootprint) {
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        quads.push([topIdx + i, topIdx + j, iPb + j, iPb + i]); // aba/moldura
      }
    }
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quads.push([iPb + i, iPb + j, iPt + j, iPt + i]); // laterais do pedestal
    }
    quads.push([iPt, iPt + 1, iPt + 2, iPt + 3]); // topo do pedestal
  } else {
    quads.push([topIdx, topIdx + 1, topIdx + 2, topIdx + 3]); // topo do tronco
  }

  const positions = [];
  verts.forEach(([x, y, z]) => {
    positions.push(base.x + x, base.y + y, base.z + z);
  });
  const indices = [];
  quads.forEach(([a, b, c, d]) => {
    indices.push(a, b, c, a, c, d);
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
