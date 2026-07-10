export default class ToolBase {
  constructor(manager) {
    this.manager = manager;
    this.active = false;
  }

  activate(ctx = {}) {
    this.active = true;
    this.ctx = ctx;
  }

  deactivate() {
    this.active = false;
    this.ctx = null;
  }

  onPointerDown(point, event) {}
  onPointerMove(point, event) {}
  onPointerUp(point, event) {}

  // optional: return an object describing editable parameters
  getParameterSchema() {
    return {};
  }
}
