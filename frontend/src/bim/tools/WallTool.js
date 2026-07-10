import ToolBase from './ToolBase';
import * as THREE from 'three';

export default class WallTool extends ToolBase {
  constructor(manager) {
    super(manager);
    this._temp = null; // temp wall element id
    this._state = 'idle';
  }

  onPointerDown(point) {
    if (this._state === 'idle') {
      this._state = 'drawing';
      // create wall with startPoint = point
      const wall = this.manager.createWall({ startPoint: point.clone(), endPoint: point.clone() });
      this._temp = wall.id;
      this._currentWall = wall;
    }
  }

  onPointerMove(point) {
    if (this._state === 'drawing' && this._temp) {
      const wall = this.manager.getElement(this._temp);
      if (!wall) return;
      wall.setParam('endPoint', point.clone());
      // update computed length param for UI purposes
      const len = wall.params.startPoint.distanceTo(wall.params.endPoint);
      // set length param which Wall listens to for edits
      wall.setParam('length', len);
    }
  }

  onPointerUp(point) {
    if (this._state === 'drawing') {
      this._state = 'idle';
      this._temp = null;
      this._currentWall = null;
    }
  }

  getParameterSchema() {
    return {
      name: 'Wall',
      editable: ['thickness', 'height', 'material', 'type'],
    };
  }

  // Programmatically edit the current wall's length (in meters)
  setLength(lengthMeters) {
    if (!this._temp) return;
    const wall = this.manager.getElement(this._temp);
    if (!wall) return;
    wall.setParam('length', Number(lengthMeters));
  }
}
