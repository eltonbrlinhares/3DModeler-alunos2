/**
 * src/ifc/geometry/wallChainSegments.js
 *
 * Função PURA: converte a polilinha de eixos de uma cadeia de paredes em
 * segmentos retos com os pontos ajustados nos cantos ("miter join"), para que
 * caixas retangulares consecutivas (preview 2D/3D e IfcWall no backend) se
 * encontrem sem furos nos cantos.
 *
 * Fórmula do ajuste: no vértice compartilhado por dois segmentos, cada eixo é
 * estendido por `(thickness/2) / tan(anguloInterno/2)` na direção do próprio
 * segmento. Para 90° isso vale exatamente thickness/2 (o caso clássico do
 * canto reto); para uma continuação reta (180°) o ajuste tende a zero.
 */
import * as THREE from "three";

const MAX_EXT_FACTOR = 8; // limite de segurança para cantos muito agudos (quase 180° de retorno)

function direction2D(a, b) {
  return new THREE.Vector2(b.x - a.x, b.y - a.y).normalize();
}

function jointExtension(dPrev, dNext, thickness) {
  const back = new THREE.Vector2(-dPrev.x, -dPrev.y);
  const cos = THREE.MathUtils.clamp(back.dot(dNext), -1, 1);
  const interior = Math.acos(cos); // 0..PI
  const half = interior / 2;
  const t = Math.tan(half);
  if (t < 1e-4) return thickness * MAX_EXT_FACTOR;
  return Math.min((thickness / 2) / t, thickness * MAX_EXT_FACTOR);
}

/**
 * @param {THREE.Vector3[]} points vértices do eixo da cadeia (>= 2)
 * @param {number} thickness espessura (m)
 * @param {boolean} closed se true, fecha o último ponto no primeiro
 * @returns {{p0:THREE.Vector3, p1:THREE.Vector3}[]} um segmento por trecho, com
 *          os pontos ajustados nos cantos internos (extremidades livres da
 *          cadeia aberta permanecem exatamente nos vértices originais)
 */
export function miteredWallSegments(points, thickness, closed = false) {
  const n = points?.length ?? 0;
  if (n < 2) return [];

  const segs = [];
  for (let i = 0; i < n - 1; i += 1) {
    segs.push({ p0: points[i].clone(), p1: points[i + 1].clone() });
  }
  if (closed && n > 2) {
    segs.push({ p0: points[n - 1].clone(), p1: points[0].clone() });
  }

  const applyJoin = (prevSeg, nextSeg, vertex) => {
    const dPrev = direction2D(prevSeg.p0, prevSeg.p1);
    const dNext = direction2D(nextSeg.p0, nextSeg.p1);
    const ext = jointExtension(dPrev, dNext, thickness);
    if (ext <= 1e-6) return;
    prevSeg.p1 = vertex.clone().add(new THREE.Vector3(dPrev.x, dPrev.y, 0).multiplyScalar(ext));
    nextSeg.p0 = vertex.clone().add(new THREE.Vector3(dNext.x, dNext.y, 0).multiplyScalar(-ext));
  };

  for (let i = 1; i < segs.length; i += 1) applyJoin(segs[i - 1], segs[i], points[i]);
  if (closed && segs.length > 2) applyJoin(segs[segs.length - 1], segs[0], points[0]);

  return segs;
}
