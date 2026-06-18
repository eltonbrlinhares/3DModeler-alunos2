/**
 * src/ifc/insertion/constants.js
 *
 * Constantes numéricas compartilhadas pelo sistema de inserção (snapping,
 * controller e ferramentas). Centralizadas aqui para que um aluno ajuste o
 * comportamento (tolerâncias, sensibilidade do mouse) em um único lugar.
 */

/** Altura mínima de parede/pilar, em metros. */
export const WALL_MIN_HEIGHT = 0.1;

/** Metros de altura por pixel de arraste vertical do mouse. */
export const WALL_HEIGHT_PIXEL_SCALE = 0.03;

/** Tolerância (m) para "encaixar" a altura na elevação de um nível superior. */
export const WALL_HEIGHT_SNAP_TOLERANCE = 0.25;

/** Raio (px) em torno de uma interseção de grid para considerar o snap. */
export const DATUM_SNAP_PIXEL_RADIUS = 26;

/** Comprimento mínimo (m) de viga / distância mínima entre vértices de laje. */
export const BEAM_MIN_LENGTH = 0.05;

/** Área mínima (m²) para uma laje ser válida. */
export const SLAB_MIN_AREA = 0.01;
