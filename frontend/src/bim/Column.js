import BaseElement from './BaseElement';
import * as THREE from 'three';

export default class Column extends BaseElement {
  constructor(id, params = {}) {
    super(id);
    this.bimType = 'Column';
    this._params = {
      position: params.position || new THREE.Vector3(0, 0, 0),
      rotation: params.rotation || 0, // radians around Z
      width: params.width || 0.4,
      depth: params.depth || 0.4,
      profile: params.profile || 'rectangular',
      material: params.material || { color: 0x888888 },
      baseLevelId: params.baseLevelId || null,
      topLevelId: params.topLevelId || null,
      type: params.type || 'generic',
    };

    // Rebuild geometry on param changes
    this.on('paramChanged', () => this.invalidateGeometry());
  }

  // compute height from LevelManager or fallback
  _computeHeight(sceneHelpers = {}) {
    const lm = sceneHelpers.levelManager;
    let baseElev = 0;
    let topElev = null;
    if (lm) {
      if (this._params.baseLevelId) baseElev = lm.getElevation(this._params.baseLevelId) ?? 0;
      if (this._params.topLevelId) topElev = lm.getElevation(this._params.topLevelId) ?? null;
    }
    if (topElev === null && typeof this._params.topLevel === 'number') topElev = this._params.topLevel;
    if (topElev === null) topElev = baseElev + 3.0;
    const height = Math.max(0, Number(topElev) - Number(baseElev));
    return { baseElev, topElev, height };
  }

  geometryFactory(sceneHelpers = {}) {
    const pos = this._params.position || new THREE.Vector3(0, 0, 0);
    const rotation = Number(this._params.rotation) || 0;
    const width = Number(this._params.width) || 0.4;
    const depth = Number(this._params.depth) || 0.4;

    const { baseElev, height } = this._computeHeight(sceneHelpers);

    // create box geometry representing the column extruded
    const geom = new THREE.BoxGeometry(width, depth, height);
    const mat = new THREE.MeshStandardMaterial(this._params.material || { color: 0x888888 });
    const mesh = new THREE.Mesh(geom, mat);

    mesh.position.set(pos.x, pos.y, baseElev + height / 2);
    mesh.rotation.z = rotation;
    mesh.userData = { id: this.id, params: this.params };
    return mesh;
  }

  // 2D plan representation: rectangle outline
  planRepresentation() {
    const group = new THREE.Group();
    const pos = this._params.position || new THREE.Vector3(0, 0, 0);
    const rotation = Number(this._params.rotation) || 0;
    const width = Number(this._params.width) || 0.4;
    const depth = Number(this._params.depth) || 0.4;

    // rectangle points centered at pos
    const hw = width / 2;
    const hd = depth / 2;
    const corners = [
      new THREE.Vector3(-hw, -hd, 0),
      new THREE.Vector3(hw, -hd, 0),
      new THREE.Vector3(hw, hd, 0),
      new THREE.Vector3(-hw, hd, 0),
      new THREE.Vector3(-hw, -hd, 0),
    ];

    const rotMat = new THREE.Matrix4().makeRotationZ(rotation);
    for (const c of corners) c.applyMatrix4(rotMat).add(pos);

    const geom = new THREE.BufferGeometry().setFromPoints(corners);
    const mat = new THREE.LineBasicMaterial({ color: 0x222222 });
    const line = new THREE.Line(geom, mat);
    group.add(line);
    group.userData = { elementId: this.id };
    return group;
  }
}
