import ToolBase from './ToolBase';
import * as THREE from 'three';

export default class SlabTool extends ToolBase {
  constructor(manager) {
    super(manager);
    this._state = 'idle';
    this._points = [];
    this.thickness = 0.2;
    this.baseLevelId = null;
  }

  onPointerDown(point) {
    if (this._state === 'idle') {
      this._state = 'drawing';
      this._points = [point.clone()];
      return;
    }
    if (this._state === 'drawing') {
      // if clicked near first point and >=3 points, close polygon
      const first = this._points[0];
      if (first.distanceTo(point) < 0.2 && this._points.length >= 3) {
        // finalize
        const contour = this._points.map((p) => p.clone());
        // ensure closed
        if (!contour[0].equals(contour[contour.length - 1])) contour.push(contour[0].clone());
        const defaults = this.manager.levelManager.getDefaultLevelIds ? this.manager.levelManager.getDefaultLevelIds() : {};
        const slab = this.manager.createSlab({ contour, thickness: this.thickness, baseLevelId: this.baseLevelId || defaults.base });
        this._state = 'idle';
        this._points = [];
        return;
      }
      // otherwise add point
      this._points.push(point.clone());
    }
  }

  onPointerMove(point) {
    if (this._state === 'drawing') {
      // update preview last point
      if (this._points.length === 0) return;
      this._preview = point.clone();
    }
  }

  onPointerUp(point) {}

  // programmatic close of polygon
  closePolygon() {
    if (this._state !== 'drawing' || this._points.length < 3) return null;
    const contour = this._points.map((p) => p.clone());
    if (!contour[0].equals(contour[contour.length - 1])) contour.push(contour[0].clone());
    const defaults = this.manager.levelManager.getDefaultLevelIds ? this.manager.levelManager.getDefaultLevelIds() : {};
    const slab = this.manager.createSlab({ contour, thickness: this.thickness, baseLevelId: this.baseLevelId || defaults.base });
    this._state = 'idle';
    this._points = [];
    return slab;
  }

  getParameterSchema() {
    return { name: 'Slab', editable: ['thickness', 'baseLevelId'] };
  }
}
