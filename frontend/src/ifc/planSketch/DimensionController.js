/**
 * src/ifc/planSketch/DimensionController.js
 *
 * Ferramenta "Cota": clique sobre um trecho de parede (planta 2D ainda não
 * convertida, ou IfcWall já gerado em 3D) para criar uma cota linear com o
 * comprimento do eixo original daquele trecho. Clicar no valor numérico da
 * cota o transforma num campo editável (CSS2DObject + <input> real).
 *
 * Comportamento paramétrico: ao confirmar um novo valor, o vértice "livre" do
 * trecho (a extremidade de maior índice) é deslocado para a nova distância a
 * partir do vértice-âncora, e TODOS os vértices seguintes da cadeia são
 * transladados pelo mesmo delta — propagando a alteração sem abrir vãos nem
 * sobrepor as paredes seguintes. Se a cadeia já foi convertida em 3D, os
 * IfcWall correspondentes são atualizados no backend (dimensions/placement).
 */
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { wallSegmentPlacement, resizeRectangleSide } from "../geometry/wallChainSegments.js";

const OFFSET = 0.45; // m — deslocamento perpendicular da linha de cota

function formatLength(meters) {
  return meters >= 1 ? `${meters.toFixed(2)} m` : `${Math.round(meters * 100)} cm`;
}

function parseLength(text) {
  const t = text.trim().toLowerCase().replace(",", ".");
  const value = parseFloat(t);
  if (!Number.isFinite(value) || value <= 0) return null;
  return t.endsWith("cm") ? value / 100 : value;
}

let dimSeq = 0;

export class DimensionController {
  constructor({
    getScene,
    getCamera,
    getDom,
    getOrbit,
    getWallSketch,
    getIfcManager,
    getModelId,
    api,
    onGeometryChanged,
    onHistoryPush,
    setStatus,
    onError,
  }) {
    this.getScene = getScene;
    this.getCamera = getCamera;
    this.getDom = getDom;
    this.getOrbit = getOrbit;
    this.getWallSketch = getWallSketch;
    this.getIfcManager = getIfcManager;
    this.getModelId = getModelId;
    this.api = api;
    this.onGeometryChanged = onGeometryChanged;
    this.onHistoryPush = onHistoryPush; // (sketchBefore, sketchAfter, backendCount) => void, opcional
    this.setStatus = setStatus ?? (() => {});
    this.onError = onError ?? ((e) => console.error(e));

    this.active = false;
    this.dimensions = []; // { id, chainId, segmentIndex, group, css2d, div, input }
    this.group = new THREE.Group();
    this.group.name = "wall-sketch-dimensions";
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
  }

  mount() {
    this.getScene()?.add(this.group);
  }

  attach() {
    const dom = this.getDom();
    if (!dom) return;
    this._onDown = (ev) => this._onPointerDown(ev);
    dom.addEventListener("pointerdown", this._onDown);
  }

  detach() {
    const dom = this.getDom();
    dom?.removeEventListener("pointerdown", this._onDown);
  }

  dispose() {
    this.detach();
    for (const dim of [...this.dimensions]) this._disposeDimension(dim);
    this.getScene()?.remove(this.group);
  }

  setActive(active) {
    this.active = active;
    const orbit = this.getOrbit();
    if (orbit) orbit.enabled = !active;
    const dom = this.getDom();
    if (dom) dom.style.cursor = active ? "crosshair" : "";
    if (active) this.setStatus("Cota: clique sobre uma parede para medi-la.");
  }

  // ── seleção de trecho por clique ──────────────────────────────────────────
  _onPointerDown(ev) {
    if (!this.active) return;
    const hit = this._pickSegment(ev);
    if (!hit) return;
    ev.preventDefault?.();
    ev.stopPropagation?.();
    const existing = this.dimensions.find(
      (d) => d.chainId === hit.chainId && d.segmentIndex === hit.segmentIndex
    );
    if (existing) {
      this._enterEdit(existing);
      return;
    }
    this._createDimension(hit.chainId, hit.segmentIndex);
  }

  _pickSegment(ev) {
    const camera = this.getCamera();
    const dom = this.getDom();
    if (!camera || !dom) return null;
    const rect = dom.getBoundingClientRect();
    this._ndc.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    this._ray.setFromCamera(this._ndc, camera);

    const wallSketch = this.getWallSketch();
    // 1) trechos ainda só em planta (malhas do próprio sketch)
    const flatGroups = wallSketch?.getFlatMeshGroups?.() ?? [];
    const flatMeshes = flatGroups.flatMap((g) => g.children);
    const flatHit = this._ray.intersectObjects(flatMeshes, false)[0];
    if (flatHit?.object?.userData?.wallSketch) return flatHit.object.userData.wallSketch;

    // 2) trechos já convertidos em IfcWall (malha real do IfcSceneManager)
    const guid = this.getIfcManager?.()?.pick?.(this._ray);
    if (guid) {
      const seg = wallSketch?.getSegmentForGuid?.(guid);
      if (seg) return seg;
    }
    return null;
  }

