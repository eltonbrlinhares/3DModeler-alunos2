/**
 * src/ifc/planSketch/ColumnSketchController.js
 *
 * Ferramenta "Pilar" em planta 2D: cada clique numa interseção de grid do
 * nível ativo cria um MARCADOR retangular achatado (não é preview — sobrevive
 * à troca de ferramenta), com a seção (largura×profundidade, e o perfil
 * metálico se houver) capturada do formulário no instante do clique. Clicar
 * de novo sobre um marcador ainda não convertido o remove.
 *
 * Não fala com o backend: só acumula a "planta" (markers). A conversão em
 * IfcColumn real (extrusão vertical com a altura definida na TopToolbar) é
 * feita por quem instancia este controller (ver IfcPanel.jsx), que lê
 * `getChains()` e chama a API — este arquivo só cuida do desenho.
 *
 * Um "marker" é { id, point:THREE.Vector3, levelGuid, elevation, form:{...},
 * columnGuid:string|null }. Enquanto `columnGuid` é null o marcador é só
 * planta; depois de "3D" ele vira referência para o IfcColumn.
 */
import * as THREE from "three";
import { columnBox } from "../geometry/columnBox.js";
import { lockedLevelCopy } from "../insertion/snapping.js";
import { snapGridPoint } from "./planSketchSnap.js";

const MARKER_TOLERANCE = 0.15; // m — clique perto de um marcador existente = remove
const PLAN_MARKER_HEIGHT = 0.03; // altura "quase plana" do marcador em planta

let markerSeq = 0;
const nextMarkerId = () => `com${++markerSeq}`;

function markerNear(markers, point, tolerance = MARKER_TOLERANCE) {
  return markers.find((m) => m.point.distanceTo(point) <= tolerance) ?? null;
}

/** Snapshot só dos campos de seção que interessam ao pilar (evita carregar o
 * formulário inteiro, que também tem campos de outras ferramentas). */
function snapshotForm(form = {}) {
  return {
    width: Number(form.width) || 0.4,
    depth: Number(form.depth) || 0.4,
    refX: form.refX || "center",
    refY: form.refY || "center",
    profile: form.profile ?? null,
    shape: form.shape ?? null,
    h: form.h ?? null,
    b: form.b ?? null,
    tw: form.tw ?? null,
    tf: form.tf ?? null,
  };
}

export class ColumnSketchController {
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
    this.sketchGroup.name = "column-sketch-root";
    this._markerMeshes = new Map(); // markerId -> THREE.Group

    this.onStatus = null; // (msg:string) => void
    this.onChainsChanged = null; // () => void — notifica mudanças em getChains()
    this.onHistoryPush = null; // (before, after) => void — desfazer/refazer da planta
  }

  // ── ciclo de vida ──────────────────────────────────────────────────────────
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

  // ── ativação da ferramenta ────────────────────────────────────────────────
  setActive(active, level) {
    if (active === this.active) return;
    if (active) {
      this.level = lockedLevelCopy(level);
      const orbit = this.getOrbit();
      if (orbit) orbit.enabled = false;
      const dom = this.getDom();
      if (dom) dom.style.cursor = "crosshair";
      this._status(`Pilar: clique uma interseção de grid no nível ${this.level.name ?? ""}.`);
    } else {
      const orbit = this.getOrbit();
      if (orbit) orbit.enabled = true;
      const dom = this.getDom();
      if (dom) dom.style.cursor = "";
    }
    this.active = active;
  }

  // ── eventos de ponteiro ───────────────────────────────────────────────────
  _onPointerDown(ev) {
    if (!this.active || !this.level) return;
    const snap = snapGridPoint(ev, this.level, {
      camera: this.getCamera(),
      dom: this.getDom(),
      grids: this.getGrids?.(),
      datumManager: this.getDatumManager?.(),
    });
    if (!snap) {
      this._status("Pilar: aproxime o mouse de uma interseção grid/nível.");
      return;
    }
    ev.preventDefault?.();
    ev.stopPropagation?.();
    const point = snap.point.clone();
    const existing = markerNear(this.markers, point);
    if (existing?.columnGuid) return; // já convertido — não mexe por aqui

    const before = this.snapshotChains();
    if (existing) {
      this._removeMarker(existing.id);
      this._status("Pilar: marcador removido.");
    } else {
      const marker = {
        id: nextMarkerId(),
        point,
        levelGuid: this.level.guid,
        elevation: this.level.elevation ?? 0,
        form: snapshotForm(this.getForm?.() ?? {}),
        columnGuid: null,
      };
      this.markers.push(marker);
      this._renderMarkerFlat(marker);
      this._status(
        "Pilar: marcador adicionado. Continue clicando outras interseções, ou clique num marcador para removê-lo."
      );
    }
    this.onChainsChanged?.();
    this.onHistoryPush?.(before, this.snapshotChains());
  }

  // ── marcador plano persistente ────────────────────────────────────────────
  _renderMarkerFlat(marker) {
    this._disposeMarkerMesh(marker.id);
    const { width, depth, refX, refY } = marker.form;
    const geo = columnBox(marker.point, width, depth, PLAN_MARKER_HEIGHT, refX, refY);
    if (!geo) return;
    const group = new THREE.Group();
    group.name = `column-sketch-marker-${marker.id}`;
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    );
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xede9fe })
    );
    mesh.userData.columnSketch = { markerId: marker.id };
    edges.userData.columnSketch = { markerId: marker.id };
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

  // ── API usada pelo IfcPanel ────────────────────────────────────────────────
  getChains() {
    return this.markers;
  }

  /** Cópia serializável (sem THREE.Vector3) — usada pelo desfazer/refazer global. */
  snapshotChains() {
    return this.markers.map((m) => ({
      id: m.id,
      point: [m.point.x, m.point.y, m.point.z],
      levelGuid: m.levelGuid,
      elevation: m.elevation,
      form: { ...m.form },
      columnGuid: m.columnGuid,
    }));
  }

  /** Restaura os marcadores a partir de um snapshot (desfazer/refazer). */
  restoreChains(snapshot) {
    for (const id of [...this._markerMeshes.keys()]) this._disposeMarkerMesh(id);
    this.markers = (snapshot ?? []).map((m) => ({
      id: m.id,
      point: new THREE.Vector3(...m.point),
      levelGuid: m.levelGuid,
      elevation: m.elevation,
      form: { ...m.form },
      columnGuid: m.columnGuid,
    }));
    for (const marker of this.markers) {
      if (!marker.columnGuid) this._renderMarkerFlat(marker);
    }
    this.onChainsChanged?.();
  }

  getMarker(id) {
    return this.markers.find((m) => m.id === id) ?? null;
  }

  /** Marca o marcador como convertido: remove a malha plana. */
  markConverted(id, guid) {
    const marker = this.getMarker(id);
    if (!marker) return;
    marker.columnGuid = guid;
    this._disposeMarkerMesh(id);
    this.onChainsChanged?.();
  }

  /** Volta um marcador já convertido para planta 2D (o IfcColumn já deve ter
   * sido apagado no backend por quem chama isso). */
  revertToPlan(id) {
    const marker = this.getMarker(id);
    if (!marker || !marker.columnGuid) return;
    marker.columnGuid = null;
    this._renderMarkerFlat(marker);
    this.onChainsChanged?.();
  }

  _status(msg) {
    this.onStatus?.(msg);
  }
}

export default ColumnSketchController;
