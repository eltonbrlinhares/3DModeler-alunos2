/**
 * src/ifc/planSketch/WallSketchController.js
 *
 * Ferramenta "Parede" (planta 2D, estilo Revit): desenha uma polilinha de
 * eixos no plano do nível ativo e mantém, para cada trecho já FECHADO (mas
 * ainda não convertido em 3D), uma malha fina "linha dupla" persistente na
 * cena (não é preview — sobrevive à troca de ferramenta).
 *
 * Não fala com o backend: só acumula a "planta" (chains). A conversão em
 * IfcWall reais é feita por quem instancia este controller (ver IfcPanel.jsx),
 * que lê `getChains()` e chama a API — este arquivo só cuida do desenho.
 *
 * Uma "chain" é { id, points:THREE.Vector3[], thickness, closed, levelGuid,
 * elevation, height, wallGuids:string[]|null }. Enquanto `wallGuids` é null a
 * cadeia é só planta; depois de "3D" ela vira referência para os IfcWall.
 */
import * as THREE from "three";
import { PreviewLayer } from "../insertion/PreviewLayer.js";
import { wallBox } from "../geometry/wallBox.js";
import { miteredWallSegments } from "../geometry/wallChainSegments.js";
import { lockedLevelCopy, eventPointOnLevel, snapPointOnGridLevel } from "../insertion/snapping.js";

export const DEFAULT_WALL_THICKNESS = 0.15; // 15 cm
export const DEFAULT_WALL_HEIGHT = 2.8; // m
const VERTEX_SNAP = 0.12; // m — encaixe em vértice existente / fechamento da cadeia
const PLAN_PREVIEW_HEIGHT = 0.03; // altura "quase plana" da linha dupla em planta

let chainSeq = 0;
const nextChainId = () => `wc${++chainSeq}`;

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

