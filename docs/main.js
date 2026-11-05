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
function generatedPlayerColor(index) {
  const hue = (index * 137.508) % 360;
  const chroma = 0.72;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  let r = 0, g = 0, b = 0;
  if (hue < 60) { r = chroma; g = x; }
  else if (hue < 120) { r = x; g = chroma; }
  else if (hue < 180) { g = chroma; b = x; }
  else if (hue < 240) { g = x; b = chroma; }
  else if (hue < 300) { r = x; b = chroma; }
  else { r = chroma; b = x; }
  const m = 0.14;
  return (Math.round((r + m) * 255) << 16)
    | (Math.round((g + m) * 255) << 8)
    | Math.round((b + m) * 255);
}
function ownerColor(owner) {
  const P = CONFIG.COLORS.players;
  return owner < 0 ? CONFIG.COLORS.neutral : (P[owner] ?? generatedPlayerColor(owner));
}

function glslColor(hex) {
  const channel = (shift) => (((hex >> shift) & 255) / 255).toFixed(4);
  return `vec3(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function createSeaFragmentShader() {
  const { SEA_LAYER_COUNT: count, SEA_LAYERS: layers, SEA_COLORS: colors } = CONFIG;
  if (!Number.isInteger(count) || count < 0 || count > 8 || count > layers.length) {
    throw new Error('SEA_LAYER_COUNT must be between 0 and 8 and not exceed SEA_LAYERS.length');
  }
  if (!Array.isArray(colors) || colors.length < 1 || colors.length > 5
    || !colors.every((color) => Number.isInteger(color) && color >= 0 && color <= 0xffffff)) {
    throw new Error('SEA_COLORS must contain between 1 and 5 valid hex colors');
  }

  const layerCode = layers.slice(0, count).map((layer, index) => {
    if (!Number.isFinite(layer.scale) || layer.scale <= 0
      || !Array.isArray(layer.speed) || layer.speed.length !== 2
      || !layer.speed.every(Number.isFinite)) {
      throw new Error(`Invalid sea layer configuration at index ${index}`);
    }

    return `
      noiseSum += perlin(pos * ${layer.scale.toFixed(5)}
        + time * vec2(${layer.speed[0].toFixed(4)}, ${layer.speed[1].toFixed(4)}));
    `;
  }).join('\n');
  const noiseAverage = count > 0 ? `noiseSum / ${count.toFixed(1)}` : '0.0';
  const colorBands = colors.slice(1).map((color, index) => `
    if (seaNoise >= ${((index + 1) / colors.length).toFixed(4)}) {
      sea = ${glslColor(color)};
    }
  `).join('\n');

  return `
    precision highp float;
    uniform sampler2D uMainSampler;
    uniform float time;
    uniform vec2 resolution;
    varying vec2 outTexCoord;

    float permute(float x) {
      return mod(((x * 34.0) + 1.0) * x, 289.0);
    }

    float hash(vec2 p) {
      p = mod(p, 289.0);
      return permute(permute(p.x) + p.y) / 289.0;
    }

    vec2 gradient(vec2 p) {
      float h = floor(hash(p) * 8.0);
      if (h < 1.0) return vec2(1.0, 0.0);
      if (h < 2.0) return vec2(-1.0, 0.0);
      if (h < 3.0) return vec2(0.0, 1.0);
      if (h < 4.0) return vec2(0.0, -1.0);
      if (h < 5.0) return vec2(0.7071068, 0.7071068);
      if (h < 6.0) return vec2(-0.7071068, 0.7071068);
      if (h < 7.0) return vec2(0.7071068, -0.7071068);
      return vec2(-0.7071068, -0.7071068);
    }

    float perlin(vec2 p) {
      vec2 cell = floor(p);
      vec2 local = fract(p);
      vec2 fade = local * local * local * (local * (local * 6.0 - 15.0) + 10.0);
      float n00 = dot(gradient(cell), local);
      float n10 = dot(gradient(cell + vec2(1.0, 0.0)), local - vec2(1.0, 0.0));
      float n01 = dot(gradient(cell + vec2(0.0, 1.0)), local - vec2(0.0, 1.0));
      float n11 = dot(gradient(cell + vec2(1.0, 1.0)), local - vec2(1.0, 1.0));
      float value = mix(mix(n00, n10, fade.x), mix(n01, n11, fade.x), fade.y);
      return 0.2 + value * 1.0;
    }

    void main() {
      vec4 map = texture2D(uMainSampler, outTexCoord);
      vec2 texel = 1.0 / resolution;
      float landCoverage = 0.0;
      for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
          landCoverage += texture2D(
            uMainSampler,
            outTexCoord + texel * vec2(float(x), float(y)) * 1.5
          ).a;
        }
      }
      landCoverage /= 9.0;

      vec2 pos = outTexCoord * resolution;
      float noiseSum = 0.0;
      ${layerCode}
      float seaNoise = ${noiseAverage};
      vec3 sea = ${glslColor(colors[0])};
      ${colorBands}

      gl_FragColor = vec4(mix(sea, map.rgb, landCoverage), 1.0);
    }
  `;
}

class SeaPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
  constructor(game) {
    super({
      game,
      fragShader: createSeaFragmentShader(),
    });
  }

  onBind() {
    this.set1f('time', this.game.loop.time / 1000);
    this.set2f('resolution', WORLD_W, WORLD_H);
  }
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

    this.add.text(WORLD_W / 2, WORLD_H * 0.44, 'Your kingdom starting troops', {
      fontFamily: 'Arial', fontSize: '16px', color: '#ffffff',
    }).setOrigin(0.5);
    this.troopInput = this.add.dom(WORLD_W / 2, WORLD_H * 0.49).createFromHTML(
      `<input id="start-troops" type="number" min="${CONFIG.START_TROOPS_MIN}" `
      + `max="${CONFIG.START_TROOPS_MAX}" step="1" value="${CONFIG.START_TROOPS}" `
      + 'aria-label="Your kingdom starting troops" '
      + 'style="width:180px;box-sizing:border-box;padding:9px;text-align:center;'
      + 'font: bold 18px Arial;color:#102030;background:#ffffff;border:2px solid #60a5fa;'
      + 'border-radius:6px;">');
    const startGame = () => {
      const input = this.troopInput.getChildByID('start-troops');
      const parsed = Number(input.value);
      const startTroops = Number.isFinite(parsed)
        ? Math.max(CONFIG.START_TROOPS_MIN,
          Math.min(CONFIG.START_TROOPS_MAX, Math.floor(parsed)))
        : CONFIG.START_TROOPS;
      this.scene.start('Game', { startTroops });
    };

    const btn = this.add.rectangle(WORLD_W / 2, WORLD_H * 0.60, 200, 64, 0x3b82f6)
      .setStrokeStyle(3, 0xffffff).setInteractive({ useHandCursor: true });
    this.add.text(WORLD_W / 2, WORLD_H * 0.60, 'PLAY', {
      fontFamily: 'Arial', fontSize: '30px', fontStyle: 'bold', color: '#ffffff',
    }).setOrigin(0.5);
    btn.on('pointerover', () => btn.setFillStyle(0x60a5fa));
    btn.on('pointerout', () => btn.setFillStyle(0x3b82f6));
    btn.on('pointerdown', startGame);
    this.troopInput.getChildByID('start-troops').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') startGame();
    });
  }
}

class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  preload() {
    for (const key of STATUE_KEYS) this.load.image(key, 'assets/' + key + '.png');
  }

  create(data = {}) {
    const C = CONFIG;
    this.cameras.main.setBackgroundColor(C.COLORS.ocean);
    for (const key of STATUE_KEYS) {
      for (const source of this.textures.get(key).source) {
        source.setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }

    const seed = (Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0;
    this.map = generateMapWithRetry(seed);
    this.sim = new Sim(this.map, this.map.seed, data.startTroops);
    this.selected = null;
    this.hoveredCap = null;
    this.pointerWorld = { x: WORLD_W / 2, y: WORLD_H / 2 };
    this.acc = 0;
    this.endTime = 0;
    this.overlayShown = false;
    this.debugTapCount = 0;
    this.debugTapStartedAt = 0;
    this.debugTapX = 0;
    this.debugTapY = 0;
    this.debugPanelOpen = false;
    this.debugObjects = [];
    this.debugGraphs = [];
    this.debugMetricHistory = [];
    this.debugLastMetricTime = -CONFIG.DEBUG_METRIC_INTERVAL;

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
    ctx.clearRect(0, 0, WORLD_W, WORLD_H);
    for (const cap of this.sim.caps) this.paintRegion(cap.id);
    this.terrain.refresh();
    const terrainImage = this.add.image(0, 0, 'terrain').setOrigin(0, 0).setDepth(0);
    if (this.game.renderer.type === Phaser.WEBGL) terrainImage.setPipeline('SeaPipeline');

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
    this.lightningFlashUntil = this.sim.caps.map(() => 0);
    this.shareBar = this.add.graphics().setDepth(4);
    this.shareLabels = [
      this.add.text(2, 0, 'POP', {
        fontFamily: 'monospace', fontSize: '7px', color: '#ffffff',
        stroke: '#000000', strokeThickness: 2,
      }).setDepth(5).setScrollFactor(0),
      this.add.text(2, 8, 'GROW', {
        fontFamily: 'monospace', fontSize: '7px', color: '#ffffff',
        stroke: '#000000', strokeThickness: 2,
      }).setDepth(5).setScrollFactor(0),
    ];
    this._recordDebugMetrics();

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
      if (this.debugPanelOpen) {
        this._trackDebugTap(p.x, p.y);
        return;
      }
      if (this._trackDebugTap(p.x, p.y)) return;
      this.onClick(p.worldX, p.worldY);
    });
  }

  _trackDebugTap(x, y) {
    const now = this.time.now;
    const maxInterval = 700;
    const maxDistance = 24;
    if (this.debugTapCount === 0 || now - this.debugTapStartedAt > maxInterval
      || Math.hypot(x - this.debugTapX, y - this.debugTapY) > maxDistance) {
      this.debugTapCount = 0;
      this.debugTapStartedAt = now;
      this.debugTapX = x;
      this.debugTapY = y;
    }
    this.debugTapCount++;
    if (this.debugTapCount < 3) return false;

    this.debugTapCount = 0;
    this._toggleDebugPanel();
    return true;
  }

  _toggleDebugPanel() {
    for (const object of this.debugObjects) object.destroy();
    this.debugObjects.length = 0;
    this.debugGraphs.length = 0;
    if (this.debugPanelOpen) {
      this.debugPanelOpen = false;
      return;
    }

    this.debugPanelOpen = true;
    const owners = CONFIG.N_ENEMIES;
    this.debugObjects.push(this.add.rectangle(0, 0, WORLD_W, WORLD_H, 0x050a10, 0.96)
      .setOrigin(0, 0).setDepth(10).setScrollFactor(0));
    this.debugObjects.push(this.add.text(WORLD_W / 2, 24,
      'AI DEBUG  |  triple-tap same spot to close', {
      fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold',
      color: '#ffffff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 0).setDepth(11).setScrollFactor(0));

    const graphX = 44, graphWidth = WORLD_W - 56;
    const graphHeight = Math.min(104, Math.max(56, WORLD_H * 0.13));
    const chartRows = [
      { title: 'UNIT SHARE', key: 'units', titleY: 48, graphY: 64 },
      { title: 'SPAWN-POWER SHARE', key: 'growth', titleY: 184, graphY: 200 },
    ];
    for (const chart of chartRows) {
      const historySeconds = CONFIG.DEBUG_METRIC_INTERVAL * CONFIG.DEBUG_METRIC_HISTORY;
      this.debugObjects.push(this.add.text(14, chart.titleY,
        `${chart.title}  (up to ${historySeconds}s history)`, {
        fontFamily: 'monospace', fontSize: '9px', fontStyle: 'bold',
        color: '#d1d5db',
      }).setDepth(11).setScrollFactor(0));
      const legendStart = Math.max(220, WORLD_W - (1 + CONFIG.N_ENEMIES) * 35 - 8);
      for (let owner = 0; owner <= CONFIG.N_ENEMIES; owner++) {
        const legendX = legendStart + owner * 35;
        this.debugObjects.push(this.add.rectangle(legendX, chart.titleY + 4, 5, 5,
          ownerColor(owner)).setDepth(11).setScrollFactor(0));
        this.debugObjects.push(this.add.text(legendX + 5, chart.titleY,
          owner === HUMAN ? 'YOU' : `AI${owner}`, {
            fontFamily: 'monospace', fontSize: '7px', color: '#d1d5db',
          }).setDepth(11).setScrollFactor(0));
      }
      for (const tick of [
        { label: '100%', y: chart.graphY - 2 },
        { label: '50%', y: chart.graphY + graphHeight / 2 - 3 },
        { label: '0%', y: chart.graphY + graphHeight - 5 },
      ]) {
        this.debugObjects.push(this.add.text(12, tick.y, tick.label, {
          fontFamily: 'monospace', fontSize: '7px', color: '#94a3b8',
        }).setDepth(11).setScrollFactor(0));
      }
      const graphics = this.add.graphics().setDepth(11).setScrollFactor(0);
      this.debugObjects.push(graphics);
      this.debugObjects.push(this.add.text(graphX, chart.graphY + graphHeight + 1, 'older', {
        fontFamily: 'monospace', fontSize: '7px', color: '#94a3b8',
      }).setDepth(11).setScrollFactor(0));
      this.debugObjects.push(this.add.text(graphX + graphWidth, chart.graphY + graphHeight + 1, 'now', {
        fontFamily: 'monospace', fontSize: '7px', color: '#94a3b8',
      }).setOrigin(1, 0).setDepth(11).setScrollFactor(0));
      this.debugGraphs.push({
        graphics, key: chart.key, x: graphX, y: chart.graphY,
        width: graphWidth, height: graphHeight,
      });
    }

    const rowsTop = 216 + graphHeight;
    const rowHeight = (WORLD_H - rowsTop - 8) / Math.max(owners, 1);
    for (let owner = 1; owner <= owners; owner++) {
      const targetStrength = this.sim.aiTargetStrength[owner];
      const targetStyle = targetStrength < -0.25 ? 'weakest'
        : targetStrength > 0.25 ? 'strongest' : 'any';
      const color = ownerColor(owner);
      const colorHex = '#' + color.toString(16).padStart(6, '0');
      const percent = (value) => Math.round(value * 100);
      const intelligence = percent(this.sim.aiIntelligence[owner]);
      const intelligenceStyle = intelligence < 35 ? 'random'
        : intelligence < 75 ? 'mixed' : 'strategic';
      const neutrality = percent(this.sim.aiNeutralPreference[owner]);
      const aggression = percent(this.sim.aiAggression[owner]);
      const expansion = percent(this.sim.aiExpansionFocus[owner]);
      const distanceBias = percent(this.sim.aiDistanceBias[owner]);
      const randomness = percent(this.sim.aiDecisionRandomness[owner]);
      const ownedCaps = this.sim.caps
        .filter((cap) => cap.owner === owner)
        .map((cap) => `${cap.id}:${cap.minTroops}`).join(', ') || 'none';
      const description = `${intelligenceStyle} intelligence (${intelligence}%); `
        + `each owned capital requires its own reserve floor (${ownedCaps}); moves every `
        + `${this.sim.aiMoveIntervals[owner].toFixed(1)}s ±${CONFIG.AI_MOVE_INTERVAL_JITTER.toFixed(1)}s. `
        + `Aggression ${aggression}% favors enemy attacks; neutral preference ${neutrality}% `
        + `and expansion focus ${expansion}% increase neutral expansion when capitals remain. `
        + `Targets the ${targetStyle} kingdom; nearby-target bias ${distanceBias}%; `
        + `decision randomness ${randomness}%. Starts with ${CONFIG.AI_START_TROOPS} troops.`;
      const row = this.add.text(20, rowsTop + (owner - 1) * rowHeight,
        `AI ${owner}  ${colorHex}\n${description}`, {
          fontFamily: 'monospace', fontSize: '9px', lineSpacing: 3,
          wordWrap: { width: WORLD_W - 40 },
          color: css(color), stroke: '#000000', strokeThickness: 2,
        }).setDepth(11).setScrollFactor(0);
      this.debugObjects.push(row);
    }
    this._drawDebugGraphs();
  }

  _getBarMetrics() {
    const owners = 1 + CONFIG.N_ENEMIES;
    const units = new Float64Array(owners);
    const growth = new Float64Array(owners);
    for (const cap of this.sim.caps) {
      if (cap.owner < 0) continue;
      units[cap.owner] += cap.troops;
      growth[cap.owner] += Math.min(
        cap.area * CONFIG.GROWTH_PER_AREA, CONFIG.MAX_TROOP_GROWTH_PER_SECOND);
    }
    for (const unit of this.sim.units) {
      if (!unit.dead && unit.owner >= 0) units[unit.owner]++;
    }
    return { units, growth };
  }

  _recordDebugMetrics() {
    const { units, growth } = this._getBarMetrics();
    const fractions = (values) => {
      const total = values.reduce((sum, value) => sum + value, 0);
      return Array.from(values, (value) => total > 0 ? value / total : 0);
    };
    this.debugMetricHistory.push({
      time: this.sim.time,
      units: fractions(units),
      growth: fractions(growth),
    });
    if (this.debugMetricHistory.length > CONFIG.DEBUG_METRIC_HISTORY) {
      this.debugMetricHistory.shift();
    }
    this.debugLastMetricTime = this.sim.time;
  }

  _drawDebugGraphs() {
    const history = this.debugMetricHistory;
    for (const chart of this.debugGraphs) {
      const g = chart.graphics;
      const { x, y, width, height } = chart;
      g.clear();
      g.lineStyle(1, 0x64748b, 0.45);
      for (let step = 0; step <= 4; step++) {
        const gridY = y + height * step / 4;
        g.lineBetween(x, gridY, x + width, gridY);
      }
      for (let step = 0; step <= 4; step++) {
        const gridX = x + width * step / 4;
        g.lineBetween(gridX, y, gridX, y + height);
      }

      const ownerCount = 1 + CONFIG.N_ENEMIES;
      for (let owner = 0; owner < ownerCount; owner++) {
        const upper = [];
        const lower = [];
        for (let i = 0; i < history.length; i++) {
          const sample = history[i][chart.key];
          const pointX = x + 2*i;
          const before = sample.slice(0, owner).reduce((sum, value) => sum + value, 0);
          const through = before + (sample[owner] || 0);
          lower.push({ x: pointX, y: y + height * (1 - before) });
          upper.push({ x: pointX, y: y + height * (1 - through) });
        }
        if (!upper.length) continue;

        g.fillStyle(ownerColor(owner), 0.9);
        g.beginPath();
        g.moveTo(upper[0].x, upper[0].y);
        for (let i = 1; i < upper.length; i++) g.lineTo(upper[i].x, upper[i].y);
        for (let i = lower.length - 1; i >= 0; i--) {
          g.lineTo(lower[i].x, lower[i].y);
        }
        g.closePath();
        g.fillPath();
      }
    }
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
    if (sim.time - this.debugLastMetricTime >= C.DEBUG_METRIC_INTERVAL) {
      this._recordDebugMetrics();
      if (this.debugPanelOpen) this._drawDebugGraphs();
    }

    let terrainChanged = false;
    if (sim.events.length) {
      for (const e of sim.events) {
        if (e.type === 'lightning') {
          this.lightningFlashUntil[e.id] = this.time.now + C.LIGHTNING_FLASH_DURATION * 1000;
        } else if (e.type === 'capture') {
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
      let flashRadius = radius;
      if (cap.owner < 0) {
        cg.fillStyle(ownerColor(cap.owner), 1);
        cg.fillCircle(cap.x, cap.y, radius);
        cg.lineStyle(2, 0x000000, 0.9);
        cg.strokeCircle(cap.x, cap.y, radius);
      } else {
        const imageSize = this.capitalImageSizes[cap.id]
          * (radius / (C.CAPITAL_RADIUS - 1));
        flashRadius = imageSize * 0.55;
        this.capImages[cap.id]
          .setTexture(this.playerStatues[cap.owner])
          .setVisible(true)
          .setDisplaySize(imageSize, imageSize);
      }
      const flashRemaining = this.lightningFlashUntil[cap.id] - now;
      if (flashRemaining > 0) {
        const alpha = Math.min(1, flashRemaining / (C.LIGHTNING_FLASH_DURATION * 1000));
        cg.fillStyle(0xffffff, alpha);
        cg.fillCircle(cap.x, cap.y, flashRadius);
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

    const { units: totals, growth } = this._getBarMetrics();
    let total = 0;
    for (const count of totals) total += count;
    const bar = this.shareBar;
    const barStart = 32;
    const barWidth = WORLD_W - barStart;
    bar.clear();
    bar.fillStyle(0x050a10, 0.9);
    bar.fillRect(barStart, 0, barWidth, 8);
    if (total > 0) {
      let x = barStart;
      for (let owner = 0; owner < owners; owner++) {
        const width = barWidth * totals[owner] / total;
        bar.fillStyle(ownerColor(owner), 1);
        bar.fillRect(x, 0, width, 8);
        x += width;
      }
    }

    let totalGrowth = 0;
    for (const rate of growth) totalGrowth += rate;
    bar.fillStyle(0x050a10, 0.9);
    bar.fillRect(barStart, 8, barWidth, 8);
    if (totalGrowth > 0) {
      let x = barStart;
      for (let owner = 0; owner < owners; owner++) {
        const width = barWidth * growth[owner] / totalGrowth;
        bar.fillStyle(ownerColor(owner), 1);
        bar.fillRect(x, 8, width, 8);
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
  pipeline: {
    SeaPipeline,
  },
  dom: {
    createContainer: true,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [MenuScene, GameScene],
});
