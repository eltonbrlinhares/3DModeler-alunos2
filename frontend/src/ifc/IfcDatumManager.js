/**
 * src/ifc/IfcDatumManager.js
 *
 * Camada de *datums* (auxiliares de modelagem) sobre a cena Three.js, separada
 * da malha IFC (`ifc-root`). Desenha:
 *   - **Níveis** (IfcBuildingStorey): planos horizontais semitransparentes na
 *     cota Z, dimensionados para parecer "tendendo ao infinito" (cobrem a cena
 *     com folga), com grade fina e rótulo flutuante.
 *   - **Grids** (IfcGrid): eixos de referência (linhas) com bolhas rotuladas,
 *     atravessando a faixa de níveis na vertical.
 *   - **Pontos de interseção**: marcadores em cada cruzamento U×V×nível, com
 *     planos auxiliares translúcidos exibidos quando o cursor fica próximo.
 *
 * O viewport é Z-up (igual ao IFC) — sem conversão de eixos. Datums não recebem
 * raycast de seleção (não atrapalham o pick da malha IFC).
 *
 * API:
 *   setBBox(bbox)              dimensiona os planos a partir da bbox do modelo
 *   setLevels(levels)          [{guid, name, elevation}] -> planos + rótulos
 *   setGrids(grids)            [{guid, name, u_axes, v_axes}] -> eixos + bolhas
 *   getIntersectionPoints()    pontos U×V×nível usados por hover e snap
 *   setLevelsVisible(bool) / setGridsVisible(bool)
 *   dispose()
 */

import * as THREE from "three";

const PLANE_COLOR = 0x38bdf8; // ciano suave
const PLANE_OPACITY = 0.06;
const GRID_LINE_COLOR = 0x0ea5e9;
const BUBBLE_BG = "#0ea5e9";
const MIN_PLANE = 1000; // lado mínimo do plano (m) — sensação de infinito
const MIN_GRID_SPAN = 1;
const DATUM_MARGIN = 2;
const INTERSECTION_COLOR = 0xfbbf24;
const HOVER_PLANE_COLOR = 0xf59e0b;
const HOVER_LINE_COLOR = 0xffffff;
const HOVER_HORIZONTAL_OPACITY = 0.48;
const HOVER_VERTICAL_OPACITY = 0.4;
const HOVER_LINE_OPACITY = 0.95;
const HOVER_PIXEL_RADIUS = 22;
const NEVER_RAYCAST = () => {}; // neutraliza o pick em objetos de datum

