// Pure map generation. No Phaser, no DOM.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a, b, t) { return a + (b - a) * t; }

// Classic 2D Perlin noise with a seeded permutation table.
function makePerlin(seed) {
  const rng = mulberry32(seed);
  const perm = [];
  for (let i = 0; i < 256; i++) perm.push(i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y) => {
    switch (h & 7) {
      case 0: return x + y;
      case 1: return x - y;
      case 2: return -x + y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  };

  return function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const X = xi & 255, Y = yi & 255;
    const xf = x - xi, yf = y - yi;
    const u = fade(xf), v = fade(yf);
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  };
}

// fBm field over the grid, min/max normalized to 0..1.
function makeField(seed, w, h, scale, octaves) {
  const C = CONFIG;
  const rng = mulberry32(seed);
  const noise = makePerlin((rng() * 4294967296) >>> 0);
  const ox = rng() * 1000, oy = rng() * 1000;
  const f = new Float32Array(w * h);
  let min = Infinity, max = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let amp = 1, freq = scale, sum = 0, norm = 0;
      for (let o = 0; o < octaves; o++) {
        sum += amp * noise(x * freq + ox, y * freq + oy);
        norm += amp;
        amp *= C.TERRAIN_GAIN;
        freq *= C.TERRAIN_LACUNARITY;
      }
      const v = sum / norm;
      f[y * w + x] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const span = max - min || 1;
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - min) / span;
  return f;
}

// One function decides what a seam is. Swap SEAM_MODE in CONFIG to compare looks.
function computeSeams(field, w, h) {
  const C = CONFIG;
  const out = new Uint8Array(w * h);
  if (C.SEAM_MODE === 'blob') {
    for (let i = 0; i < out.length; i++) out[i] = field[i] > C.SEAM_T ? 1 : 0;
    return out;
  }
  // 'line': |n - 0.5| < SEAM_W. A band that thin can have gaps where the noise is steep,
  // so also mark any cell whose right/down neighbour is on the other side of 0.5.
  // That makes the line unbreakable for 4-neighbour flood fill.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const n = field[i];
      let s = Math.abs(n - 0.5) < C.SEAM_W;
      if (!s) {
        const pos = n > 0.5;
        if (x + 1 < w && (field[i + 1] > 0.5) !== pos) s = true;
        else if (y + 1 < h && (field[i + w] > 0.5) !== pos) s = true;
      }
      out[i] = s ? 1 : 0;
    }
  }
  return out;
}

