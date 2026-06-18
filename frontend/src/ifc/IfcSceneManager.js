/**
 * src/ifc/IfcSceneManager.js
 *
 * Mantém o grupo de malhas IFC dentro da cena do ThreeCanvas e um índice
 * guid -> { mesh, edges }. É a "ponte" entre o JSON do backend e a cena:
 *   - loadModel(meshJson)            carrega o modelo inteiro
 *   - replaceProduct(productJson)    troca a malha de um produto (pós-edição)
 *   - removeProduct(guid)            remove um produto
 *   - pick(raycaster)                resolve um intersect -> guid
 *   - setSelected(guid)              destaca o produto selecionado
 *
 * O viewport é Z-up, idêntico ao IFC; não há conversão de coordenadas.
 */

import * as THREE from "three";
import { meshFromProduct, edgesForMesh, colorForType } from "./ifcMeshLoader.js";

const SELECTED_COLOR = 0x22d3ee;

export class IfcSceneManager {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "ifc-root";
    scene.add(this.group);
    /** @type {Map<string, {mesh: THREE.Mesh, edges: THREE.LineSegments}>} */
    this.items = new Map();
    this.selectedGuid = null;
  }

  /** Remove todas as malhas IFC e libera recursos. */
  clear() {
    for (const guid of [...this.items.keys()]) this.removeProduct(guid);
    this.selectedGuid = null;
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
  }

  _addProduct(product) {
    const mesh = meshFromProduct(product);
    if (!mesh) return null;
    const edges = edgesForMesh(mesh);
    this.group.add(mesh);
    this.group.add(edges);
    this.items.set(product.guid, { mesh, edges });
    return mesh;
  }

  _disposeItem(item) {
    for (const obj of [item.mesh, item.edges]) {
      this.group.remove(obj);
      obj.geometry?.dispose();
      obj.material?.dispose();
    }
  }

  /**
   * Carrega o modelo inteiro a partir de `GET /mesh`.
   * @param {{products:Array, bbox:?{min:number[],max:number[]}}} meshJson
   */
  loadModel(meshJson) {
    this.clear();
    for (const product of meshJson.products ?? []) this._addProduct(product);
    return meshJson.bbox ?? null;
  }

  /**
   * Substitui (ou adiciona) a malha de um único produto, a partir de
   * `GET /mesh/{guid}`. Retessellação incremental pós-edição.
   * @param {{products:Array}} productJson
   */
  replaceProduct(productJson) {
    const product = productJson.products?.[0];
    if (!product) return null;
    const old = this.items.get(product.guid);
    if (old) this._disposeItem(old);
    const mesh = this._addProduct(product);
    if (this.selectedGuid === product.guid) this.setSelected(product.guid);
    return mesh;
  }

  removeProduct(guid) {
    const item = this.items.get(guid);
    if (!item) return;
    this._disposeItem(item);
    this.items.delete(guid);
    if (this.selectedGuid === guid) this.selectedGuid = null;
  }

  getMesh(guid) {
    return this.items.get(guid)?.mesh ?? null;
  }

  /** Resolve a primeira interseção de um raycaster para um guid IFC. */
  pick(raycaster) {
    const meshes = [...this.items.values()].map((i) => i.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    return hits.length ? hits[0].object.userData.ifc.guid : null;
  }

  /** Destaca o produto `guid` (ou limpa o destaque se null). */
  setSelected(guid) {
    // restaura cor do anterior
    if (this.selectedGuid && this.items.has(this.selectedGuid)) {
      const prev = this.items.get(this.selectedGuid).mesh;
      prev.material.color.setHex(colorForType(prev.userData.ifc.type));
      prev.material.emissive?.setHex(0x000000);
    }
    this.selectedGuid = guid;
    if (guid && this.items.has(guid)) {
      const mesh = this.items.get(guid).mesh;
      mesh.material.color.setHex(SELECTED_COLOR);
      mesh.material.emissive?.setHex(0x0e7490);
    }
  }
}

export default IfcSceneManager;
