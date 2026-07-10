import ToolBase from './ToolBase';

export default class SelectTool extends ToolBase {
  constructor(manager) {
    super(manager);
    this.selected = null;
  }

  onPointerDown(point) {
    // simple selection by nearest element center (manager should provide search)
    const elem = this.manager.findClosest(point, 0.5);
    this.selected = elem || null;
    this.manager._emit('selectionChanged', { id: this.selected?.id || null });
  }

  getParameterSchema() {
    return {
      name: 'Select',
      editable: false,
    };
  }
}