export class IfcDatumManager {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera | null} camera
   * @param {HTMLElement | null} domElement
   */
  constructor(scene, camera = null, domElement = null) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.group = new THREE.Group();
    this.group.name = "ifc-datums";
    scene.add(this.group);

    this.levelsGroup = new THREE.Group();
    this.levelsGroup.name = "datum-levels";
    this.gridsGroup = new THREE.Group();
    this.gridsGroup.name = "datum-grids";
    this.intersectionsGroup = new THREE.Group();
    this.intersectionsGroup.name = "datum-intersections";
    this.hoverGroup = new THREE.Group();
    this.hoverGroup.name = "datum-hover-planes";
    this.group.add(this.levelsGroup, this.gridsGroup, this.intersectionsGroup, this.hoverGroup);

    this._bbox = null; // {min:[x,y,z], max:[x,y,z]}
    this._levels = [];
    this._grids = [];
    this._intersectionPoints = [];
    this._hoverPoint = null;
    this._pointer = new THREE.Vector2();
    this._projected = new THREE.Vector3();

    this._onPointerMove = (ev) => this._handlePointerMove(ev);
    this._onPointerLeave = () => this._setHoverPoint(null);
    if (this.domElement && this.camera) {
      this.domElement.addEventListener("pointermove", this._onPointerMove);
      this.domElement.addEventListener("pointerleave", this._onPointerLeave);
    }
  }


  setCamera(camera) {
    this.camera = camera;
  }

  // ── geometria dos datums a partir da bbox + grids ─────────────────────────
  _datumBounds() {
    const xs = [];
    const ys = [];
    const bb = this._bbox;

    if (bb) {
      xs.push(bb.min[0], bb.max[0]);
      ys.push(bb.min[1], bb.max[1]);
    }

    const addAxis = (axis) => {
      if (!axis?.p0 || !axis?.p1) return;
      xs.push(axis.p0[0], axis.p1[0]);
      ys.push(axis.p0[1], axis.p1[1]);
    };

    for (const grid of this._grids) {
      (grid.u_axes ?? []).forEach(addAxis);
      (grid.v_axes ?? []).forEach(addAxis);
    }

    if (!xs.length || !ys.length) {
      const half = MIN_PLANE / 2;
      return {
        minX: -half,
        maxX: half,
        minY: -half,
        maxY: half,
        cx: 0,
        cy: 0,
        span: MIN_PLANE,
        side: MIN_PLANE,
      };
    }

    let minX = Math.min(...xs);
    let maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);
    const rawSpan = Math.max(maxX - minX, maxY - minY, MIN_GRID_SPAN);
    const margin = Math.max(DATUM_MARGIN, rawSpan * 0.2);
    minX -= margin;
    maxX += margin;
    minY -= margin;
    maxY += margin;

    const span = Math.max(maxX - minX, maxY - minY, MIN_GRID_SPAN);
    return {
      minX,
      maxX,
      minY,
      maxY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      span,
      side: Math.max(MIN_PLANE, span * 1.2),
    };
  }

  _planeMetrics() {
    const bounds = this._datumBounds();
    return { ...bounds };
  }

  _axisPositions(kind) {
    const values = [];
    for (const grid of this._grids) {
      const axes = kind === "u" ? grid.u_axes ?? [] : grid.v_axes ?? [];
      for (const axis of axes) {
        if (!axis?.p0 || !axis?.p1) continue;
        const idx = kind === "u" ? 0 : 1;
        values.push((axis.p0[idx] + axis.p1[idx]) / 2);
      }
    }
    values.sort((a, b) => a - b);
    return values.filter((v, i) => i === 0 || Math.abs(v - values[i - 1]) > 1e-6);
  }

  _levelElevations() {
    return [...this._levels]
      .map((l) => l.elevation ?? 0)
      .sort((a, b) => a - b)
      .filter((v, i, arr) => i === 0 || Math.abs(v - arr[i - 1]) > 1e-6);
  }

  _hoverZRange(pointZ) {
    const zs = this._levelElevations();
    let zMin = zs.length ? Math.min(...zs) : pointZ;
    let zMax = zs.length ? Math.max(...zs) : pointZ;
    if (this._bbox) {
      zMin = Math.min(zMin, this._bbox.min[2]);
      zMax = Math.max(zMax, this._bbox.max[2]);
    }
    const metrics = this._planeMetrics();
    const minHeight = Math.max(3, metrics.span * 0.25);
    if (zMax - zMin < minHeight) {
      zMin = pointZ - minHeight / 2;
      zMax = pointZ + minHeight / 2;
    } else {
      const margin = Math.max(0.5, (zMax - zMin) * 0.12);
      zMin -= margin;
      zMax += margin;
    }
    return { zMin, zMax };
  }

  // ── helpers de disposição ─────────────────────────────────────────────────
  _disposeChildren(group) {
    for (const obj of [...group.children]) {
      group.remove(obj);
      obj.geometry?.dispose?.();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          m.map?.dispose?.();
          m.dispose?.();
        }
      }
    }
  }

  _updateInteractionVisibility() {
    const visible = this.levelsGroup.visible && this.gridsGroup.visible;
    this.intersectionsGroup.visible = visible;
    this.hoverGroup.visible = visible && !!this._hoverPoint;
  }

  /** Sprite com rótulo de texto (canvas) — usado em níveis e bolhas de grid. */
  _label(text, { scale = 1, round = false } = {}) {
    const pad = 12;
    const fontPx = 48;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
    const tw = Math.ceil(ctx.measureText(text).width);
    const size = round ? Math.max(tw, fontPx) + pad * 2 : 0;
    canvas.width = round ? size : tw + pad * 2;
    canvas.height = round ? size : fontPx + pad;

    const c = canvas.getContext("2d");
    if (round) {
      c.fillStyle = BUBBLE_BG;
      c.beginPath();
      c.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2 - 2, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#e0f2fe";
      c.lineWidth = 4;
      c.stroke();
      c.fillStyle = "#ffffff";
    } else {
      c.fillStyle = "rgba(14,165,233,0.85)";
      c.fillRect(0, 0, canvas.width, canvas.height);
      c.fillStyle = "#e0f2fe";
    }
    c.font = `bold ${fontPx}px system-ui, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, canvas.width / 2, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    const aspect = canvas.width / canvas.height;
    sprite.scale.set(scale * aspect, scale, 1);
    sprite.renderOrder = 999;
    sprite.raycast = NEVER_RAYCAST;
    return sprite;
  }

  // ── níveis ────────────────────────────────────────────────────────────────
  _rebuildLevels() {
    this._disposeChildren(this.levelsGroup);
    const { cx, cy, side, minX, maxY } = this._planeMetrics();
    const sorted = [...this._levels].sort((a, b) => a.elevation - b.elevation);

    sorted.forEach((lvl, i) => {
      const z = lvl.elevation ?? 0;

      // plano semitransparente
      const geo = new THREE.PlaneGeometry(side, side);
      const mat = new THREE.MeshBasicMaterial({
        color: PLANE_COLOR,
        transparent: true,
        opacity: PLANE_OPACITY,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const plane = new THREE.Mesh(geo, mat);
      plane.position.set(cx, cy, z); // PlaneGeometry já está no plano XY (Z-up)
      plane.renderOrder = i; // baixo -> cima, ajuda a ordenar transparências
      plane.raycast = NEVER_RAYCAST;
      this.levelsGroup.add(plane);

      // grade fina sobre o plano (GridHelper está no plano XZ -> girar p/ XY)
      const grid = new THREE.GridHelper(side, Math.min(200, Math.round(side / 1)));
      grid.material.transparent = true;
      grid.material.opacity = 0.12;
      grid.material.depthWrite = false;
      grid.rotation.x = Math.PI / 2;
      grid.position.set(cx, cy, z);
      grid.renderOrder = i;
      grid.raycast = NEVER_RAYCAST;
      this.levelsGroup.add(grid);

      // rótulo "nome · +z m" perto do canto da bbox
      const label = this._label(
        `${lvl.name ?? "Level"}  +${z.toFixed(2)} m`,
        { scale: Math.max(0.6, side * 0.002) }
      );
      label.position.set(minX, maxY, z + 0.05);
      this.levelsGroup.add(label);
    });
  }

  // ── grids ─────────────────────────────────────────────────────────────────
  _levelRange() {
    if (this._levels.length) {
      const zs = this._levels.map((l) => l.elevation ?? 0);
      return [Math.min(...zs), Math.max(...zs)];
    }
    if (this._bbox) return [this._bbox.min[2], this._bbox.max[2]];
    return [0, 0];
  }

  _rebuildGrids() {
    this._disposeChildren(this.gridsGroup);
    const [zMin, zMax] = this._levelRange();
    const metrics = this._planeMetrics();
    const bubbleScale = Math.min(2.5, Math.max(0.8, (metrics.span || 100) * 0.08));

    const lineMat = new THREE.LineBasicMaterial({
      color: GRID_LINE_COLOR,
      transparent: true,
      opacity: 0.7,
    });
    const riserMat = new THREE.LineBasicMaterial({
      color: GRID_LINE_COLOR,
      transparent: true,
      opacity: 0.35,
    });

    const positions = [];
    const risers = [];
    const bubbles = [];

    const addUAxis = (axis) => {
      const x = ((axis.p0?.[0] ?? 0) + (axis.p1?.[0] ?? 0)) / 2;
      const y0 = metrics.minY;
      const y1 = metrics.maxY;
      // linha do eixo no piso (zMin)
      positions.push(x, y0, zMin, x, y1, zMin);
      // risers verticais nas duas pontas até zMax
      risers.push(x, y0, zMin, x, y0, zMax, x, y1, zMin, x, y1, zMax);
      // bolha rotulada no topo da extremidade positiva
      if (axis.tag) bubbles.push({ tag: axis.tag, x, y: y1, z: zMax });
    };

    const addVAxis = (axis) => {
      const y = ((axis.p0?.[1] ?? 0) + (axis.p1?.[1] ?? 0)) / 2;
      const x0 = metrics.minX;
      const x1 = metrics.maxX;
      positions.push(x0, y, zMin, x1, y, zMin);
      risers.push(x0, y, zMin, x0, y, zMax, x1, y, zMin, x1, y, zMax);
      if (axis.tag) bubbles.push({ tag: axis.tag, x: x1, y, z: zMax });
    };

    for (const grid of this._grids) {
      (grid.u_axes ?? []).forEach(addUAxis);
      (grid.v_axes ?? []).forEach(addVAxis);
    }

    if (positions.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const lines = new THREE.LineSegments(g, lineMat);
      lines.raycast = NEVER_RAYCAST;
      this.gridsGroup.add(lines);
    }
    if (risers.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(risers, 3));
      const lines = new THREE.LineSegments(g, riserMat);
      lines.raycast = NEVER_RAYCAST;
      this.gridsGroup.add(lines);
    } else {
      riserMat.dispose();
    }
    for (const b of bubbles) {
      const sprite = this._label(b.tag, { scale: bubbleScale, round: true });
      sprite.position.set(b.x, b.y, b.z + bubbleScale);
      this.gridsGroup.add(sprite);
    }
    if (!positions.length) lineMat.dispose();
  }

  // ── pontos de interseção e hover ──────────────────────────────────────────
  _rebuildIntersectionPoints() {
    this._disposeChildren(this.intersectionsGroup);
    this._intersectionPoints = [];
    this._setHoverPoint(null);

    const xs = this._axisPositions("u");
    const ys = this._axisPositions("v");
    const zs = this._levelElevations();
    if (!xs.length || !ys.length || !zs.length) {
      this._updateInteractionVisibility();
      return;
    }

    const metrics = this._planeMetrics();
    const radius = Math.min(0.14, Math.max(0.04, metrics.span * 0.006));
    const geo = new THREE.SphereGeometry(radius, 16, 10);
    const mat = new THREE.MeshBasicMaterial({
      color: INTERSECTION_COLOR,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    const count = xs.length * ys.length * zs.length;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.name = "datum-intersection-points";
    mesh.renderOrder = 980;
    mesh.raycast = NEVER_RAYCAST;

    const matrix = new THREE.Matrix4();
    let i = 0;
    for (const z of zs) {
      for (const x of xs) {
        for (const y of ys) {
          matrix.makeTranslation(x, y, z);
          mesh.setMatrixAt(i, matrix);
          this._intersectionPoints.push(new THREE.Vector3(x, y, z));
          i += 1;
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.intersectionsGroup.add(mesh);
    this._updateInteractionVisibility();
  }

  _planeFromCorners(corners, opacity) {
    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array(corners.flatMap((p) => [p.x, p.y, p.z]));
    geo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({
      color: HOVER_PLANE_COLOR,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 900;
    mesh.raycast = NEVER_RAYCAST;
    return mesh;
  }

  _hoverIntersectionLines(point, metrics, zRange) {
    const pts = [
      metrics.minX, point.y, point.z,
      metrics.maxX, point.y, point.z,
      point.x, metrics.minY, point.z,
      point.x, metrics.maxY, point.z,
      point.x, point.y, zRange.zMin,
      point.x, point.y, zRange.zMax,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: HOVER_LINE_COLOR,
      transparent: true,
      opacity: HOVER_LINE_OPACITY,
      depthTest: false,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.name = "datum-hover-intersection-lines";
    lines.renderOrder = 995;
    lines.raycast = NEVER_RAYCAST;
    return lines;
  }

  _setHoverPoint(point) {
    const same =
      point &&
      this._hoverPoint &&
      point.distanceToSquared(this._hoverPoint) < 1e-12;
    if (same) return;

    this._hoverPoint = point ? point.clone() : null;
    this._disposeChildren(this.hoverGroup);

    if (!this._hoverPoint) {
      this._updateInteractionVisibility();
      return;
    }

    const metrics = this._planeMetrics();
    const { minX, maxX, minY, maxY } = metrics;
    const zRange = this._hoverZRange(this._hoverPoint.z);
    const { zMin, zMax } = zRange;
    const p = this._hoverPoint;

    const horizontal = this._planeFromCorners(
      [
        new THREE.Vector3(minX, minY, p.z),
        new THREE.Vector3(maxX, minY, p.z),
        new THREE.Vector3(maxX, maxY, p.z),
        new THREE.Vector3(minX, maxY, p.z),
      ],
      HOVER_HORIZONTAL_OPACITY
    );
    const planeX = this._planeFromCorners(
      [
        new THREE.Vector3(p.x, minY, zMin),
        new THREE.Vector3(p.x, maxY, zMin),
        new THREE.Vector3(p.x, maxY, zMax),
        new THREE.Vector3(p.x, minY, zMax),
      ],
      HOVER_VERTICAL_OPACITY
    );
    const planeY = this._planeFromCorners(
      [
        new THREE.Vector3(minX, p.y, zMin),
        new THREE.Vector3(maxX, p.y, zMin),
        new THREE.Vector3(maxX, p.y, zMax),
        new THREE.Vector3(minX, p.y, zMax),
      ],
      HOVER_VERTICAL_OPACITY
    );

    const radius = Math.min(0.28, Math.max(0.1, this._planeMetrics().span * 0.012));
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 20, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      })
    );
    marker.position.copy(p);
    marker.renderOrder = 1000;
    marker.raycast = NEVER_RAYCAST;

    const intersectionLines = this._hoverIntersectionLines(p, metrics, zRange);
    this.hoverGroup.add(horizontal, planeX, planeY, intersectionLines, marker);
    this._updateInteractionVisibility();
  }

  _handlePointerMove(ev) {
    if (
      !this.camera ||
      !this.domElement ||
      !this.levelsGroup.visible ||
      !this.gridsGroup.visible ||
      !this._intersectionPoints.length
    ) {
      this._setHoverPoint(null);
      return;
    }

    const rect = this.domElement.getBoundingClientRect();
    if (
      ev.clientX < rect.left ||
      ev.clientX > rect.right ||
      ev.clientY < rect.top ||
      ev.clientY > rect.bottom
    ) {
      this._setHoverPoint(null);
      return;
    }

    let nearest = null;
    let bestDistSq = HOVER_PIXEL_RADIUS * HOVER_PIXEL_RADIUS;
    for (const point of this._intersectionPoints) {
      this._projected.copy(point).project(this.camera);
      if (this._projected.z < -1 || this._projected.z > 1) continue;
      this._pointer.set(
        rect.left + (this._projected.x * 0.5 + 0.5) * rect.width,
        rect.top + (-this._projected.y * 0.5 + 0.5) * rect.height
      );
      const dx = ev.clientX - this._pointer.x;
      const dy = ev.clientY - this._pointer.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        nearest = point;
      }
    }
    this._setHoverPoint(nearest);
  }

  // ── API pública ───────────────────────────────────────────────────────────
  setBBox(bbox) {
    this._bbox = bbox ?? null;
    this._rebuildLevels();
    this._rebuildGrids();
    this._rebuildIntersectionPoints();
  }

  setLevels(levels) {
    this._levels = levels ?? [];
    this._rebuildLevels();
    this._rebuildGrids(); // a faixa vertical dos grids depende dos níveis
    this._rebuildIntersectionPoints();
  }

  setGrids(grids) {
    this._grids = grids ?? [];
    this._rebuildLevels(); // planos e labels dependem da extensão XY dos grids
    this._rebuildGrids();
    this._rebuildIntersectionPoints();
  }

  getIntersectionPoints({ level = null } = {}) {
    const rawZ =
      level === null || level === undefined
        ? null
        : Number(level?.elevation ?? level);
    const z = Number.isFinite(rawZ) ? rawZ : null;
    return this._intersectionPoints
      .filter((point) => z === null || Math.abs(point.z - z) <= 1e-6)
      .map((point) => point.clone());
  }

  setLevelsVisible(v) {
    this.levelsGroup.visible = v;
    this._updateInteractionVisibility();
  }

  setGridsVisible(v) {
    this.gridsGroup.visible = v;
    this._updateInteractionVisibility();
  }

  dispose() {
    if (this.domElement && this.camera) {
      this.domElement.removeEventListener("pointermove", this._onPointerMove);
      this.domElement.removeEventListener("pointerleave", this._onPointerLeave);
    }
    this._disposeChildren(this.levelsGroup);
    this._disposeChildren(this.gridsGroup);
    this._disposeChildren(this.intersectionsGroup);
    this._disposeChildren(this.hoverGroup);
    this.scene.remove(this.group);
  }
}

export default IfcDatumManager;
