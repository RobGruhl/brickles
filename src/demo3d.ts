// Depth Lab — prototype showcase for the flat → 3D "pop" transition.
// Plays a staggered inflate sequence across every element, with a scrub
// slider to inspect any intermediate depth. Renders through the real
// render.ts functions, so what you see here is what World 4 would ship.

import { WORLDS, RB_ORDER, type ColorName } from './levels.ts';
import {
  drawBackground, drawBrick, drawPaddle, drawBall, drawPowerup, drawParticle, drawBrickle,
  type Brick, type Ball, type Paddle, type PowerUp, type Particle,
  type Cloud, type Twinkle, type BrickleState,
} from './render.ts';
import { RB } from './levels.ts';

const W = 1080, H = 900;
const canvas = document.getElementById('lab') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const dpr = Math.min(2, window.devicePixelRatio || 1);
canvas.width = W * dpr;
canvas.height = H * dpr;
ctx.scale(dpr, dpr);

// ── Scene ────────────────────────────────────────────────────────────

const clouds: Cloud[] = [
  { x: 220, y: 120, s: 1.0, vx: 9 },
  { x: 720, y: 74,  s: 0.75, vx: 6 },
  { x: 960, y: 190, s: 0.55, vx: 12 },
];
const twinkles: Twinkle[] = Array.from({ length: 18 }, (_, i) => ({
  x: (i * 173 + 60) % W,
  y: (i * 97) % 300 + 30,
  r: 5 + (i % 3) * 2,
  sp: 1 + (i % 5) * 0.3,
  ph: i * 1.7,
}));

const BW = 140, BH = 58, GAP = 20;
function mkBrick(col: ColorName, kind: Brick['kind'], hits: number, x: number, y: number): Brick {
  return { x, y, w: BW, h: BH, color: col, kind, hits, maxHits: hits, drop: false };
}

const bricks: Brick[] = [];
{
  const row = (y: number, defs: [ColorName, Brick['kind'], number][], cols = 6) => {
    const total = cols * BW + (cols - 1) * GAP;
    const x0 = (W - total) / 2;
    defs.forEach(([c, k, h], i) => bricks.push(mkBrick(c, k, h, x0 + i * (BW + GAP), y)));
  };
  row(150, [['red', 'normal', 1], ['orange', 'normal', 1], ['yellow', 'normal', 1], ['green', 'normal', 1], ['blue', 'normal', 1], ['purple', 'normal', 1]]);
  row(262, [['teal', 'strong', 2], ['pink', 'strong', 2], ['red', 'strong', 2], ['green', 'strong', 2], ['orange', 'strong', 2], ['blue', 'strong', 2]]);
  // cracked strong brick (1 hit left) sits mid-row to show the damage state in 3D
  const r3: [ColorName, Brick['kind'], number][] = [['pink', 'heart', 1], ['yellow', 'sprite', 1], ['teal', 'sprite', 1], ['red', 'heart', 1]];
  const total3 = 4 * BW + 3 * GAP;
  r3.forEach(([c, k, h], i) => bricks.push(mkBrick(c, k, h, (W - total3) / 2 + i * (BW + GAP), 390)));
  const cracked = bricks[8]; // middle of the strong row
  cracked.maxHits = 2; cracked.hits = 1;
}

const powerups: PowerUp[] = [
  { type: 'wide',  label: '↔', color: 'green',  weight: 1, x: 250, y: 520, vy: 0, ph: 0.6 },
  { type: 'multi', label: '◈', color: 'blue',   weight: 1, x: 540, y: 545, vy: 0, ph: 2.1 },
  { type: 'life',  label: '',  color: 'pink',   weight: 1, x: 830, y: 520, vy: 0, ph: 4.0 },
];

const paddle: Paddle = { x: W / 2 - 160, y: 760, w: 320, h: 34, baseW: 320 };
const ball: Ball = { x: W / 2, y: 655, r: 17, vx: 0, vy: 0, stuck: false };

const particles: Particle[] = [];

// ── Sequence timeline ────────────────────────────────────────────────
// Each piece inflates 0 → 1 with a back-eased overshoot, staggered so the
// pop ripples through bricks, then treats, then paddle, then the star.

const POP_MS = 620;
interface Piece {
  delay: number;
  cx: number; cy: number;
  color: string;
  draw: (d: number, t: number) => void;
  popped: boolean;
  hidden?: boolean; // brick woke up and left the wall
}

