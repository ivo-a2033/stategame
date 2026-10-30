// Pure game state. No Phaser, no DOM. Positions are in world pixels.

const HUMAN = 0;
const NEUTRAL = -1;

class Sim {
  constructor(map, seed) {
    const C = CONFIG;
    this.map = map;
    this.rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    this.time = 0;
    this.aiTimer = 0;
    this.result = null;        // null | 'win' | 'lose'
    this.events = [];          // {type:'capture', id} drained by the renderer
    this.units = [];
    this.caps = map.capitals.map((c) => ({
      id: c.id,
      x: (c.cx + 0.5) * C.CELL,
      y: (c.cy + 0.5) * C.CELL,
      area: c.area,
      owner: NEUTRAL,
      troops: 0,
      orders: [],              // FIFO of {target, remaining}
      emitAcc: 0,
    }));

    // spatial hash
    this.cellSize = Math.max(C.SEP_RADIUS, C.CLASH_RADIUS);
    this.cols = Math.ceil((C.GRID_W * C.CELL) / this.cellSize) + 1;
    this.rows = Math.ceil((C.GRID_H * C.CELL) / this.cellSize) + 1;
    this.head = new Int32Array(this.cols * this.rows);
    this.next = new Int32Array(1024);

    this._setupMatch();
  }

  _setupMatch() {
    const C = CONFIG, caps = this.caps, rng = this.rng;
    const players = 1 + C.N_ENEMIES;
    const dist = (a, b) => Math.hypot(caps[a].x - caps[b].x, caps[a].y - caps[b].y);

    // farthest-point sampling
    const first = Math.floor(rng() * caps.length);
    const chosen = [first];
    const mind = caps.map((_, i) => dist(i, first));
    while (chosen.length < players) {
      let best = -1, bd = -1;
      for (let i = 0; i < caps.length; i++) {
        if (!chosen.includes(i) && mind[i] > bd) { bd = mind[i]; best = i; }
      }
      chosen.push(best);
      for (let i = 0; i < caps.length; i++) mind[i] = Math.min(mind[i], dist(i, best));
    }

    const [lo, hi] = C.NEUTRAL_TROOPS;
    for (const cap of caps) {
      cap.owner = NEUTRAL;
      cap.troops = lo + Math.floor(rng() * (hi - lo + 1));
    }
    chosen.forEach((id, p) => { caps[id].owner = p; caps[id].troops = C.START_TROOPS; });
  }

  // Queue a send order. Amount is a snapshot taken now.
  send(fromId, toId, owner) {
    const src = this.caps[fromId], dst = this.caps[toId];
    if (!src || !dst || fromId === toId || src.owner !== owner || this.result) return false;
    const amount = Math.floor(src.troops * CONFIG.SEND_FRACTION);
    if (amount < 1) return false;
    src.orders.push({ target: toId, remaining: amount });
    return true;
  }

  countUnits(owner) {
    let n = 0;
    for (const u of this.units) if (!u.dead && u.owner === owner) n++;
    return n;
  }

  update(dt) {
    if (this.result) return;
    const C = CONFIG;
    this.time += dt;

    for (const cap of this.caps) {
      if (cap.owner >= 0) cap.troops += cap.area * C.GROWTH_PER_AREA * dt;
    }
    this._ai(dt);
    this._emit(dt);
    this._move(dt);
    this._interact(dt);
    this._arrive();
    this._checkEnd();
  }

  // Stub AI: every AI_INTERVAL s each idle AI capital with enough troops sends to a random capital.
  _ai(dt) {
    const C = CONFIG;
    this.aiTimer += dt;
    if (this.aiTimer < C.AI_INTERVAL) return;
    this.aiTimer -= C.AI_INTERVAL;
    for (const cap of this.caps) {
      if (cap.owner < 1 || cap.troops < C.AI_MIN_TROOPS || cap.orders.length) continue;
      const target = this._aiPickTarget(cap);
      if (target >= 0) this.send(cap.id, target, cap.owner);
    }
  }

  _aiPickTarget(cap) {
    const n = this.caps.length;
    if (n < 2) return -1;
    let t = Math.floor(this.rng() * (n - 1));
    if (t >= cap.id) t++;
    return t;
  }

  _emit(dt) {
    const C = CONFIG;
    for (const cap of this.caps) {
      if (!cap.orders.length) { cap.emitAcc = 0; continue; }
      cap.emitAcc += C.FLOW * dt;
      while (cap.emitAcc >= 1 && cap.orders.length) {
        if (cap.troops < 1) { cap.emitAcc = Math.min(cap.emitAcc, 1); break; }
        const order = cap.orders[0];
        const j = C.UNIT_JITTER, rng = this.rng;
        this.units.push({
          x: cap.x + (rng() * 2 - 1) * j,
          y: cap.y + (rng() * 2 - 1) * j,
          vx: 0, vy: 0,
          owner: cap.owner,
          target: order.target,
          dead: false,
          px: 0, py: 0,
        });
        cap.troops -= 1;
        order.remaining -= 1;
        cap.emitAcc -= 1;
        if (order.remaining <= 0) cap.orders.shift();
      }
    }
  }

