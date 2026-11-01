// All tunables live here.
const CONFIG = {
  // World
  GRID_W: 120,
  GRID_H: 200,
  CELL: 4,
  BORDER: 3,                 // cells at the edge forced to ocean

  // Terrain (Perlin fBm)
  TERRAIN_SCALE: 0.03,
  TERRAIN_OCTAVES: 4,
  TERRAIN_LACUNARITY: 1,
  TERRAIN_GAIN: 0.5,
  LAND_T: 0.4,

  // Seams
  SEAM_MODE: 'line',         // 'line' = thin continuous lines, 'blob' = n > SEAM_T
  SEAM_SCALE: 0.12,
  SEAM_OCTAVES: 1,
  SEAM_W: 0.02,             // line mode: |n - 0.5| < SEAM_W (plus sign-change guard)
  SEAM_T: 0.8,               // blob mode threshold

  // Territories / generation validation
  MIN_AREA: 150,
  MIN_TOTAL_LAND_FRAC: 0.15, // total territory area must cover this share of the grid
  MAX_GEN_ATTEMPTS: 60,

  // Match
  N_ENEMIES: 3,
  START_TROOPS: 60,
  NEUTRAL_TROOPS: [5, 18],
  GROWTH_PER_AREA: 0.002,    // troops/s per cell

  // Sending / units
  SEND_FRACTION: 0.5,
  FLOW: 125,                  // units/s emitted per capital
  UNIT_SPEED: 40,            // px/s
  UNIT_JITTER: 3,            // px spawn jitter
  SEP_RADIUS: 8,
  SEP_MAX: 40,               // px/s
  CLASH_RADIUS: 4,
  CAPITAL_RADIUS: 8,
  CAPITAL_PULSE_AMOUNT: 1.5,
  CAPITAL_PULSE_DURATION: 0.4, // seconds
  CAPITAL_IMAGE_SIZE: 24,
  CAPITAL_IMAGE_MIN_SCALE: 1.5,
  CAPITAL_IMAGE_MAX_SCALE: 2.5,
  MAX_TROOP_GROWTH_PER_SECOND: 5,
  HOVER_RADIUS: 100,
  HOVER_PULSE_AMOUNT: 2,
  HOVER_PULSE_SPEED: 5,       // radians/s

  // Difficulty
  AI_START_TROOPS: 80,
  AI_MOVE_INTERVAL: [0.8, 3], // per-AI base interval range in seconds
  AI_MOVE_INTERVAL_JITTER: 0.5, // seconds of per-decision interval variation
  AI_MIN_TROOPS: [5, 25],    // per-AI reserve threshold range
  AI_INTELLIGENCE: [0, 0.5, 1], // per-AI intelligence: random, mixed, or strategic

  // Loop
  SIM_DT: 1 / 60,
  MAX_FRAME_MS: 50,

  // Sea
  SEA_LAYER_COUNT: 2, // max 8; must not exceed SEA_LAYERS.length
  SEA_LAYERS: [
    // Speed is [x, y] drift in noise-space units per second.
    { scale: 0.035, speed: [0.2, 0.1] },
    { scale: 0.015, speed: [-0.2, -0.3] },
  ],
  SEA_COLORS: [0x123b70, 0x18558c, 0x2373a8, 0x398fbd, 0x68b4d2],

  // Colors (hex numbers)
  COLORS: {
    ocean: 0x0d2238,
    seam: 0x141c24,
    neutral: 0x8a909a,
    players: [0x3b82f6, 0xef4444, 0xf59e0b, 0x22c55e, 0xa855f7],
  },
};