export class WallSketchController {
  constructor({ getScene, getCamera, getDom, getOrbit, getGrids, getDatumManager }) {
    this.getScene = getScene;
    this.getCamera = getCamera;
    this.getDom = getDom;
    this.getOrbit = getOrbit;
    this.getGrids = getGrids;
    this.getDatumManager = getDatumManager;

    this.chains = [];
    this.drawingPoints = [];
    this.level = null;
    this.thickness = DEFAULT_WALL_THICKNESS;
    this.active = false;

    this.sketchGroup = new THREE.Group();
    this.sketchGroup.name = "wall-sketch-root";
    this._chainMeshes = new Map(); // chainId -> THREE.Group
    this._guidToSegment = new Map(); // guid -> {chainId, segmentIndex}

    this.preview = null; // criado sob demanda (precisa da cena)
    this.onStatus = null; // (msg:string) => void, opcional
    this.onChainsChanged = null; // () => void, opcional — notifica mudanças em getChains()
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
      this._status(`Parede: clique o primeiro ponto no nível ${this.level.name ?? ""}.`);
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

  setThickness(t) {
    this.thickness = Math.max(0.02, Number(t) || DEFAULT_WALL_THICKNESS);
  }

  // ── eventos de ponteiro ───────────────────────────────────────────────────
  _point(ev) {
    if (!this.level) return null;
    const camera = this.getCamera();
    const dom = this.getDom();
    const snap = snapPointOnGridLevel(ev, this.level, {
      camera,
      dom,
      grids: this.getGrids?.(),
      datumPoints: this.getDatumManager?.()?.getIntersectionPoints?.({ level: this.level }) ?? [],
    });
    const raw = snap?.point ?? eventPointOnLevel(ev, this.level.elevation ?? 0, { camera, dom });
    if (!raw) return null;
    const vertexSnap = nearestVertex(
      this.drawingPoints.length ? [{ points: this.drawingPoints }, ...this.chains] : this.chains,
      raw
    );
    return vertexSnap ?? raw;
  }

  _onPointerDown(ev) {
    if (!this.active) return;
    const p = this._point(ev);
    if (!p) return;
    ev.preventDefault?.();
    ev.stopPropagation?.();

    if (this.drawingPoints.length >= 2 && p.distanceTo(this.drawingPoints[0]) < VERTEX_SNAP) {
      this._finishCurrentChain(true);
      this._status("Parede: cadeia fechada. Clique para iniciar uma nova cadeia.");
      return;
    }
    const last = this.drawingPoints[this.drawingPoints.length - 1];
    if (last && p.distanceTo(last) < VERTEX_SNAP / 2) return; // evita ponto duplicado
    this.drawingPoints.push(p.clone());
    this._drawLivePreview();
    this._status(
      this.drawingPoints.length < 2
        ? "Parede: clique o próximo ponto do eixo."
        : "Parede: continue clicando, clique no 1º ponto para fechar, ou 2×clique/Enter para finalizar."
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
    this._status("Parede: cadeia concluída. Clique para iniciar uma nova cadeia.");
  }

  _onKeyDown(ev) {
    if (!this.active) return;
    if (ev.key === "Enter") this._finishCurrentChain();
    // Escape é tratado por quem integra este controller (desativa a ferramenta).
  }

  // ── preview do trecho em desenho ─────────────────────────────────────────
  _drawLivePreview(candidate = null) {
    const pts = candidate ? [...this.drawingPoints, candidate] : [...this.drawingPoints];
    if (pts.length < 2 || !this.preview) return;
    const segs = miteredWallSegments(pts, this.thickness, false);
    const pv = this.preview.begin("wall-sketch-live-preview");
    for (const seg of segs) {
      const geo = wallBox(seg.p0, seg.p1, this.thickness, PLAN_PREVIEW_HEIGHT);
      if (geo) pv.solid(geo, { fill: 0x38bdf8, edge: 0xe0f2fe, opacity: 0.55 });
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
    const chain = {
      id: nextChainId(),
      points: this.drawingPoints.map((p) => p.clone()),
      thickness: this.thickness,
      closed,
      levelGuid: this.level?.guid ?? null,
      elevation: this.level?.elevation ?? 0,
      height: null,
      wallGuids: null,
    };
    this.chains.push(chain);
    this._renderChainFlat(chain);
    this.drawingPoints = [];
    this._clearPreview();
    this.onChainsChanged?.();
  }

  // ── malha plana persistente (linha dupla em planta) ──────────────────────
  _renderChainFlat(chain) {
    this._disposeChainMesh(chain.id);
    const group = new THREE.Group();
    group.name = `wall-sketch-chain-${chain.id}`;
    const segs = miteredWallSegments(chain.points, chain.thickness, chain.closed);
    segs.forEach((seg, segmentIndex) => {
      const geo = wallBox(seg.p0, seg.p1, chain.thickness, PLAN_PREVIEW_HEIGHT);
      if (!geo) return;
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
      );
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0xe0f2fe })
      );
      mesh.userData.wallSketch = { chainId: chain.id, segmentIndex };
      edges.userData.wallSketch = { chainId: chain.id, segmentIndex };
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

  // ── API usada pelo IfcPanel / DimensionController ────────────────────────
  getChains() {
    return this.chains;
  }

  getChain(chainId) {
    return this.chains.find((c) => c.id === chainId) ?? null;
  }

  /** Grupo de malhas (planta) de uma cadeia ainda não convertida — usado pelo raycast de cota. */
  getFlatMeshGroups() {
    return [...this._chainMeshes.values()];
  }

  /** Segmento de cadeia associado a um guid de IfcWall já convertido (ou null). */
  getSegmentForGuid(guid) {
    return this._guidToSegment.get(guid) ?? null;
  }

  /** Marca a cadeia como convertida: remove a malha plana e passa a referenciar os IfcWall reais. */
  markChainConverted(chainId, wallGuids, height) {
    const chain = this.getChain(chainId);
    if (!chain) return;
    chain.wallGuids = wallGuids;
    chain.height = height;
    wallGuids.forEach((guid, segmentIndex) => {
      if (guid) this._guidToSegment.set(guid, { chainId, segmentIndex });
    });
    this._disposeChainMesh(chainId);
    this.onChainsChanged?.();
  }

  /** Atualiza os vértices de uma cadeia (edição paramétrica de cota) e redesenha, se ainda for só planta. */
  updateChainPoints(chainId, newPoints) {
    const chain = this.getChain(chainId);
    if (!chain) return;
    chain.points = newPoints.map((p) => p.clone());
    if (!chain.wallGuids) this._renderChainFlat(chain);
  }

  removeChain(chainId) {
    this._disposeChainMesh(chainId);
    this.chains = this.chains.filter((c) => c.id !== chainId);
    for (const [guid, seg] of this._guidToSegment) {
      if (seg.chainId === chainId) this._guidToSegment.delete(guid);
    }
    this.onChainsChanged?.();
  }

  _status(msg) {
    this.onStatus?.(msg);
  }
}

export default WallSketchController;
