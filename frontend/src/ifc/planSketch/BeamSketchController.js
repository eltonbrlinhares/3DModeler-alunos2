/**
 * src/ifc/planSketch/BeamSketchController.js
 *
 * Ferramenta "Viga" em planta 2D (mesmo espírito do WallSketchController):
 * desenha uma polilinha de eixos, encaixando SEMPRE em interseções de
 * grid/datum do nível ativo (ver planSketchSnap.js — igual à ferramenta de
 * inserção direta em 3D). Cada trecho já fechado (mas ainda não convertido em
 * 3D) vira uma malha fina "linha simples" persistente na cena (não é preview
 * — sobrevive à troca de ferramenta).
 *
 * Diferente da parede, a viga NÃO usa "miter join" nos cantos (cada trecho
 * vira uma IfcBeam independente ao converter) — a seção (width×depth,
 * axisRef, perfil metálico se houver) é capturada do formulário no instante
 * em que a cadeia é fechada.
 *
 * Não fala com o backend: só acumula a "planta" (chains). A conversão em
 * IfcBeam real é feita por quem instancia este controller (ver
 * IfcPanel.jsx), que lê `getChains()` e chama a API — este arquivo só cuida
 * do desenho.
 *
 * Uma "chain" é { id, points:THREE.Vector3[], closed, levelGuid, elevation,
 * form:{...}, beamGuids:string[]|null }. Enquanto `beamGuids` é null a
 * cadeia é só planta; depois de "3D" ela vira referência (um guid por
 * segmento) para os IfcBeam.
 */
import * as THREE from "three";
import { PreviewLayer } from "../insertion/PreviewLayer.js";
import { wallBox } from "../geometry/wallBox.js";
import { lockedLevelCopy } from "../insertion/snapping.js";
import { snapGridPoint } from "./planSketchSnap.js";

const VERTEX_SNAP = 0.15; // m — encaixe em vértice existente / fechamento da cadeia
const PLAN_PREVIEW_HEIGHT = 0.03;

let chainSeq = 0;
const nextChainId = () => `bc${++chainSeq}`;

function nearestVertex(chains, point, tolerance = VERTEX_SNAP) {
  let best = null;
  let bestDist = tolerance;
  for (const chain of chains) {
    for (const p of chain.points) {
      const d = p.distanceTo(point);
      if (d <= bestDist) {
        bestDist = d;
        best = p;
      }
    }
  }
  return best;
}

/** Snapshot só dos campos de seção que interessam à viga. */
function snapshotForm(form = {}) {
  return {
    width: Number(form.width) || 0.2,
    depth: Number(form.depth) || 0.3,
    axisRef: form.axisRef || "top",
    profile: form.profile ?? null,
    shape: form.shape ?? null,
    h: form.h ?? null,
    b: form.b ?? null,
    tw: form.tw ?? null,
    tf: form.tf ?? null,
  };
}

export class BeamSketchController {
  constructor({ getScene, getCamera, getDom, getOrbit, getGrids, getDatumManager, getForm }) {
    this.getScene = getScene;
    this.getCamera = getCamera;
    this.getDom = getDom;
    this.getOrbit = getOrbit;
    this.getGrids = getGrids;
    this.getDatumManager = getDatumManager;
    this.getForm = getForm;

    this.chains = [];
    this.drawingPoints = [];
    this.level = null;
    this.active = false;

    this.sketchGroup = new THREE.Group();
    this.sketchGroup.name = "beam-sketch-root";
    this._chainMeshes = new Map();

    this.preview = null;
    this.onStatus = null;
    this.onChainsChanged = null;
    this.onHistoryPush = null;
  }

  // ── ciclo de vida ──────────────────────────────────────────────────────────
  mount() {
    this.getScene()?.add(this.sketchGroup);
  }

  attach() {
    const dom = this.getDom();
    if (!dom) return;
    this._onDown = (ev) => this._onPointerDown(ev);
    this._onMove = (ev) => this._onPointerMove(ev);
    this._onDbl = (ev) => this._onDoubleClick(ev);
    this._onKey = (ev) => this._onKeyDown(ev);
    dom.addEventListener("pointerdown", this._onDown);
    dom.addEventListener("pointermove", this._onMove);
    dom.addEventListener("dblclick", this._onDbl);
    window.addEventListener("keydown", this._onKey);
  }

