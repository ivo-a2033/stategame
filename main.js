// Phaser layer: reads Sim state and draws it. No game logic here.

const WORLD_W = CONFIG.GRID_W * CONFIG.CELL;
const WORLD_H = CONFIG.GRID_H * CONFIG.CELL;

function shade(hex, f) {
  const r = Math.round(((hex >> 16) & 255) * f);
  const g = Math.round(((hex >> 8) & 255) * f);
  const b = Math.round((hex & 255) * f);
  return (r << 16) | (g << 8) | b;
}
function css(hex) { return '#' + hex.toString(16).padStart(6, '0'); }
function ownerColor(owner) {
  const P = CONFIG.COLORS.players;
  return owner < 0 ? CONFIG.COLORS.neutral : P[owner % P.length];
}

class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    this.cameras.main.setBackgroundColor(CONFIG.COLORS.ocean);
    this.add.text(WORLD_W / 2, WORLD_H * 0.28, 'STATE CLONE', {
      fontFamily: 'Arial', fontSize: '44px', fontStyle: 'bold', color: '#ffffff',
    }).setOrigin(0.5);
    this.add.text(WORLD_W / 2, WORLD_H * 0.28 + 50,
      'Click your capital, then click a target.\nCapture every capital to win.', {
        fontFamily: 'Arial', fontSize: '15px', color: '#9fb3c8', align: 'center',
      }).setOrigin(0.5);

    const btn = this.add.rectangle(WORLD_W / 2, WORLD_H * 0.55, 200, 64, 0x3b82f6)
      .setStrokeStyle(3, 0xffffff).setInteractive({ useHandCursor: true });
    this.add.text(WORLD_W / 2, WORLD_H * 0.55, 'PLAY', {
      fontFamily: 'Arial', fontSize: '30px', fontStyle: 'bold', color: '#ffffff',
    }).setOrigin(0.5);
    btn.on('pointerover', () => btn.setFillStyle(0x60a5fa));
    btn.on('pointerout', () => btn.setFillStyle(0x3b82f6));
    btn.on('pointerdown', () => this.scene.start('Game'));
  }
}

class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  create() {
    const C = CONFIG;
    this.cameras.main.setBackgroundColor(C.COLORS.ocean);

