/**
 * src/ifc/planSketch/FootingSketchController.js
 *
 * Ferramenta "Fundação" em planta 2D: cada clique numa interseção de grid do
 * nível ativo cria um MARCADOR retangular achatado (footprint base×base da
 * sapata/bloco), com TODOS os campos da fundação (base, topo, rodapé,
 * pedestal, estacas) capturados do formulário no instante do clique. Clicar
 * de novo sobre um marcador ainda não convertido o remove.
 *
 * Mesmo padrão do ColumnSketchController — ver esse arquivo para os
 * comentários gerais sobre "marker" vs. planta/3D. A diferença: aqui o
 * marcador plano usa sempre o footprint da BASE (baseWidth×baseLength),
 * independente do afunilamento/pedestal — o desenho real (tronco de
 * pirâmide) só aparece depois da conversão em 3D.
 */
import * as THREE from "three";
import { columnBox } from "../geometry/columnBox.js";
import { lockedLevelCopy } from "../insertion/snapping.js";
import { snapGridPoint } from "./planSketchSnap.js";

const MARKER_TOLERANCE = 0.15; // m
const PLAN_MARKER_HEIGHT = 0.03;

let markerSeq = 0;
const nextMarkerId = () => `fom${++markerSeq}`;

function markerNear(markers, point, tolerance = MARKER_TOLERANCE) {
  return markers.find((m) => m.point.distanceTo(point) <= tolerance) ?? null;
}

/** Espelha `readForm` de `tools/footingTool.js` — mesma leitura/defaults. */
function snapshotForm(form = {}) {
  const isPileCap = form.predefinedType === "PILE_CAP";
  const baseWidth = Number(form.baseWidth) || 1.5;
  const baseLength = Number(form.baseLength) || 1.5;
  const topWidth = isPileCap ? baseWidth : Number(form.topWidth) || baseWidth;
  const topLength = isPileCap ? baseLength : Number(form.topLength) || baseLength;
  const height = Number(form.height) || 0.5;
  const baseHeight = Number(form.baseHeight) || 0;
  const usePedestal = Boolean(form.usePedestal);
  const pedestalWidth = usePedestal ? Number(form.pedestalWidth) || topWidth : null;
  const pedestalLength = usePedestal ? Number(form.pedestalLength) || topLength : null;
  const pedestalHeight = usePedestal ? Number(form.pedestalHeight) || 0 : 0;
  return {
    isPileCap,
    baseWidth,
    baseLength,
    topWidth,
    topLength,
    height,
    baseHeight,
    pedestalWidth,
    pedestalLength,
    pedestalHeight,
    pileCount: form.pileCount ?? null,
    pileDiameter: form.pileDiameter ?? null,
  };
}

export class FootingSketchController {
  constructor({ getScene, getCamera, getDom, getOrbit, getGrids, getDatumManager, getForm }) {
    this.getScene = getScene;
    this.getCamera = getCamera;
    this.getDom = getDom;
    this.getOrbit = getOrbit;
    this.getGrids = getGrids;
    this.getDatumManager = getDatumManager;
    this.getForm = getForm;

    this.markers = [];
    this.level = null;
    this.active = false;

    this.sketchGroup = new THREE.Group();
    this.sketchGroup.name = "footing-sketch-root";
    this._markerMeshes = new Map();

    this.onStatus = null;
    this.onChainsChanged = null;
    this.onHistoryPush = null;
  }

  mount() {
    this.getScene()?.add(this.sketchGroup);
  }

  attach() {
    const dom = this.getDom();
    if (!dom) return;
    this._onDown = (ev) => this._onPointerDown(ev);
    dom.addEventListener("pointerdown", this._onDown);
  }

  detach() {
    const dom = this.getDom();
    if (dom) dom.removeEventListener("pointerdown", this._onDown);
  }

  dispose() {
    this.detach();
    for (const group of this._markerMeshes.values()) this._disposeGroup(group);
    this._markerMeshes.clear();
    this.getScene()?.remove(this.sketchGroup);
  }

  setActive(active, level) {
    if (active === this.active) return;
    if (active) {
      this.level = lockedLevelCopy(level);
      const orbit = this.getOrbit();
      if (orbit) orbit.enabled = false;
      const dom = this.getDom();
      if (dom) dom.style.cursor = "crosshair";
      this._status(`Fundação: clique uma interseção de grid no nível ${this.level.name ?? ""}.`);
    } else {
      const orbit = this.getOrbit();
      if (orbit) orbit.enabled = true;
      const dom = this.getDom();
      if (dom) dom.style.cursor = "";
    }
    this.active = active;
  }