  detach() {
    const dom = this.getDom();
    if (dom) {
      dom.removeEventListener("pointerdown", this._onDown);
      dom.removeEventListener("pointermove", this._onMove);
      dom.removeEventListener("dblclick", this._onDbl);
    }
    window.removeEventListener("keydown", this._onKey);
  }

  dispose() {
    this.detach();
    this._clearPreview();
    for (const group of this._chainMeshes.values()) this._disposeGroup(group);
    this._chainMeshes.clear();
    this.getScene()?.remove(this.sketchGroup);
  }

  // ── ativação da ferramenta ────────────────────────────────────────────────
  setActive(active, level) {
    if (active === this.active) return;
    if (active) {
      this.level = lockedLevelCopy(level);
      this.drawingPoints = [];
      this.preview = new PreviewLayer(this.getScene());
      const orbit = this.getOrbit();
      if (orbit) orbit.enabled = false;
      const dom = this.getDom();
      if (dom) dom.style.cursor = "crosshair";
      this._status(`Viga: clique a primeira interseção de grid no nível ${this.level.name ?? ""}.`);
    } else {
      this._finishCurrentChain();
      this._clearPreview();
      const orbit = this.getOrbit();
      if (orbit) orbit.enabled = true;
      const dom = this.getDom();
      if (dom) dom.style.cursor = "";
    }
    this.active = active;
  }

  // ── eventos de ponteiro ───────────────────────────────────────────────────
  _point(ev) {
    if (!this.level) return null;
    const snap = snapGridPoint(ev, this.level, {
      camera: this.getCamera(),
      dom: this.getDom(),
      grids: this.getGrids?.(),
      datumManager: this.getDatumManager?.(),
    });
    if (!snap) return null;
    const vertexSnap = nearestVertex(
      this.drawingPoints.length ? [{ points: this.drawingPoints }, ...this.chains] : this.chains,
      snap.point
    );
    return vertexSnap ?? snap.point;
  }

  _onPointerDown(ev) {
    if (!this.active) return;
    const p = this._point(ev);
    if (!p) {
      this._status("Viga: aproxime o mouse de uma interseção grid/nível.");
      return;
    }
    ev.preventDefault?.();
    ev.stopPropagation?.();

    if (this.drawingPoints.length >= 2 && p.distanceTo(this.drawingPoints[0]) < VERTEX_SNAP) {
      this._finishCurrentChain(true);
      this._status("Viga: cadeia fechada. Clique para iniciar uma nova cadeia.");
      return;
    }
    const last = this.drawingPoints[this.drawingPoints.length - 1];
    if (last && p.distanceTo(last) < VERTEX_SNAP / 2) return;
    this.drawingPoints.push(p.clone());
    this._drawLivePreview();
    this._status(
      this.drawingPoints.length < 2
        ? "Viga: clique a interseção do fim do 1º trecho."
        : "Viga: continue clicando, clique no 1º ponto para fechar, ou 2×clique/Enter para finalizar."
    );
  }

  _onPointerMove(ev) {
    if (!this.active || !this.drawingPoints.length) return;
    const p = this._point(ev);
    if (p) this._drawLivePreview(p);
  }

  _onDoubleClick(ev) {
    if (!this.active || this.drawingPoints.length < 2) return;
    ev.preventDefault?.();
    ev.stopPropagation?.();
    this._finishCurrentChain();
    this._status("Viga: cadeia concluída. Clique para iniciar uma nova cadeia.");
  }

  _onKeyDown(ev) {
    if (!this.active) return;
    if (ev.key === "Enter") this._finishCurrentChain();
  }

  // ── preview do trecho em desenho ─────────────────────────────────────────
  _drawLivePreview(candidate = null) {
    const pts = candidate ? [...this.drawingPoints, candidate] : [...this.drawingPoints];
    if (pts.length < 2 || !this.preview) return;
    const width = Number(this.getForm?.()?.width) || 0.2;
    const pv = this.preview.begin("beam-sketch-live-preview");
    for (let i = 0; i < pts.length - 1; i += 1) {
      const geo = wallBox(pts[i], pts[i + 1], width, PLAN_PREVIEW_HEIGHT);
      if (geo) pv.solid(geo, { fill: 0xf97316, edge: 0xffedd5, opacity: 0.55 });
    }
  }

  _clearPreview() {
    this.preview?.clear();
  }

