/**
 * src/ifc/planSketch/SlabSketchController.js
 *
 * Ferramenta "Laje" em planta 2D (mesmo espírito do WallSketchController):
 * desenha o CONTORNO poligonal (>= 3 pontos), encaixando SEMPRE em
 * interseções de grid/datum do nível ativo (ver planSketchSnap.js). Fecha de
 * três formas, iguais ao `tools/slabTool.js`: clicar no 1º ponto,
 * duplo-clique ou Enter. Cada contorno fechado (mas ainda não convertido em
 * 3D) vira um preenchimento fino persistente na cena.
 *
 * Diferente da parede/viga, aqui uma cadeia fechada = UMA única IfcSlab (o
 * polígono inteiro), não um segmento por trecho. `form.predefinedType`
 * ("BASESLAB" ou null) captura, no instante do fechamento, se o contorno é
 * uma laje comum ou um radier — a mesma opção que `tools/slabTool.js` já usa
 * no modo de inserção direta em 3D.
 *
 * Não fala com o backend: só acumula a "planta" (chains). A conversão em
 * IfcSlab real é feita por quem instancia este controller (ver
 * IfcPanel.jsx), que lê `getChains()` e chama a API.
 *
 * Uma "chain" é { id, points:THREE.Vector3[], levelGuid, elevation,
 * form:{...}, slabGuid:string|null }.
 */
import * as THREE from "three";
import { PreviewLayer } from "../insertion/PreviewLayer.js";
import { slabPrism, polygonAreaXY } from "../geometry/slabPrism.js";
import { lockedLevelCopy } from "../insertion/snapping.js";
import { snapGridPoint } from "./planSketchSnap.js";
import { SLAB_MIN_AREA } from "../insertion/constants.js";

const VERTEX_SNAP = 0.15; // m — encaixe em vértice existente / fechamento do contorno
const PLAN_PREVIEW_HEIGHT = 0.03;

let chainSeq = 0;
const nextChainId = () => `slc${++chainSeq}`;

/** Snapshot só dos campos que interessam à laje/radier. */
function snapshotForm(form = {}) {
  return {
    thickness: Number(form.thickness) || 0.25,
    axisRef: form.axisRef || "top",
    predefinedType: form.predefinedType === "BASESLAB" ? "BASESLAB" : null,
  };
}