    const seed = (Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0;
    this.map = generateMapWithRetry(seed);
    this.sim = new Sim(this.map, this.map.seed);
    this.selected = null;
    this.acc = 0;
    this.endTime = 0;
    this.overlayShown = false;

    // cells per region for fast repaint on capture
    this.regionCells = this.map.capitals.map(() => []);
    for (let i = 0; i < this.map.regionId.length; i++) {
      const r = this.map.regionId[i];
      if (r >= 0) this.regionCells[r].push(i);
    }

    // terrain canvas, painted once
    if (this.textures.exists('terrain')) this.textures.remove('terrain');
    this.terrain = this.textures.createCanvas('terrain', WORLD_W, WORLD_H);
    const ctx = this.terrain.getContext();
    ctx.fillStyle = css(C.COLORS.ocean);
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    for (const cap of this.sim.caps) this.paintRegion(cap.id);
    this.terrain.refresh();
    this.add.image(0, 0, 'terrain').setOrigin(0, 0).setDepth(0);

    this.unitG = this.add.graphics().setDepth(1);
    this.capG = this.add.graphics().setDepth(2);

    this.capTexts = this.sim.caps.map((cap) =>
      this.add.text(cap.x, cap.y - C.CAPITAL_RADIUS - 1, '', {
        fontFamily: 'Arial', fontSize: '12px', fontStyle: 'bold', color: '#ffffff',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5, 1).setResolution(2).setDepth(3));
    this.shownTroops = this.sim.caps.map(() => -1);

    this.add.text(4, WORLD_H - 4, 'seed ' + this.map.seed, {
      fontFamily: 'monospace', fontSize: '10px', color: '#6b8299',
    }).setOrigin(0, 1).setDepth(3);

    this.input.on('pointerdown', (p) => this.onClick(p.worldX, p.worldY));
  }

  paintRegion(id) {
    const C = CONFIG, ctx = this.terrain.getContext(), cell = C.CELL, w = this.map.w;
    const cap = this.sim.caps[id];
    const fill = css(shade(ownerColor(cap.owner), C.COLORS.territoryShade));
    const seamCol = css(C.COLORS.seam);
    const cells = this.regionCells[id], seam = this.map.seam;
    ctx.fillStyle = fill;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      if (seam[i]) continue;
      ctx.fillRect((i % w) * cell, ((i / w) | 0) * cell, cell, cell);
    }
    ctx.fillStyle = seamCol;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      if (!seam[i]) continue;
      ctx.fillRect((i % w) * cell, ((i / w) | 0) * cell, cell, cell);
    }
  }

  pickCap(x, y) {
    const R = CONFIG.CAPITAL_RADIUS * 2.2;
    let best = null, bd = R * R;
    for (const cap of this.sim.caps) {
      const d = (cap.x - x) ** 2 + (cap.y - y) ** 2;
      if (d <= bd) { bd = d; best = cap; }
    }
    return best;
  }

  onClick(x, y) {
    if (this.sim.result) {
      if (this.time.now - this.endTime > 600) this.scene.start('Menu');
      return;
    }
    const hit = this.pickCap(x, y);
    if (this.selected === null) {
      if (hit && hit.owner === HUMAN) this.selected = hit.id;
      return;
    }
    // selected: another capital sends (migration if own, attack otherwise); same capital or empty cancels
    if (hit && hit.id !== this.selected) this.sim.send(this.selected, hit.id, HUMAN);
    this.selected = null;
  }

  update(time, delta) {
    const C = CONFIG, sim = this.sim;

    if (!sim.result) {
      this.acc += Math.min(delta, C.MAX_FRAME_MS) / 1000;
      while (this.acc >= C.SIM_DT) {
        sim.update(C.SIM_DT);
        this.acc -= C.SIM_DT;
        if (sim.result) break;
      }
    }

    if (sim.events.length) {
      for (const e of sim.events) if (e.type === 'capture') this.paintRegion(e.id);
      sim.events.length = 0;
      this.terrain.refresh();
    }

    if (this.selected !== null && sim.caps[this.selected].owner !== HUMAN) this.selected = null;

    this.draw();

    if (sim.result && !this.overlayShown) this.showOverlay(sim.result);
  }

  draw() {
    const C = CONFIG, sim = this.sim;

    // units, one fillStyle per owner
    const g = this.unitG;
    g.clear();
    const owners = 1 + C.N_ENEMIES;
    for (let o = 0; o < owners; o++) {
      g.fillStyle(ownerColor(o), 1);
      for (const u of sim.units) {
        if (u.owner === o) g.fillRect(u.x - 1.5, u.y - 1.5, 3, 3);
      }
    }

    // capitals
    const cg = this.capG;
    cg.clear();
    for (const cap of sim.caps) {
      cg.fillStyle(ownerColor(cap.owner), 1);
      cg.fillCircle(cap.x, cap.y, C.CAPITAL_RADIUS - 1);
      cg.lineStyle(2, 0x000000, 0.9);
      cg.strokeCircle(cap.x, cap.y, C.CAPITAL_RADIUS - 1);

      const t = Math.floor(cap.troops);
      if (t !== this.shownTroops[cap.id]) {
        this.shownTroops[cap.id] = t;
        this.capTexts[cap.id].setText(String(t));
      }
    }
    if (this.selected !== null) {
      const cap = sim.caps[this.selected];
      cg.lineStyle(2, 0xffffff, 1);
      cg.strokeCircle(cap.x, cap.y, C.CAPITAL_RADIUS + 5);
    }
  }

  showOverlay(result) {
    this.overlayShown = true;
    this.endTime = this.time.now;
    this.add.rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W, WORLD_H, 0x000000, 0.6).setDepth(10);
    this.add.text(WORLD_W / 2, WORLD_H / 2 - 10, result === 'win' ? 'YOU WIN!' : 'DEFEATED', {
      fontFamily: 'Arial', fontSize: '48px', fontStyle: 'bold',
      color: result === 'win' ? '#86efac' : '#fca5a5',
    }).setOrigin(0.5).setDepth(11);
    this.add.text(WORLD_W / 2, WORLD_H / 2 + 40, 'Click to return to menu', {
      fontFamily: 'Arial', fontSize: '16px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(11);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: WORLD_W,
  height: WORLD_H,
  backgroundColor: '#0d2238',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [MenuScene, GameScene],
});