  // ── criação e desenho da cota ─────────────────────────────────────────────
  _createDimension(chainId, segmentIndex) {
    const chain = this.getWallSketch()?.getChain(chainId);
    if (!chain) return;
    const dim = {
      id: `dim${++dimSeq}`,
      chainId,
      segmentIndex,
      group: new THREE.Group(),
      css2d: null,
      div: null,
    };
    this.group.add(dim.group);
    this.dimensions.push(dim);
    this._redraw(dim);
    this.setStatus("Cota criada. Clique no valor para editar.");
  }

  _segmentEndpoints(chain, segmentIndex) {
    const a = chain.points[segmentIndex];
    const b = chain.points[segmentIndex + 1];
    return [a, b];
  }

  _redraw(dim) {
    const chain = this.getWallSketch()?.getChain(dim.chainId);
    if (!chain) {
      this._disposeDimension(dim);
      return;
    }
    const [a, b] = this._segmentEndpoints(chain, dim.segmentIndex);
    const length = a.distanceTo(b);

    dim.group.clear();
    const dir = new THREE.Vector3().subVectors(b, a);
    dir.z = 0;
    const len2d = Math.hypot(dir.x, dir.y) || 1;
    const perp = new THREE.Vector3(-dir.y / len2d, dir.x / len2d, 0).multiplyScalar(OFFSET);
    const a2 = a.clone().add(perp);
    const b2 = b.clone().add(perp);
    const mid = a2.clone().add(b2).multiplyScalar(0.5);

    const geo = new THREE.BufferGeometry().setFromPoints([a, a2, b2, b, b2, a2]);
    const line = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0xfacc15, depthTest: false, transparent: true, opacity: 0.95 })
    );
    line.renderOrder = 998;
    dim.group.add(line);

    if (!dim.div) {
      dim.div = document.createElement("div");
      dim.div.style.font = "11px monospace";
      dim.div.style.color = "#111827";
      dim.div.style.background = "#facc15";
      dim.div.style.padding = "1px 5px";
      dim.div.style.borderRadius = "3px";
      dim.div.style.cursor = "text";
      dim.div.style.userSelect = "none";
      dim.div.style.whiteSpace = "nowrap";
      // o CSS2DRenderer é criado com pointer-events:none (para não bloquear o
      // canvas sob os rótulos de eixo) — reabilita só para a cota, que precisa
      // ser clicável para edição.
      dim.div.style.pointerEvents = "auto";
      dim.div.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      dim.div.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._enterEdit(dim);
      });
      dim.css2d = new CSS2DObject(dim.div);
    }
    // `dim.group.clear()` acima também remove o css2d (é filho do group) — ele
    // precisa ser readicionado sempre, não só na primeira criação, senão a
    // cota fica "presa" no ar (sem posição atualizada) depois da 1ª edição.
    dim.group.add(dim.css2d);
    dim.div.textContent = formatLength(length);
    dim.css2d.position.copy(mid);
  }

  _enterEdit(dim) {
    if (!dim.div) return;
    const chain = this.getWallSketch()?.getChain(dim.chainId);
    if (!chain) return;
    const [a, b] = this._segmentEndpoints(chain, dim.segmentIndex);
    const current = a.distanceTo(b);

    const input = document.createElement("input");
    input.type = "text";
    input.value = current.toFixed(2);
    input.style.width = "56px";
    input.style.font = "11px monospace";
    input.style.padding = "1px 3px";
    dim.div.textContent = "";
    dim.div.appendChild(input);
    input.focus();
    input.select();

    const finish = (commit) => {
      const value = commit ? parseLength(input.value) : null;
      input.removeEventListener("keydown", onKey);
      input.removeEventListener("blur", onBlur);
      if (value != null) this._applyLength(dim, value);
      else this._redraw(dim);
    };
    const onKey = (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") finish(true);
      else if (ev.key === "Escape") finish(false);
    };
    const onBlur = () => finish(true);
    input.addEventListener("keydown", onKey);
    input.addEventListener("blur", onBlur);
  }

  // ── edição paramétrica ────────────────────────────────────────────────────
  async _applyLength(dim, newLength) {
    const wallSketch = this.getWallSketch();
    const chain = wallSketch?.getChain(dim.chainId);
    if (!chain) return;
    const i = dim.segmentIndex;
    const oldPoints = chain.points.map((p) => p.clone());
    const sketchBefore = wallSketch.snapshotChains();
    // cadeia fechada de 4 pontos (retângulo/paralelogramo): o lado oposto
    // acompanha a mesma medida nova, os outros dois lados ficam como estavam.
    const isRectangle = chain.closed && chain.points.length === 4;

    let newPoints;
    if (isRectangle) {
      newPoints = resizeRectangleSide(chain.points, i, newLength);
    } else {
      const anchor = chain.points[i];
      const free = chain.points[i + 1];
      const dir = new THREE.Vector3().subVectors(free, anchor).normalize();
      const newFree = anchor.clone().addScaledVector(dir, newLength);
      const delta = new THREE.Vector3().subVectors(newFree, free);
      newPoints = chain.points.map((p, idx) => (idx <= i ? p.clone() : p.clone().add(delta)));
    }
    wallSketch.updateChainPoints(chain.id, newPoints);

    let backendCount = 0;
    if (chain.wallGuids) {
      backendCount = isRectangle
        ? await this._propagateRectangleToBackend(chain, i, oldPoints, newPoints)
        : await this._propagateChainToBackend(chain, i, oldPoints, newPoints);
    }
    this._refreshDimensionsForChain(chain.id);
    this.onHistoryPush?.(sketchBefore, wallSketch.snapshotChains(), backendCount);
  }

  /** Cadeia ABERTA: o segmento editado muda de comprimento; os seguintes só transladam.
   * Retorna quantas chamadas de backend foram feitas (para o desfazer/refazer global). */
  async _propagateChainToBackend(chain, editedIndex, oldPoints, newPoints) {
    const modelId = this.getModelId();
    if (!modelId) return 0;
    try {
      this.setStatus("Atualizando parede…");
      const height = chain.height ?? 2.8;
      const calls = [];
      const editedGuid = chain.wallGuids[editedIndex];
      if (editedGuid) {
        const newLength = newPoints[editedIndex].distanceTo(newPoints[editedIndex + 1]);
        calls.push(
          this.api.editDimensions(modelId, {
            guid: editedGuid,
            length: newLength,
            height,
            thickness: chain.thickness,
          })
        );
      }
      const delta = new THREE.Vector3().subVectors(
        newPoints[editedIndex + 1],
        oldPoints[editedIndex + 1]
      );
      for (let j = editedIndex + 1; j < chain.wallGuids.length; j += 1) {
        const guid = chain.wallGuids[j];
        if (guid) {
          calls.push(
            this.api.editPlacement(modelId, { guid, translate: [delta.x, delta.y, delta.z] })
          );
        }
      }
      await Promise.all(calls);
      await this.onGeometryChanged?.(modelId);
      this.setStatus("Parede redimensionada.");
      return calls.length;
    } catch (e) {
      this.onError(e);
      return 0;
    }
  }

  /**
   * Cadeia FECHADA de 4 pontos, reconstruída como retângulo exato por
   * `resizeRectangleSide`: só o vértice-âncora (`i`) e seu diagonal oposto
   * (`i+3`) ficam fixos — os outros dois (`i+1`, `i+2`) podem mudar de
   * posição E de ângulo (a cadeia original raramente é um paralelogramo
   * perfeito). Por isso os segmentos `i` e `i+1` têm sua posição/rotação
   * recalculada do zero, não só transladada. O segmento `i+3` não muda (os
   * dois vértices ficam fixos).
   */
  async _propagateRectangleToBackend(chain, editedIndex, oldPoints, newPoints) {
    const modelId = this.getModelId();
    if (!modelId) return 0;
    const n = newPoints.length;
    const i = editedIndex;
    const ip1 = (i + 1) % n;
    const ip2 = (i + 2) % n;
    try {
      this.setStatus("Atualizando parede…");
      const height = chain.height ?? 2.8;
      const calls = [];
      for (const segIndex of [i, ip1, ip2]) {
        const guid = chain.wallGuids[segIndex];
        if (!guid) continue;
        const a = newPoints[segIndex];
        const b = newPoints[(segIndex + 1) % n];
        const { length, rotation_z, position } = wallSegmentPlacement(a, b, chain.thickness);
        calls.push(
          this.api.editDimensions(modelId, { guid, length, height, thickness: chain.thickness })
        );
        calls.push(this.api.editPlacement(modelId, { guid, position, rotation_z }));
      }
      // segmento i+3: os dois vértices (âncora e diagonal oposto) ficam fixos — nada muda.

      await Promise.all(calls);
      await this.onGeometryChanged?.(modelId);
      this.setStatus("Parede redimensionada.");
      return calls.length;
    } catch (e) {
      this.onError(e);
      return 0;
    }
  }

  _refreshDimensionsForChain(chainId) {
    for (const dim of this.dimensions) {
      if (dim.chainId === chainId) this._redraw(dim);
    }
  }

  /** Redesenha (ou descarta, se a cadeia não existe mais) todas as cotas —
   * chamado após um desfazer/refazer global, já que as cadeias podem ter
   * mudado de forma independente de qualquer clique nesta ferramenta. */
  refreshAll() {
    const wallSketch = this.getWallSketch();
    for (const dim of [...this.dimensions]) {
      if (wallSketch?.getChain(dim.chainId)) this._redraw(dim);
      else this._disposeDimension(dim);
    }
  }

  _disposeDimension(dim) {
    dim.group.clear();
    this.group.remove(dim.group);
    this.dimensions = this.dimensions.filter((d) => d.id !== dim.id);
  }
}

export default DimensionController;