  // ── finalizar cadeia ──────────────────────────────────────────────────────
  _finishCurrentChain(closed = false) {
    if (this.drawingPoints.length < 2) {
      this.drawingPoints = [];
      this._clearPreview();
      return;
    }
    const before = this.snapshotChains();
    const chain = {
      id: nextChainId(),
      points: this.drawingPoints.map((p) => p.clone()),
      closed,
      levelGuid: this.level?.guid ?? null,
      elevation: this.level?.elevation ?? 0,
      form: snapshotForm(this.getForm?.() ?? {}),
      beamGuids: null,
    };
    this.chains.push(chain);
    this._renderChainFlat(chain);
    this.drawingPoints = [];
    this._clearPreview();
    this.onChainsChanged?.();
    this.onHistoryPush?.(before, this.snapshotChains());
  }

  // ── segmentos de uma cadeia (sem miter — cada trecho é uma viga própria) ──
  _segments(chain) {
    const pts = chain.points;
    const segs = [];
    for (let i = 0; i < pts.length - 1; i += 1) segs.push({ p0: pts[i], p1: pts[i + 1] });
    if (chain.closed && pts.length > 2) segs.push({ p0: pts[pts.length - 1], p1: pts[0] });
    return segs;
  }

  // ── malha plana persistente ───────────────────────────────────────────────
  _renderChainFlat(chain) {
    this._disposeChainMesh(chain.id);
    const group = new THREE.Group();
    group.name = `beam-sketch-chain-${chain.id}`;
    const segs = this._segments(chain);
    segs.forEach((seg, segmentIndex) => {
      const geo = wallBox(seg.p0, seg.p1, chain.form.width, PLAN_PREVIEW_HEIGHT);
      if (!geo) return;
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: 0xfdba74, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
      );
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0xffedd5 })
      );
      mesh.userData.beamSketch = { chainId: chain.id, segmentIndex };
      edges.userData.beamSketch = { chainId: chain.id, segmentIndex };
      group.add(mesh, edges);
    });
    this.sketchGroup.add(group);
    this._chainMeshes.set(chain.id, group);
  }

  _disposeGroup(group) {
    group.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose?.());
    });
    this.sketchGroup.remove(group);
  }

  _disposeChainMesh(chainId) {
    const group = this._chainMeshes.get(chainId);
    if (group) {
      this._disposeGroup(group);
      this._chainMeshes.delete(chainId);
    }
  }

  // ── API usada pelo IfcPanel ────────────────────────────────────────────────
  getChains() {
    return this.chains;
  }

  snapshotChains() {
    return this.chains.map((c) => ({
      id: c.id,
      points: c.points.map((p) => [p.x, p.y, p.z]),
      closed: c.closed,
      levelGuid: c.levelGuid,
      elevation: c.elevation,
      form: { ...c.form },
      beamGuids: c.beamGuids ? [...c.beamGuids] : null,
    }));
  }

  restoreChains(snapshot) {
    for (const chainId of [...this._chainMeshes.keys()]) this._disposeChainMesh(chainId);
    this.chains = (snapshot ?? []).map((c) => ({
      id: c.id,
      points: c.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      closed: c.closed,
      levelGuid: c.levelGuid,
      elevation: c.elevation,
      form: { ...c.form },
      beamGuids: c.beamGuids ? [...c.beamGuids] : null,
    }));
    for (const chain of this.chains) {
      if (!chain.beamGuids) this._renderChainFlat(chain);
    }
    this.onChainsChanged?.();
  }

  getChain(chainId) {
    return this.chains.find((c) => c.id === chainId) ?? null;
  }

  /** Marca a cadeia como convertida: remove a malha plana e passa a
   * referenciar os IfcBeam reais (um guid por segmento). */
  markChainConverted(chainId, beamGuids) {
    const chain = this.getChain(chainId);
    if (!chain) return;
    chain.beamGuids = beamGuids;
    this._disposeChainMesh(chainId);
    this.onChainsChanged?.();
  }

  /** Volta uma cadeia já convertida para planta 2D (os IfcBeam já devem ter
   * sido apagados no backend por quem chama isso). */
  revertChainTo2D(chainId) {
    const chain = this.getChain(chainId);
    if (!chain || !chain.beamGuids) return;
    chain.beamGuids = null;
    this._renderChainFlat(chain);
    this.onChainsChanged?.();
  }

  removeChain(chainId) {
    this._disposeChainMesh(chainId);
    this.chains = this.chains.filter((c) => c.id !== chainId);
    this.onChainsChanged?.();
  }

  _status(msg) {
    this.onStatus?.(msg);
  }
}

export default BeamSketchController;
