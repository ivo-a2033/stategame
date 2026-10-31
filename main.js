// Phaser layer: reads Sim state and draws it. No game logic here.

const WORLD_W = CONFIG.GRID_W * CONFIG.CELL;
const WORLD_H = CONFIG.GRID_H * CONFIG.CELL;
const STATUE_KEYS = [
  'statue_angel', 'statue_archer', 'statue_cat', 'statue_centaur',
  'statue_demonic_bust', 'statue_dragon', 'statue_dwarf',
  'statue_elephant', 'statue_hydra', 'statue_imp',
];

function fadeFromWhite(hex, strength) {
  const r = Math.round(255 + (((hex >> 16) & 255) - 255) * strength);
  const g = Math.round(255 + (((hex >> 8) & 255) - 255) * strength);
  const b = Math.round(255 + ((hex & 255) - 255) * strength);
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

  preload() {
    for (const key of STATUE_KEYS) this.load.image(key, 'assets/' + key + '.png');
  }

  create() {
    const C = CONFIG;
    this.cameras.main.setBackgroundColor(C.COLORS.ocean);
    for (const key of STATUE_KEYS) {
      for (const source of this.textures.get(key).source) {
        source.setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }

    const seed = (Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0;
    this.map = generateMapWithRetry(seed);
    this.sim = new Sim(this.map, this.map.seed);
    this.selected = null;
    this.hoveredCap = null;
    this.pointerWorld = { x: WORLD_W / 2, y: WORLD_H / 2 };
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
    this.capG = this.add.graphics().setDepth(2.5);
    const statueKeys = Phaser.Utils.Array.Shuffle(STATUE_KEYS.slice());
    this.playerStatues = Array.from({ length: 1 + C.N_ENEMIES }, (_, i) =>
      statueKeys[i % statueKeys.length]);
    const areas = this.sim.caps.map((cap) => cap.area);
    const minArea = Math.min(...areas), maxArea = Math.max(...areas);
    this.capitalImageSizes = this.sim.caps.map((cap) => {
      const t = maxArea === minArea ? 0.5 : (cap.area - minArea) / (maxArea - minArea);
      const scale = C.CAPITAL_IMAGE_MIN_SCALE
        + t * (C.CAPITAL_IMAGE_MAX_SCALE - C.CAPITAL_IMAGE_MIN_SCALE);
      return C.CAPITAL_IMAGE_SIZE * scale;
    });
    this.capImages = this.sim.caps.map((cap) =>
      this.add.image(cap.x, cap.y, this.playerStatues[0])
        .setDisplaySize(this.capitalImageSizes[cap.id], this.capitalImageSizes[cap.id])
        .setDepth(2).setVisible(false));

    this.capTexts = this.sim.caps.map((cap) =>
      this.add.text(cap.x, cap.y - this.capitalImageSizes[cap.id] / 2 - 1, '', {
        fontFamily: 'Arial', fontSize: '12px', fontStyle: 'bold', color: '#ffffff',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5, 1).setResolution(2).setDepth(3));
    this.shownTroops = this.sim.caps.map(() => -1);
    this.shownColors = this.sim.caps.map((cap) => Math.min(Math.floor(cap.troops), 100));
    this.capPulseUntil = this.sim.caps.map(() => 0);
    this.shareBar = this.add.graphics().setDepth(4);

    this.add.text(4, WORLD_H - 4, 'seed ' + this.map.seed, {
      fontFamily: 'monospace', fontSize: '10px', color: '#6b8299',
    }).setOrigin(0, 1).setDepth(3);

    this.input.on('pointermove', (p) => {
      this.pointerWorld.x = p.worldX;
      this.pointerWorld.y = p.worldY;
      this.hoveredCap = this.pickCap(p.worldX, p.worldY);
    });
    this.input.on('pointerdown', (p) => {
      this.pointerWorld.x = p.worldX;
      this.pointerWorld.y = p.worldY;
      this.onClick(p.worldX, p.worldY);
    });
  }

  paintRegion(id) {
    const C = CONFIG, ctx = this.terrain.getContext(), cell = C.CELL, w = this.map.w;
    const cap = this.sim.caps[id];
    const fill = css(fadeFromWhite(ownerColor(cap.owner), Math.max(0, Math.min(cap.troops / 200 + .5, 1))));
    const border = css(C.COLORS.seam);
    const cells = this.regionCells[id], regionId = this.map.regionId;
    ctx.fillStyle = fill;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      const x = (i % w) * cell, y = ((i / w) | 0) * cell;
      ctx.fillRect(x, y, cell, cell);

      ctx.fillStyle = border;
      if (i >= w && regionId[i - w] >= 0 && regionId[i - w] !== id) ctx.fillRect(x, y, cell, 1);
      if (i % w < w - 1 && regionId[i + 1] >= 0 && regionId[i + 1] !== id) ctx.fillRect(x + cell - 1, y, 1, cell);
      if (i < regionId.length - w && regionId[i + w] >= 0 && regionId[i + w] !== id) ctx.fillRect(x, y + cell - 1, cell, 1);
      if (i % w > 0 && regionId[i - 1] >= 0 && regionId[i - 1] !== id) ctx.fillRect(x, y, 1, cell);
      ctx.fillStyle = fill;
    }
  }

  pickCap(x, y) {
    const R = Math.max(CONFIG.HOVER_RADIUS, CONFIG.CAPITAL_RADIUS * 2.2);
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
    const hit = this.hoveredCap = this.pickCap(x, y);
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

    let terrainChanged = false;
    if (sim.events.length) {
      for (const e of sim.events) {
        if (e.type === 'capture') {
          this.paintRegion(e.id);
          const cap = sim.caps[e.id];
          this.capImages[e.id].setTexture(this.playerStatues[cap.owner]);
          this.capImages[e.id].setVisible(true);
          terrainChanged = true;
        } else if (e.type === 'troop-change') {
          this.capPulseUntil[e.id] = this.time.now + CONFIG.CAPITAL_PULSE_DURATION * 1000;
        }
      }
      sim.events.length = 0;
    }
    for (const cap of sim.caps) {
      const colorLevel = Math.max(0, Math.min(Math.floor(cap.troops), 100));
      if (colorLevel !== this.shownColors[cap.id]) {
        this.shownColors[cap.id] = colorLevel;
        this.paintRegion(cap.id);
        terrainChanged = true;
      }
    }
    if (terrainChanged) this.terrain.refresh();

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
        if (u.owner === o) {
          g.fillStyle(0x000000, 1);
          g.fillRect(u.x - 4, u.y - 4, 8, 8);
          g.fillStyle(ownerColor(o), 1);
          g.fillRect(u.x - 3, u.y - 3, 6, 6);
        }
      }
    }

    // capitals
    const cg = this.capG;
    cg.clear();
    const now = this.time.now;
    for (const cap of sim.caps) {
      const pulseProgress = Math.max(0, Math.min(1,
        1 - (this.capPulseUntil[cap.id] - now) / (C.CAPITAL_PULSE_DURATION * 1000)));
      const pulse = Math.sin(pulseProgress * Math.PI) * C.CAPITAL_PULSE_AMOUNT;
      const radius = C.CAPITAL_RADIUS - 1 + pulse;
      if (cap.owner < 0) {
        cg.fillStyle(ownerColor(cap.owner), 1);
        cg.fillCircle(cap.x, cap.y, radius);
        cg.lineStyle(2, 0x000000, 0.9);
        cg.strokeCircle(cap.x, cap.y, radius);
      } else {
        const imageSize = this.capitalImageSizes[cap.id]
          * (radius / (C.CAPITAL_RADIUS - 1));
        this.capImages[cap.id]
          .setTexture(this.playerStatues[cap.owner])
          .setVisible(true)
          .setDisplaySize(imageSize, imageSize);
      }

      const t = Math.floor(cap.troops);
      if (t !== this.shownTroops[cap.id]) {
        this.shownTroops[cap.id] = t;
        this.capTexts[cap.id].setText(String(t));
      }
    }
    if (this.selected !== null) {
      const cap = sim.caps[this.selected];
      const radius = C.CAPITAL_RADIUS + 5
        + Math.sin(now / 1000 * C.HOVER_PULSE_SPEED) * C.HOVER_PULSE_AMOUNT;
      const segments = 32;
      const step = Math.PI * 2 / segments;
      for (let i = 0; i < segments; i++) {
        const a0 = i * step, a1 = (i + 1) * step;
        cg.lineStyle(3, i % 2 ? 0x000000 : 0xffffff, 1);
        cg.lineBetween(cap.x + Math.cos(a0) * radius, cap.y + Math.sin(a0) * radius,
          cap.x + Math.cos(a1) * radius, cap.y + Math.sin(a1) * radius);
      }
    }
    if (this.hoveredCap && this.hoveredCap.id !== this.selected) {
      const cap = this.hoveredCap;
      const radius = C.CAPITAL_RADIUS + 5
        + Math.sin(now / 1000 * C.HOVER_PULSE_SPEED) * C.HOVER_PULSE_AMOUNT;
      cg.lineStyle(2, 0xffffff, 1);
      cg.strokeCircle(cap.x, cap.y, radius);
    }
    if (this.selected !== null) {
      const source = sim.caps[this.selected];
      const dx = this.pointerWorld.x - source.x, dy = this.pointerWorld.y - source.y;
      const length = Math.hypot(dx, dy);
      if (length > 0) {
        const ux = dx / length, uy = dy / length;
        const head = 9;
        cg.lineStyle(4, 0x000000, 0.75);
        cg.lineBetween(source.x, source.y, this.pointerWorld.x, this.pointerWorld.y);
        cg.lineBetween(this.pointerWorld.x, this.pointerWorld.y,
          this.pointerWorld.x - ux * head - uy * head * 0.6,
          this.pointerWorld.y - uy * head + ux * head * 0.6);
        cg.lineBetween(this.pointerWorld.x, this.pointerWorld.y,
          this.pointerWorld.x - ux * head + uy * head * 0.6,
          this.pointerWorld.y - uy * head - ux * head * 0.6);
        cg.lineStyle(2, 0xffffff, 1);
        cg.lineBetween(source.x, source.y, this.pointerWorld.x, this.pointerWorld.y);
        cg.lineBetween(this.pointerWorld.x, this.pointerWorld.y,
          this.pointerWorld.x - ux * head - uy * head * 0.6,
          this.pointerWorld.y - uy * head + ux * head * 0.6);
        cg.lineBetween(this.pointerWorld.x, this.pointerWorld.y,
          this.pointerWorld.x - ux * head + uy * head * 0.6,
          this.pointerWorld.y - uy * head - ux * head * 0.6);
      }
    }

    const totals = new Float64Array(owners);
    for (const cap of sim.caps) if (cap.owner >= 0) totals[cap.owner] += cap.troops;
    for (const unit of sim.units) if (!unit.dead && unit.owner >= 0) totals[unit.owner]++;
    let total = 0;
    for (const count of totals) total += count;
    const bar = this.shareBar;
    bar.clear();
    bar.fillStyle(0x050a10, 0.9);
    bar.fillRect(0, 0, WORLD_W, 8);
    if (total > 0) {
      let x = 0;
      for (let owner = 0; owner < owners; owner++) {
        const width = WORLD_W * totals[owner] / total;
        bar.fillStyle(ownerColor(owner), 1);
        bar.fillRect(x, 0, width, 8);
        x += width;
      }
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