function generateMap(seed) {
  const C = CONFIG;
  const w = C.GRID_W, h = C.GRID_H, N = w * h;
  const rng = mulberry32(seed);
  const terrainSeed = (rng() * 4294967296) >>> 0;
  const seamSeed = (rng() * 4294967296) >>> 0;

  // 1. Terrain
  const terrain = makeField(terrainSeed, w, h, C.TERRAIN_SCALE, C.TERRAIN_OCTAVES);
  const land = new Uint8Array(N);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = x < C.BORDER || y < C.BORDER || x >= w - C.BORDER || y >= h - C.BORDER;
      land[y * w + x] = !edge && terrain[y * w + x] > C.LAND_T ? 1 : 0;
    }
  }

  // 2. Seams
  const seamField = makeField(seamSeed, w, h, C.SEAM_SCALE, C.SEAM_OCTAVES);
  const seamRaw = computeSeams(seamField, w, h);
  const seam = new Uint8Array(N);
  for (let i = 0; i < N; i++) seam[i] = land[i] && seamRaw[i] ? 1 : 0;

  // 3. Territories: 4-neighbour BFS over land, non-seam cells
  const regionId = new Int16Array(N).fill(-1);
  const visited = new Uint8Array(N);
  const queue = new Int32Array(N);
  let regionCount = 0;
  for (let s = 0; s < N; s++) {
    if (!land[s] || seam[s] || visited[s]) continue;
    let qh = 0, qt = 0;
    queue[qt++] = s; visited[s] = 1;
    while (qh < qt) {
      const i = queue[qh++];
      const x = i % w, y = (i / w) | 0;
      if (x > 0)     { const j = i - 1; if (land[j] && !seam[j] && !visited[j]) { visited[j] = 1; queue[qt++] = j; } }
      if (x < w - 1) { const j = i + 1; if (land[j] && !seam[j] && !visited[j]) { visited[j] = 1; queue[qt++] = j; } }
      if (y > 0)     { const j = i - w; if (land[j] && !seam[j] && !visited[j]) { visited[j] = 1; queue[qt++] = j; } }
      if (y < h - 1) { const j = i + w; if (land[j] && !seam[j] && !visited[j]) { visited[j] = 1; queue[qt++] = j; } }
    }
    if (qt >= C.MIN_AREA) {
      for (let k = 0; k < qt; k++) regionId[queue[k]] = regionCount;
      regionCount++;
    } else {
      for (let k = 0; k < qt; k++) land[queue[k]] = 0; // too small: becomes ocean
    }
  }

  // 4. Absorb seam cells: multi-source BFS from all territory cells through seam cells
  let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) if (regionId[i] >= 0) queue[qt++] = i;
  while (qh < qt) {
    const i = queue[qh++];
    const r = regionId[i];
    const x = i % w, y = (i / w) | 0;
    if (x > 0)     { const j = i - 1; if (land[j] && seam[j] && regionId[j] < 0) { regionId[j] = r; queue[qt++] = j; } }
    if (x < w - 1) { const j = i + 1; if (land[j] && seam[j] && regionId[j] < 0) { regionId[j] = r; queue[qt++] = j; } }
    if (y > 0)     { const j = i - w; if (land[j] && seam[j] && regionId[j] < 0) { regionId[j] = r; queue[qt++] = j; } }
    if (y < h - 1) { const j = i + w; if (land[j] && seam[j] && regionId[j] < 0) { regionId[j] = r; queue[qt++] = j; } }
  }
  // Land that never joined a territory (seam clusters cut off from everything) becomes ocean.
  for (let i = 0; i < N; i++) {
    if (regionId[i] < 0) land[i] = 0;
  }

  // 5. Capitals: centroid, snapped to the nearest territory cell if outside
  const sx = new Float64Array(regionCount), sy = new Float64Array(regionCount);
  const area = new Int32Array(regionCount);
  for (let i = 0; i < N; i++) {
    const r = regionId[i];
    if (r < 0) continue;
    sx[r] += i % w; sy[r] += (i / w) | 0; area[r]++;
  }
  const capitals = [];
  for (let r = 0; r < regionCount; r++) {
    let cx = Math.round(sx[r] / area[r]), cy = Math.round(sy[r] / area[r]);
    if (regionId[cy * w + cx] !== r) {
      let best = Infinity, bx = cx, by = cy;
      for (let i = 0; i < N; i++) {
        if (regionId[i] !== r) continue;
        const x = i % w, y = (i / w) | 0;
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d < best) { best = d; bx = x; by = y; }
      }
      cx = bx; cy = by;
    }
    capitals.push({ id: r, cx, cy, area: area[r] });
  }

  return { w, h, seed, regionId, land, capitals };
}

// 7. Reject and regenerate until the map is usable.
function generateMapWithRetry(seed) {
  const C = CONFIG;
  for (let attempt = 0; attempt < C.MAX_GEN_ATTEMPTS; attempt++) {
    const trySeed = (seed + attempt * 7919) >>> 0;
    const map = generateMap(trySeed);
    let total = 0;
    for (const c of map.capitals) total += c.area;
    if (map.capitals.length >= 1 + C.N_ENEMIES && total >= C.MIN_TOTAL_LAND_FRAC * C.GRID_W * C.GRID_H) {
      return map;
    }
  }
  throw new Error('Map generation failed after ' + C.MAX_GEN_ATTEMPTS + ' attempts; check CONFIG.');
}
