import ToolBase from './ToolBase';

export default class ColumnTool extends ToolBase {
  constructor(manager) {
    super(manager);
    this._state = 'idle';
    this._currentId = null;
  }

  onPointerDown(point) {
    if (this._state === 'idle') {
      this._state = 'placing';
      // create a column at this point with default sizes
      const defaults = { position: point.clone(), width: 0.4, depth: 0.4 };
      const col = this.manager.createColumn(defaults);
      this._currentId = col.id;
    }
  }

  onPointerMove(point) {
    if (this._state === 'placing' && this._currentId) {
      const col = this.manager.getElement(this._currentId);
      if (!col) return;
      col.setParam('position', point.clone());
    }
  }

  onPointerUp(point) {
    if (this._state === 'placing') {
      this._state = 'idle';
      this._currentId = null;
    }
  }

  getParameterSchema() {
    return {
      name: 'Column',
      editable: ['width', 'depth', 'rotation', 'profile', 'type'],
    };
  }
}
