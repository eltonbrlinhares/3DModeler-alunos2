/**
 * src/ifc/insertion/SelectionController.js
 *
 * Seleção de produtos por clique (raycast). Distingue clique de arraste (move
 * < 4 px) e devolve o GUID atingido via `onPick`. Se o clique não acertar
 * nenhum elemento IFC, tenta também as cotas manuais (`getDimensionManager`)
 * e chama `onPickDimension` nesse caso. Fica inerte enquanto há uma
 * inserção em curso (`isInserting`), um arraste de gizmo (`isTransforming`),
 * ou a ferramenta de cota manual ativa (`isCotaActive`), para os modos de
 * interação não brigarem pelo mesmo clique.
 */
import * as THREE from "three";

export class SelectionController {
  constructor({
    camera, getCamera, dom, getManager, onPick, isInserting, isTransforming,
    isCotaActive = () => false, getDimensionManager = () => null, onPickDimension = () => {},
  }) {
    this.camera = camera;
    this.getCamera = getCamera ?? (() => this.camera);
    this.dom = dom;
    this.getManager = getManager;
    this.onPick = onPick;
    this.isInserting = isInserting;
    this.isTransforming = isTransforming;
    this.isCotaActive = isCotaActive;
    this.getDimensionManager = getDimensionManager;
    this.onPickDimension = onPickDimension;
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._downXY = null;
  }

  attach() {
    this._onDown = (ev) => {
      if (this.isInserting() || this.isCotaActive()) return;
      this._downXY = [ev.clientX, ev.clientY];
    };
    this._onUp = (ev) => {
      if (this.isInserting() || this.isCotaActive()) return;
      if (this.isTransforming()) return;
      if (
        !this._downXY ||
        Math.hypot(ev.clientX - this._downXY[0], ev.clientY - this._downXY[1]) > 4
      )
        return;
      const rect = this.dom.getBoundingClientRect();
      this._ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      this._ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      const camera = this.getCamera?.() ?? this.camera;
      if (!camera) return;
      this._ray.setFromCamera(this._ndc, camera);
      const guid = this.getManager()?.pick(this._ray);
      if (guid) {
        this.onPick(guid);
        return;
      }
      const dimGuid = this.getDimensionManager()?.pick(this._ray);
      if (dimGuid) {
        this.onPickDimension(dimGuid);
        return;
      }
      this.onPick(null);
    };
    this.dom.addEventListener("pointerdown", this._onDown);
    this.dom.addEventListener("pointerup", this._onUp);
  }

  dispose() {
    this.dom.removeEventListener("pointerdown", this._onDown);
    this.dom.removeEventListener("pointerup", this._onUp);
  }
}
