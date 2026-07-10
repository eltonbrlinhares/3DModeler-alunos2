export class HistoryManager {
  constructor() {
    this.stack = [];
    this.index = -1;
  }
  push(cmd) { this.stack.splice(this.index+1); this.stack.push(cmd); this.index = this.stack.length-1; }
  undo() { if (this.index>=0) { const c=this.stack[this.index--]; if (c && c.undo) c.undo(); } }
  redo() { if (this.index+1<this.stack.length) { const c=this.stack[++this.index]; if (c && c.execute) c.execute(); } }
}