const pieces: Piece[] = [];
bricks.forEach((b, i) => pieces.push({
  delay: 250 + i * 95,
  cx: b.x + b.w / 2, cy: b.y + b.h / 2,
  color: RB[b.color].fill,
  draw: (d, t) => drawBrick(ctx, b, t, d),
  popped: false,
}));
const afterBricks = 250 + bricks.length * 95 + 250;
powerups.forEach((pu, i) => pieces.push({
  delay: afterBricks + i * 220,
  cx: pu.x, cy: pu.y,
  color: RB[pu.color].fill,
  draw: (d, t) => drawPowerup(ctx, pu, t, d),
  popped: false,
}));
pieces.push({
  delay: afterBricks + 3 * 220 + 300,
  cx: paddle.x + paddle.w / 2, cy: paddle.y + paddle.h / 2,
  color: '#a87cff',
  draw: (d, t) => drawPaddle(ctx, paddle, t, d),
  popped: false,
});
pieces.push({
  delay: afterBricks + 3 * 220 + 750,
  cx: ball.x, cy: ball.y,
  color: '#ffd93b',
  draw: (d, t) => drawBall(ctx, ball, t, d),
  popped: false,
});
const SEQ_TOTAL = pieces[pieces.length - 1].delay + POP_MS;

function easeOutBack(t: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

let mode: 'seq' | 'manual' = 'seq';
let seqStart = performance.now();
let manualDepth = 0;

function pieceDepth(p: Piece, now: number): number {
  if (mode === 'manual') return manualDepth;
  const local = Math.max(0, Math.min(1, (now - seqStart - p.delay) / POP_MS));
  if (local > 0 && !p.popped) {
    p.popped = true;
    burst(p.cx, p.cy, p.color);
  }
  return local === 0 ? 0 : easeOutBack(local);
}

function burst(x: number, y: number, color: string): void {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.random() * 0.5;
    const sp = 120 + Math.random() * 160;
    particles.push({
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
      size: 6 + Math.random() * 6,
      color,
      shape: i % 2 ? 'star' : 'dot',
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 6,
      life: 0.7, maxLife: 0.7,
      grav: 320,
    });
  }
}

// ── Brickles ─────────────────────────────────────────────────────────
// Wake-up: wobble in place → face + limbs pop → hop off the wall → wander
// near the paddle, blinking and waving.

const GROUND_Y = 848;        // spectator row: below the paddle line, out of play
const CROWD_SCALE = 0.62;    // they shrink as they hop back — reads as distance
interface BrickleEnt {
  s: BrickleState;
  born: number;
  homeX: number; homeY: number;
  fullW: number; fullH: number;
  hopToX: number;
  dir: number;
  landed: boolean;
  nextBlink: number; blinkUntil: number;
  nextWave: number; waveUntil: number;
  state: 'wobble' | 'wake' | 'hop' | 'wander';
}
const brickles: BrickleEnt[] = [];
let autoWoke = false;

function wake(i: number): void {
  const p = pieces[i];
  if (!p || p.hidden || i >= bricks.length) return;
  p.hidden = true;
  const b = bricks[i];
  const now = performance.now();
  brickles.push({
    s: {
      x: b.x + b.w / 2, y: b.y + b.h / 2,
      w: b.w - 5, h: b.h - 5,
      color: b.color,
      face: 0, limb: 0, walk: 0,
      moving: false, blink: 0, wave: 0, squash: 1,
    },
    born: now,
    homeX: b.x + b.w / 2, homeY: b.y + b.h / 2,
    fullW: b.w - 5, fullH: b.h - 5,
    hopToX: Math.max(220, Math.min(860, b.x + b.w / 2 + (Math.random() - 0.5) * 240)),
    dir: Math.random() < 0.5 ? -1 : 1,
    landed: false,
    nextBlink: now + 2500, blinkUntil: 0,
    nextWave: now + 3200, waveUntil: 0,
    state: 'wobble',
  });
}

function wakeRandom(): void {
  const candidates = pieces
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i < bricks.length && !p.hidden);
  if (!candidates.length) return;
  wake(candidates[Math.floor(Math.random() * candidates.length)].i);
}

