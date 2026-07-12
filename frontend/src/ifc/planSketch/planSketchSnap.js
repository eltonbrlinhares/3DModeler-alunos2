/**
 * src/ifc/planSketch/planSketchSnap.js
 *
 * Snap compartilhado pelas ferramentas de planta 2D dos elementos
 * estruturais (pilar, viga, fundação, laje): encaixa SEMPRE numa interseção
 * de grid/datum do nível ativo — a mesma regra que as ferramentas de
 * inserção direta em 3D já usam (ver
 * `InsertionController._snapPointsOnLevel` + `snapPointOnGridLevel` em
 * `../insertion/snapping.js`).
 *
 * Isso mantém a planta 2D coerente com o 3D direto: o que se desenha em
 * planta cai exatamente nos mesmos pontos onde o modo antigo já encaixava,
 * então converter para 3D nunca "pula" para um lugar inesperado.
 *
 * (A ferramenta "Parede" é a exceção: ela também aceita ponto livre/vértice
 * de outra parede, por isso o `WallSketchController` não usa este arquivo.)
 */
import { snapPointOnGridLevel, gridLevelIntersections } from "../insertion/snapping.js";

/** Pontos de snap disponíveis no nível: datums, se houver; senão, interseções de grid. */
export function snapPointsOnLevel(level, { grids, datumManager } = {}) {
  const datumPoints = datumManager?.getIntersectionPoints?.({ level });
  return datumPoints?.length ? datumPoints : gridLevelIntersections(grids, level);
}

/** Ponto de grid/datum mais próximo do mouse, dentro do raio de snap (ou null). */
export function snapGridPoint(ev, level, { camera, dom, grids, datumManager } = {}) {
  return snapPointOnGridLevel(ev, level, {
    camera,
    dom,
    grids,
    datumPoints: snapPointsOnLevel(level, { grids, datumManager }),
  });
}