  _move(dt) {
    const speed = CONFIG.UNIT_SPEED, caps = this.caps;
    for (const u of this.units) {
      const t = caps[u.target];
      const dx = t.x - u.x, dy = t.y - u.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) { u.vx = (dx / d) * speed; u.vy = (dy / d) * speed; }
      u.x += u.vx * dt;
      u.y += u.vy * dt;
      u.px = 0; u.py = 0;
    }
  }

  // Soft push between same-owner units, one-for-one clash between enemies.
  _interact(dt) {
    const C = CONFIG, units = this.units, n = units.length;
    if (!n) return;
    if (this.next.length < n) this.next = new Int32Array(Math.max(n, this.next.length * 2));
    const head = this.head, next = this.next, cs = this.cellSize, cols = this.cols, rows = this.rows;
    head.fill(-1);

    if (!this.cellIdx || this.cellIdx.length < n) this.cellIdx = new Int32Array(next.length);
    const cellIdx = this.cellIdx;
    for (let i = 0; i < n; i++) {
      const u = units[i];
      let cx = (u.x / cs) | 0, cy = (u.y / cs) | 0;
      if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
      if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;
      const c = cy * cols + cx;
      cellIdx[i] = c;
      next[i] = head[c];
      head[c] = i;
    }

    const sep2 = C.SEP_RADIUS * C.SEP_RADIUS;
    const clash2 = C.CLASH_RADIUS * C.CLASH_RADIUS;
    const rng = this.rng;

    for (let i = 0; i < n; i++) {
      const u = units[i];
      if (u.dead) continue;
      const ci = cellIdx[i];
      const cy = (ci / cols) | 0, cx = ci - cy * cols;
      for (let oy = -1; oy <= 1 && !u.dead; oy++) {
        const ny = cy + oy;
        if (ny < 0 || ny >= rows) continue;
        for (let ox = -1; ox <= 1 && !u.dead; ox++) {
          const nx = cx + ox;
          if (nx < 0 || nx >= cols) continue;
          for (let j = head[ny * cols + nx]; j !== -1 && !u.dead; j = next[j]) {
            if (j <= i) continue; // each pair once
            const v = units[j];
            if (v.dead) continue;
            const dx = v.x - u.x, dy = v.y - u.y;
            const d2 = dx * dx + dy * dy;
            if (u.owner === v.owner) {
              if (d2 < sep2) {
                let d = Math.sqrt(d2), nxv, nyv;
                if (d < 1e-4) { const a = rng() * Math.PI * 2; nxv = Math.cos(a); nyv = Math.sin(a); d = 0; }
                else { nxv = dx / d; nyv = dy / d; }
                const overlap = C.SEP_RADIUS - d;
                const push = Math.min(C.SEP_MAX, C.SEP_MAX * overlap / C.SEP_RADIUS);
                u.px -= nxv * push; u.py -= nyv * push;
                v.px += nxv * push; v.py += nyv * push;
              }
            } else if (d2 < clash2) {
              u.dead = true; v.dead = true; // one pair, one for one
            }
          }
        }
      }
    }

    const max = C.SEP_MAX;
    for (const u of units) {
      if (u.dead) continue;
      const m = Math.hypot(u.px, u.py);
      const k = m > max ? max / m : 1;
      u.x += u.px * k * dt;
      u.y += u.py * k * dt;
    }
  }

  // Arrival is resolved against the target's owner at this moment.
  _arrive() {
    const R2 = CONFIG.CAPITAL_RADIUS * CONFIG.CAPITAL_RADIUS;
    const units = this.units, caps = this.caps;
    let k = 0;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.dead) continue;
      const t = caps[u.target];
      const dx = t.x - u.x, dy = t.y - u.y;
      if (dx * dx + dy * dy <= R2) {
        if (t.owner === u.owner) t.troops += 1;
        else if (t.troops >= 1) t.troops -= 1;
        else this._capture(t, u.owner);
        continue; // unit consumed
      }
      units[k++] = u;
    }
    units.length = k;
  }

  _capture(cap, owner) {
    cap.owner = owner;
    cap.troops = 1;
    cap.orders.length = 0;   // source changed hands: cancel its orders
    cap.emitAcc = 0;
    this.events.push({ type: 'capture', id: cap.id });
  }

  _checkEnd() {
    let human = 0;
    for (const c of this.caps) if (c.owner === HUMAN) human++;
    if (human === this.caps.length) { this.result = 'win'; return; }
    if (human === 0 && this.countUnits(HUMAN) === 0) this.result = 'lose';
  }
}
