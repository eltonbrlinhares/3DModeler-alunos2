export default class Level {
  constructor(id, name = 'Level', elevation = 0, color = 0x666666) {
    this.id = id;
    this.name = name;
    this.elevation = Number(elevation) || 0;
    this.color = color;
  }
}
