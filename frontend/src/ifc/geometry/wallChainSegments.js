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

/**
 * Comprimento, posição (origem do perfil) e rotação_z de uma parede retangular
 * a partir do eixo p0->p1 e da espessura — o mesmo cálculo usado tanto para
 * criar (`createWall`) quanto para editar (`editDimensions`+`editPlacement`)
 * um segmento no backend, centralizado aqui para não duplicar a fórmula.
 */
export function wallSegmentPlacement(p0, p1, thickness) {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const length = Math.hypot(dx, dy);
  const rotation_z = Math.atan2(dy, dx);
  const perp = new THREE.Vector3(-Math.sin(rotation_z), Math.cos(rotation_z), 0);
  const origin = p0.clone().addScaledVector(perp, -thickness / 2);
  return { length, rotation_z, position: [origin.x, origin.y, origin.z] };
}

/**
 * Redimensiona um lado de uma cadeia FECHADA de 4 pontos, reconstruindo-a como
 * um retângulo exato: o lado editado (`i`) e o seu OPOSTO (`i+2`) ficam com a
 * mesma medida nova; os outros dois lados (`i+1`, `i+3`) mantêm o comprimento
 * atual do lado adjacente (`i+1`) — o "EQ" de cotas opostas do Revit.
 *
 * Reconstrói (não apenas translada) porque uma cadeia desenhada a mão livre
 * raramente é um paralelogramo perfeito — se só transladássemos os vértices
 * vizinhos, o lado oposto ficaria com um comprimento diferente do novo valor
 * sempre que os ângulos não fossem exatamente retos.
 *
 * @param {THREE.Vector3[]} points exatamente 4 vértices (cadeia fechada)
 * @param {number} i índice do lado editado (entre points[i] e points[i+1])
 * @param {number} newLength nova medida (m) do lado `i` (e do seu oposto)
 * @returns {THREE.Vector3[]} novos 4 vértices, formando um retângulo exato
 */
export function resizeRectangleSide(points, i, newLength) {
  const n = points.length;
  const ip1 = (i + 1) % n;
  const ip2 = (i + 2) % n;
  const ip3 = (i + 3) % n;
  const anchor = points[i];

  const dirA = new THREE.Vector3().subVectors(points[ip1], anchor).normalize();
  const dirB = new THREE.Vector3(-dirA.y, dirA.x, 0);
  const towardIp2 = new THREE.Vector3().subVectors(points[ip2], points[ip1]);
  if (dirB.dot(towardIp2) < 0) dirB.negate();
  const depth = points[ip1].distanceTo(points[ip2]) || 1e-6;

  const newAnchor = anchor.clone();
  const newIp1 = anchor.clone().addScaledVector(dirA, newLength);
  const newIp2 = newIp1.clone().addScaledVector(dirB, depth);
  const newIp3 = anchor.clone().addScaledVector(dirB, depth);

  const result = points.map((p) => p.clone());
  result[i] = newAnchor;
  result[ip1] = newIp1;
  result[ip2] = newIp2;
  result[ip3] = newIp3;
  return result;
}