export class SlabSketchController {
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
    this.sketchGroup.name = "slab-sketch-root";
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
      this._status(`Laje: clique as interseções do contorno no nível ${this.level.name ?? ""}.`);
    } else {
      this.drawingPoints = []; // contorno inacabado é descartado (diferente de parede/viga)
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
    return snap?.point ?? null;
  }

  _onPointerDown(ev) {
    if (!this.active) return;
    const p = this._point(ev);
    if (!p) {
      this._status("Laje: aproxime o mouse de uma interseção grid/nível.");
      return;
    }
    ev.preventDefault?.();
    ev.stopPropagation?.();

    const first = this.drawingPoints[0];
    const last = this.drawingPoints[this.drawingPoints.length - 1];
    if (first && this.drawingPoints.length >= 3 && p.distanceTo(first) < VERTEX_SNAP) {
      this._finishCurrentChain();
      return;
    }
    if (last && p.distanceTo(last) < VERTEX_SNAP) {
      this._status("Laje: escolha uma próxima interseção diferente.");
      return;
    }
    if (this.drawingPoints.some((pt) => pt.distanceTo(p) < VERTEX_SNAP)) {
      this._status("Laje: esse ponto já foi usado. Clique o primeiro ponto para fechar.");
      return;
    }
    this.drawingPoints.push(p.clone());
    this._drawLivePreview();
    this._status(
      this.drawingPoints.length < 3
        ? "Laje: continue clicando interseções do contorno."
        : "Laje: clique mais pontos ou feche (1º ponto, duplo-clique ou Enter)."
    );
  }

  _onPointerMove(ev) {
    if (!this.active || !this.drawingPoints.length) return;
    const p = this._point(ev);
    this._drawLivePreview(p);
  }

  _onDoubleClick(ev) {
    if (!this.active || this.drawingPoints.length < 3) return;
    ev.preventDefault?.();
    ev.stopPropagation?.();
    this._finishCurrentChain();
  }

  _onKeyDown(ev) {
    if (!this.active) return;
    if (ev.key === "Enter") this._finishCurrentChain();
  }

  // ── preview do contorno em desenho ───────────────────────────────────────
  _drawLivePreview(candidate = null) {
    if (!this.drawingPoints.length || !this.preview) return;
    const pts = candidate ? [...this.drawingPoints, candidate.clone()] : [...this.drawingPoints];
    const pv = this.preview.begin("slab-sketch-live-preview");
    if (pts.length >= 2) {
      pv.line([...pts, pts[0]], { color: 0xffffff, opacity: 1, depthTest: false });
    }
    if (pts.length >= 3) {
      const geo = slabPrism(pts, PLAN_PREVIEW_HEIGHT, "top");
      if (geo) pv.solid(geo, { fill: 0x38bdf8, edge: 0xe0f2fe, opacity: 0.45 });
    }
  }

  _clearPreview() {
    this.preview?.clear();
  }

  // ── finalizar contorno ────────────────────────────────────────────────────
  _finishCurrentChain() {
    if (this.drawingPoints.length < 3) {
      this._status("Laje: informe ao menos 3 pontos.");
      this.drawingPoints = [];
      this._clearPreview();
      return;
    }
    if (Math.abs(polygonAreaXY(this.drawingPoints)) < SLAB_MIN_AREA) {
      this._status("Laje: o polígono está muito pequeno ou inválido.");
      this.drawingPoints = [];
      this._clearPreview();
      return;
    }
    const before = this.snapshotChains();
    const chain = {
      id: nextChainId(),
      points: this.drawingPoints.map((p) => p.clone()),
      levelGuid: this.level?.guid ?? null,
      elevation: this.level?.elevation ?? 0,
      form: snapshotForm(this.getForm?.() ?? {}),
      slabGuid: null,
    };
    this.chains.push(chain);
    this._renderChainFlat(chain);
    this.drawingPoints = [];
    this._clearPreview();
    this._status("Laje: contorno concluído. Clique para iniciar um novo contorno.");
    this.onChainsChanged?.();
    this.onHistoryPush?.(before, this.snapshotChains());
  }

  // ── preenchimento plano persistente ───────────────────────────────────────
  _renderChainFlat(chain) {
    this._disposeChainMesh(chain.id);
    const geo = slabPrism(chain.points, PLAN_PREVIEW_HEIGHT, "top");
    if (!geo) return;
    const isRaft = chain.form.predefinedType === "BASESLAB";
    const group = new THREE.Group();
    group.name = `slab-sketch-chain-${chain.id}`;
    const fill = isRaft ? 0xa3e635 : 0x38bdf8;
    const edge = isRaft ? 0xecfccb : 0xe0f2fe;
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: fill, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
    );
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: edge }));
    mesh.userData.slabSketch = { chainId: chain.id };
    edges.userData.slabSketch = { chainId: chain.id };
    group.add(mesh, edges);
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
      levelGuid: c.levelGuid,
      elevation: c.elevation,
      form: { ...c.form },
      slabGuid: c.slabGuid,
    }));
  }

  restoreChains(snapshot) {
    for (const chainId of [...this._chainMeshes.keys()]) this._disposeChainMesh(chainId);
    this.chains = (snapshot ?? []).map((c) => ({
      id: c.id,
      points: c.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      levelGuid: c.levelGuid,
      elevation: c.elevation,
      form: { ...c.form },
      slabGuid: c.slabGuid,
    }));
    for (const chain of this.chains) {
      if (!chain.slabGuid) this._renderChainFlat(chain);
    }
    this.onChainsChanged?.();
  }

  getChain(chainId) {
    return this.chains.find((c) => c.id === chainId) ?? null;
  }

  markChainConverted(chainId, guid) {
    const chain = this.getChain(chainId);
    if (!chain) return;
    chain.slabGuid = guid;
    this._disposeChainMesh(chainId);
    this.onChainsChanged?.();
  }

  revertChainTo2D(chainId) {
    const chain = this.getChain(chainId);
    if (!chain || !chain.slabGuid) return;
    chain.slabGuid = null;
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

export default SlabSketchController;