function updateBrickle(b: BrickleEnt, now: number, dt: number): void {
  const s = b.s;
  const age = now - b.born;

  if (b.state === 'wobble') {
    s.x = b.homeX + Math.sin(now * 0.045) * 3.5;
    if (age > 520) { b.state = 'wake'; s.x = b.homeX; }
  } else if (b.state === 'wake') {
    const k = Math.min(1, (age - 520) / 900);
    s.face = Math.min(1, k * 1.7);
    s.blink = k < 0.16 ? 1 : 0; // eyes open with a first blink
    s.limb = k < 0.3 ? 0 : easeOutBack((k - 0.3) / 0.7);
    if (k >= 1) b.state = 'hop';
  } else if (b.state === 'hop') {
    const k = Math.min(1, (age - 1420) / 720);
    s.x = b.homeX + (b.hopToX - b.homeX) * k;
    s.y = b.homeY + (GROUND_Y - b.homeY) * k - Math.sin(k * Math.PI) * 150;
    const sc = 1 - (1 - CROWD_SCALE) * k;
    s.w = b.fullW * sc; s.h = b.fullH * sc;
    if (k >= 1) {
      b.state = 'wander';
      b.landed = true;
      s.squash = 0.72;
      burst(s.x, s.y + s.h / 2, RB[s.color].fill);
    }
  } else {
    // wander
    s.squash += (1 - s.squash) * Math.min(1, dt * 10);
    const waving = now < b.waveUntil;
    s.moving = !waving;
    if (s.moving) {
      s.x += b.dir * 62 * dt;
      if (s.x < 190) { s.x = 190; b.dir = 1; }
      if (s.x > 890) { s.x = 890; b.dir = -1; }
      s.walk += dt * 9;
      s.y = GROUND_Y - Math.abs(Math.sin(s.walk)) * 4;
    } else {
      // cheering — little excited jumps while waving
      s.y = GROUND_Y - Math.abs(Math.sin(now / 110)) * 7;
    }
    if (now > b.nextWave) {
      b.waveUntil = now + 1200;
      b.nextWave = now + 4800 + Math.random() * 3200;
      if (Math.random() < 0.4) b.dir *= -1; // sometimes turns after saying hi
    }
    s.wave += ((waving ? 1 : 0) - s.wave) * Math.min(1, dt * 8);
    if (now > b.nextBlink) {
      b.blinkUntil = now + 140;
      b.nextBlink = now + 2200 + Math.random() * 2000;
    }
    s.blink = now < b.blinkUntil || waving ? 1 : 0; // happy closed eyes mid-wave
  }
}

// ── Controls ─────────────────────────────────────────────────────────

const slider = document.getElementById('depth') as HTMLInputElement;
const pct = document.getElementById('pct')!;
const replay = document.getElementById('replay')!;

slider.addEventListener('input', () => {
  mode = 'manual';
  manualDepth = Number(slider.value) / 100;
});
replay.addEventListener('click', () => {
  mode = 'seq';
  seqStart = performance.now();
  pieces.forEach(p => (p.popped = false));
  particles.length = 0;
});
document.getElementById('wake')!.addEventListener('click', wakeRandom);

// ── Main loop ────────────────────────────────────────────────────────

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  clouds.forEach(c => { c.x += c.vx * dt; if (c.x > W + 90) c.x = -90; });
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += p.grav * dt; p.rot += p.vr * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }

  ball.y = 655 + Math.sin(t * 1.6) * 10;

  // the finale: once the wall is fully 3D, the cracked brick stirs first
  if (mode === 'seq' && !autoWoke && now - seqStart > SEQ_TOTAL + 700) {
    autoWoke = true;
    wake(8); // the cracked strong brick — closest to hatching
  }
  brickles.forEach(b => updateBrickle(b, now, dt));

  drawBackground(ctx, W, H, t, clouds, twinkles, WORLDS[0]);
  // spectators live behind the playfield so they never occlude the action
  brickles.forEach(b => drawBrickle(ctx, b.s, t));
  pieces.forEach(p => { if (!p.hidden) p.draw(pieceDepth(p, now), t); });
  particles.forEach(p => drawParticle(ctx, p));

  if (mode === 'seq') {
    const prog = Math.max(0, Math.min(1, (now - seqStart) / SEQ_TOTAL));
    slider.value = String(Math.round(prog * 100));
    pct.textContent = prog < 1 ? 'playing…' : 'fully 3D ✦';
  } else {
    pct.textContent = `${Math.round(manualDepth * 100)}%`;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// keep RB_ORDER import from being flagged unused if row colors change later
void RB_ORDER;
