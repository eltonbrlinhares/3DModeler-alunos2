/**
 * src/ifc/insertion/SelectionController.js
 *
 * Seleção de produtos por clique (raycast). Distingue clique de arraste (move
 * < 4 px) e devolve o GUID atingido via `onPick`. Fica inerte enquanto há uma
 * inserção em curso (`isInserting`) ou um arraste de gizmo (`isTransforming`),
 * para os três modos de interação não brigarem pelo mesmo clique.
 */
import * as THREE from "three";

export class SelectionController {
  constructor({ camera, dom, getManager, onPick, isInserting, isTransforming }) {
    this.camera = camera;
    this.dom = dom;
    this.getManager = getManager;
    this.onPick = onPick;
    this.isInserting = isInserting;
    this.isTransforming = isTransforming;
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._downXY = null;
  }

  attach() {
    this._onDown = (ev) => {
      if (this.isInserting()) return;
      this._downXY = [ev.clientX, ev.clientY];
    };
    this._onUp = (ev) => {
      if (this.isInserting()) return;
      if (this.isTransforming()) return;
      if (
        !this._downXY ||
        Math.hypot(ev.clientX - this._downXY[0], ev.clientY - this._downXY[1]) > 4
      )
        return;
      const rect = this.dom.getBoundingClientRect();
      this._ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      this._ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      this._ray.setFromCamera(this._ndc, this.camera);
      this.onPick(this.getManager()?.pick(this._ray));
    };
    this.dom.addEventListener("pointerdown", this._onDown);
    this.dom.addEventListener("pointerup", this._onUp);
  }

  dispose() {
    this.dom.removeEventListener("pointerdown", this._onDown);
    this.dom.removeEventListener("pointerup", this._onUp);
  }
}