  _onPointerDown(ev) {
    if (!this.active || !this.level) return;
    const snap = snapGridPoint(ev, this.level, {
      camera: this.getCamera(),
      dom: this.getDom(),
      grids: this.getGrids?.(),
      datumManager: this.getDatumManager?.(),
    });
    if (!snap) {
      this._status("Fundação: aproxime o mouse de uma interseção grid/nível.");
      return;
    }
    ev.preventDefault?.();
    ev.stopPropagation?.();
    const point = snap.point.clone();
    const existing = markerNear(this.markers, point);
    if (existing?.footingGuid) return;

    const before = this.snapshotChains();
    if (existing) {
      this._removeMarker(existing.id);
      this._status("Fundação: marcador removido.");
    } else {
      const marker = {
        id: nextMarkerId(),
        point,
        levelGuid: this.level.guid,
        elevation: this.level.elevation ?? 0,
        form: snapshotForm(this.getForm?.() ?? {}),
        footingGuid: null,
      };
      this.markers.push(marker);
      this._renderMarkerFlat(marker);
      this._status(
        "Fundação: marcador adicionado. Continue clicando outras interseções, ou clique num marcador para removê-lo."
      );
    }
    this.onChainsChanged?.();
    this.onHistoryPush?.(before, this.snapshotChains());
  }

  _renderMarkerFlat(marker) {
    this._disposeMarkerMesh(marker.id);
    const { baseWidth, baseLength, isPileCap } = marker.form;
    const geo = columnBox(marker.point, baseWidth, baseLength, PLAN_MARKER_HEIGHT, "center", "center");
    if (!geo) return;
    const group = new THREE.Group();
    group.name = `footing-sketch-marker-${marker.id}`;
    const fill = isPileCap ? 0xf97316 : 0x22c55e;
    const edge = isPileCap ? 0xffedd5 : 0xbbf7d0;
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: fill, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: edge }));
    mesh.userData.footingSketch = { markerId: marker.id };
    edges.userData.footingSketch = { markerId: marker.id };
    group.add(mesh, edges);
    this.sketchGroup.add(group);
    this._markerMeshes.set(marker.id, group);
  }

  _disposeGroup(group) {
    group.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose?.());
    });
    this.sketchGroup.remove(group);
  }

  _disposeMarkerMesh(id) {
    const group = this._markerMeshes.get(id);
    if (group) {
      this._disposeGroup(group);
      this._markerMeshes.delete(id);
    }
  }

  _removeMarker(id) {
    this._disposeMarkerMesh(id);
    this.markers = this.markers.filter((m) => m.id !== id);
  }

  getChains() {
    return this.markers;
  }

  snapshotChains() {
    return this.markers.map((m) => ({
      id: m.id,
      point: [m.point.x, m.point.y, m.point.z],
      levelGuid: m.levelGuid,
      elevation: m.elevation,
      form: { ...m.form },
      footingGuid: m.footingGuid,
    }));
  }

  restoreChains(snapshot) {
    for (const id of [...this._markerMeshes.keys()]) this._disposeMarkerMesh(id);
    this.markers = (snapshot ?? []).map((m) => ({
      id: m.id,
      point: new THREE.Vector3(...m.point),
      levelGuid: m.levelGuid,
      elevation: m.elevation,
      form: { ...m.form },
      footingGuid: m.footingGuid,
    }));
    for (const marker of this.markers) {
      if (!marker.footingGuid) this._renderMarkerFlat(marker);
    }
    this.onChainsChanged?.();
  }

  getMarker(id) {
    return this.markers.find((m) => m.id === id) ?? null;
  }

  markConverted(id, guid) {
    const marker = this.getMarker(id);
    if (!marker) return;
    marker.footingGuid = guid;
    this._disposeMarkerMesh(id);
    this.onChainsChanged?.();
  }

  revertToPlan(id) {
    const marker = this.getMarker(id);
    if (!marker || !marker.footingGuid) return;
    marker.footingGuid = null;
    this._renderMarkerFlat(marker);
    this.onChainsChanged?.();
  }

  _status(msg) {
    this.onStatus?.(msg);
  }
}

export default FootingSketchController;
