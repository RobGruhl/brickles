import { RB, INK, LEVELS, WORLDS, brickFromChar, type ColorName } from './levels.ts';
import { Sound } from './audio.ts';
import {
  drawBackground, drawBrick, drawPaddle, drawBall,
  drawPowerup, drawParticle, drawHUD, drawBrickle, easeOutBack,
  type Brick, type Ball, type Paddle, type PowerUp, type Particle, type Floater, type Cloud, type Twinkle, type Effects,
  type BrickleState,
} from './render.ts';

const W = 1080, H = 1320;
const HUD_H = 116;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
canvas.width = W; canvas.height = H;

const stage = document.getElementById('stage') as HTMLElement;
function resize(): void {
  // Use visualViewport when available — window.innerHeight in Safari includes
  // the address bar chrome, which causes the bottom of the stage to be clipped.
  const vw = window.visualViewport?.width  ?? window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const s = Math.min(vw / W, vh / H);
  stage.style.transform = `translate(-50%,-50%) scale(${s})`;
}
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
resize();

const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// ── Decor ─────────────────────────────────────────────────────────────

const clouds: Cloud[] = [
  { x: W * 0.2,  y: H * 0.32, s: 1.1,  vx: 8   },
  { x: W * 0.75, y: H * 0.22, s: 0.85, vx: 6   },
  { x: W * 0.55, y: H * 0.5,  s: 1.3,  vx: 5   },
  { x: W * 0.1,  y: H * 0.62, s: 0.7,  vx: 7   },
  { x: W * 0.9,  y: H * 0.55, s: 0.95, vx: 6.5 },
];
const twinkles: Twinkle[] = Array.from({ length: Math.max(...WORLDS.map(w => w.twinkles)) }, () => ({
  x: Math.random() * W, y: Math.random() * H * 0.8,
  r: 4 + Math.random() * 7, sp: 1 + Math.random() * 3, ph: Math.random() * 7,
}));

// ── Power-up defs ─────────────────────────────────────────────────────

type PowerUpType = 'multi' | 'wide' | 'slow' | 'sticky' | 'life';

interface PowerUpDef {
  type: PowerUpType; label: string; color: ColorName; weight: number;
}

const POWERUP_DEFS: PowerUpDef[] = [
  { type: 'multi',  label: '+', color: 'blue',   weight: 3 },
  { type: 'wide',   label: 'W', color: 'green',  weight: 3 },
  { type: 'slow',   label: 'S', color: 'teal',   weight: 2 },
  { type: 'sticky', label: '✦', color: 'purple', weight: 2 },
  { type: 'life',   label: '♥', color: 'pink',   weight: 2 },
];

function randomPU(): PowerUpDef {
  const total = POWERUP_DEFS.reduce((a, p) => a + p.weight, 0);
  let r = Math.random() * total;
  for (const p of POWERUP_DEFS) { if ((r -= p.weight) <= 0) return p; }
  return POWERUP_DEFS[0];
}

// ── Game state ────────────────────────────────────────────────────────

type GameState = 'title' | 'serve' | 'play' | 'paused' | 'levelclear' | 'gameover' | 'win' | 'levelselect';

let state: GameState = 'title';
let levelIdx = 0;
let score = 0;
let levelStartScore = 0;
let lives = 5;
let combo = 0, comboTimer = 0, bestCombo = 0;
let bricks: DepthBrick[] = [], balls: Ball[] = [], powerups: PowerUp[] = [];
let particles: Particle[] = [], floaters: Floater[] = [];
let initialBrickCount = 0;
let paddle: Paddle = { x: W / 2 - 110, y: H - 140, w: 220, h: 30, baseW: 220 };
let effects: Effects = { wide: 0, slow: 0, sticky: 0 };
let speedMul = 1, speedMulTarget = 1;
let baseSpeed = 520;
let shake = 0;
let mouseX = W / 2;

function currentWorld() {
  return WORLDS[LEVELS[levelIdx].world - 1] ?? WORLDS[0];
}

function worldLevelIndex(): number {
  const wid = LEVELS[levelIdx].world;
  return LEVELS.slice(0, levelIdx).filter(l => l.world === wid).length;
}

function grayscaleAmount(): number {
  if (state === 'title' || state === 'levelselect' || state === 'win') return 0;
  if (currentWorld().id !== 3) return 0;
  const posInWorld = worldLevelIndex();
  const totalInWorld = LEVELS.filter(l => l.world === 3).length;
  const bricksCleared = Math.max(0, initialBrickCount - bricks.length);
  const brickFraction = initialBrickCount > 0 ? bricksCleared / initialBrickCount : 0;
  return Math.max(0, (totalInWorld - posInWorld - brickFraction) / totalInWorld);
}

// ── World 4: depth + brickles ─────────────────────────────────────────
// Depth mirrors Chromatica's grayscale: progress through World 4 plus the
// fraction of bricks cleared in the current level → 0..1. Chromatica drives
// a CSS filter; depth instead feeds the draw calls. Individual bricks pop
// to full 3D (easeOutBack, staggered) as the rising level crosses their
// scattered thresholds, so volume spreads through the wall brick by brick.

const WAKE_FROM = 3;          // world-4 level index where bricks wake instead of break
const POP_S = 0.62;           // per-brick inflate duration (s)
const GROUND_Y = H - 48;      // spectator row, below the paddle line
const CROWD_SCALE = 0.62;     // spectators shrink — reads as distance
const CROWD_MAX = 36;

interface DepthBrick extends Brick { th: number; popT: number; popped: boolean }

let popCursor = 0;            // schedules the stagger between brick pops
let depthSmooth = 0;          // eased world depth for paddle / ball / powerups

function depthAmount(): number {
  if (state === 'title' || state === 'levelselect' || state === 'win') return 0;
  if (currentWorld().id !== 4) return 0;
  const posInWorld = worldLevelIndex();
  const totalInWorld = LEVELS.filter(l => l.world === 4).length;
  const bricksCleared = Math.max(0, initialBrickCount - bricks.length);
  const brickFraction = initialBrickCount > 0 ? bricksCleared / initialBrickCount : 0;
  return Math.min(1, (posInWorld + brickFraction) / totalInWorld);
}

function isWakeLevel(): boolean {
  return currentWorld().id === 4 && worldLevelIndex() >= WAKE_FROM;
}

function brickDepth(b: DepthBrick): number {
  if (b.popT < 0 || t < b.popT) return 0;
  return easeOutBack(Math.min(1, (t - b.popT) / POP_S));
}

interface BrickleEnt {
  s: BrickleState;
  born: number;                 // t (s) when woken
  homeX: number; homeY: number;
  fullW: number; fullH: number;
  hopToX: number;
  dir: number;
  nextBlink: number; blinkUntil: number;
  nextWave: number; waveUntil: number;
  phase: 'wobble' | 'wake' | 'hop' | 'wander';
}

let brickles: BrickleEnt[] = [];
let freedThisRun = 0;

function wakeBrick(br: Brick): void {
  if (brickles.length >= CROWD_MAX) brickles.shift();
  brickles.push({
    s: {
      x: br.x + br.w / 2, y: br.y + br.h / 2,
      w: br.w - 5, h: br.h - 5,
      color: br.color, kind: br.kind,
      face: 0, limb: 0, walk: 0,
      moving: false, blink: 0, wave: 0, squash: 1,
    },
    born: t,
    homeX: br.x + br.w / 2, homeY: br.y + br.h / 2,
    fullW: br.w - 5, fullH: br.h - 5,
    hopToX: Math.max(W * 0.14, Math.min(W * 0.86, br.x + br.w / 2 + (Math.random() - 0.5) * 300)),
    dir: Math.random() < 0.5 ? -1 : 1,
    nextBlink: t + 2.5, blinkUntil: 0,
    nextWave: t + 3.2 + Math.random() * 2, waveUntil: 0,
    phase: 'wobble',
  });
  freedThisRun++;
  progress.freed++;
  saveProgress();
}

function updateBrickleEnt(b: BrickleEnt, dt: number): void {
  const s = b.s;
  const age = t - b.born;
  if (b.phase === 'wobble') {
    s.x = b.homeX + Math.sin(t * 45) * 3.5;
    if (age > 0.52) { b.phase = 'wake'; s.x = b.homeX; }
  } else if (b.phase === 'wake') {
    const k = Math.min(1, (age - 0.52) / 0.9);
    s.face = Math.min(1, k * 1.7);
    s.blink = k < 0.16 ? 1 : 0;          // eyes open with a first blink
    s.limb = k < 0.3 ? 0 : easeOutBack((k - 0.3) / 0.7);
    if (k >= 1) b.phase = 'hop';
  } else if (b.phase === 'hop') {
    const k = Math.min(1, (age - 1.42) / 0.72);
    s.x = b.homeX + (b.hopToX - b.homeX) * k;
    s.y = b.homeY + (GROUND_Y - b.homeY) * k - Math.sin(k * Math.PI) * 170;
    const sc = 1 - (1 - CROWD_SCALE) * k;
    s.w = b.fullW * sc; s.h = b.fullH * sc;
    if (k >= 1) {
      b.phase = 'wander';
      s.squash = 0.72;
      burst(s.x, s.y + s.h / 2, s.color);
    }
  } else {
    // wander the spectator row, blinking, waving, cheering
    s.squash += (1 - s.squash) * Math.min(1, dt * 10);
    const waving = t < b.waveUntil;
    s.moving = !waving;
    if (s.moving) {
      s.x += b.dir * 62 * dt;
      if (s.x < W * 0.12) { s.x = W * 0.12; b.dir = 1; }
      if (s.x > W * 0.88) { s.x = W * 0.88; b.dir = -1; }
      s.walk += dt * 9;
      s.y = GROUND_Y - Math.abs(Math.sin(s.walk)) * 4;
    } else {
      s.y = GROUND_Y - Math.abs(Math.sin(t * 9)) * 7; // excited little jumps
    }
    if (t > b.nextWave) {
      b.waveUntil = t + 1.2;
      b.nextWave = t + 4.8 + Math.random() * 3.2;
      if (Math.random() < 0.4) b.dir *= -1;
    }
    s.wave += ((waving ? 1 : 0) - s.wave) * Math.min(1, dt * 8);
    if (t > b.nextBlink) {
      b.blinkUntil = t + 0.14;
      b.nextBlink = t + 2.2 + Math.random() * 2;
    }
    s.blink = t < b.blinkUntil || waving ? 1 : 0;
  }
}

// ── Progress (unlocks + per-level bests) ──────────────────────────────

interface Progress {
  maxUnlocked: number;          // 0-based, highest playable level index
  best: Record<number, number>; // level index → best score for that level
  freed: number;                // lifetime brickles woken (roster meta for the next act)
}

const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

function loadProgress(): Progress {
  try {
    const p = JSON.parse(localStorage.getItem('brickles_progress') ?? '');
    if (typeof p?.maxUnlocked === 'number' && p.best && typeof p.best === 'object') {
      const maxUnlocked = IS_LOCAL ? LEVELS.length - 1 : Math.min(p.maxUnlocked, LEVELS.length - 1);
      return { maxUnlocked, best: p.best, freed: typeof p.freed === 'number' ? p.freed : 0 };
    }
  } catch { /* fall through to fresh progress */ }
  return { maxUnlocked: IS_LOCAL ? LEVELS.length - 1 : 0, best: {}, freed: 0 };
}

const progress: Progress = loadProgress();

function saveProgress(): void {
  localStorage.setItem('brickles_progress', JSON.stringify(progress));
}

function clearedCount(): number {
  return Object.keys(progress.best).length;
}

// ── Level builder ─────────────────────────────────────────────────────

function buildLevel(i: number): void {
  const lvl = LEVELS[i];
  bricks = [];
  const cols = Math.max(...lvl.grid.map(r => r.length));
  const margin = 70, gap = 10;
  const top = HUD_H + 150;
  const bw = (W - margin * 2 - gap * (cols - 1)) / cols;
  const bh = 44;
  lvl.grid.forEach((row, ry) => {
    for (let cx2 = 0; cx2 < row.length; cx2++) {
      const def = brickFromChar(row[cx2], ry);
      if (!def) continue;
      bricks.push({
        x: margin + cx2 * (bw + gap),
        y: top + ry * (bh + gap),
        w: bw, h: bh,
        color: def.color, hits: def.hits, maxHits: def.hits,
        kind: def.kind, drop: !!def.drop,
        // golden-ratio scatter spreads pop thresholds evenly through the wall
        th: ((bricks.length + 1) * 0.618034) % 1, popT: -1, popped: false,
      });
    }
  });
  baseSpeed = Math.min(1000, 510 + i * 35);
  levelStartScore = score;
  paddle.w = paddle.baseW;
  effects = { wide: 0, slow: 0, sticky: 0 };
  speedMul = speedMulTarget = 1;
  powerups = []; particles = [];
  initialBrickCount = bricks.length;
  popCursor = 0;
  // the crowd follows you through Poptopia, but disperses elsewhere
  if (LEVELS[i].world !== 4) brickles = [];
  resetBall();
}

function resetBall(): void {
  balls = [{
    x: paddle.x + paddle.w / 2, y: paddle.y - 22,
    r: 16, vx: 0, vy: 0, stuck: true,
  }];
  combo = 0;
}

function launchBall(): void {
  balls.forEach(b => {
    if (b.stuck) {
      b.stuck = false;
      const ang = (-Math.PI / 2) + (Math.random() * 0.5 - 0.25);
      b.vx = Math.cos(ang) * baseSpeed;
      b.vy = Math.sin(ang) * baseSpeed;
    }
  });
  Sound.launch();
}

// ── Particles / floaters ──────────────────────────────────────────────

function burst(x: number, y: number, color: ColorName): void {
  const { fill, light } = RB[color];
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 80 + Math.random() * 260;
    particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
      size: 5 + Math.random() * 9, color: Math.random() < 0.5 ? fill : light,
      shape: Math.random() < 0.55 ? 'star' : 'dot',
      rot: Math.random() * 7, vr: (Math.random() - 0.5) * 12,
      life: 0.6 + Math.random() * 0.4, maxLife: 1, grav: 520,
    });
  }
}

function floatText(x: number, y: number, text: string, color: string): void {
  floaters.push({ x, y, text, color, life: 1, vy: -60 });
}

// ── Power-up effects ──────────────────────────────────────────────────

function spawnPowerup(x: number, y: number): void {
  const def = randomPU();
  powerups.push({ ...def, x, y, vy: 165, ph: Math.random() * 7 });
}

function applyPowerup(pu: PowerUp): void {
  Sound.powerup();
  if (pu.type === 'multi') {
    const live = balls.filter(b => !b.stuck);
    const src = live.length ? live : balls;
    const add: Ball[] = [];
    src.forEach(b => {
      for (let k = 0; k < 2; k++) {
        const ang = Math.atan2(b.vy || -1, b.vx || 0) + (Math.random() * 1.2 - 0.6);
        add.push({ x: b.x, y: b.y, r: 16, vx: Math.cos(ang) * baseSpeed, vy: Math.sin(ang) * baseSpeed, stuck: false });
      }
    });
    balls.push(...add.slice(0, 6));
    floatText(pu.x, pu.y, 'MULTI-BALL!', RB.blue.shade);
  } else if (pu.type === 'wide') {
    const wasWide = effects.wide > 0;
    effects.wide = 13;
    paddle.w = Math.min(paddle.w * 1.6, paddle.baseW * 2.5);
    floatText(pu.x, pu.y, wasWide ? 'WIDER!' : 'WIDE!', RB.green.shade);
  } else if (pu.type === 'slow') {
    effects.slow = 11; speedMulTarget = 0.6;
    floatText(pu.x, pu.y, 'SLOW-MO', RB.teal.shade);
  } else if (pu.type === 'sticky') {
    effects.sticky = 13;
    floatText(pu.x, pu.y, 'STICKY!', RB.purple.shade);
  } else if (pu.type === 'life') {
    lives = Math.min(lives + 1, 9); Sound.life();
    floatText(pu.x, pu.y, '+1 LIFE', RB.pink.shade);
  }
}

// ── Collisions ────────────────────────────────────────────────────────

function ballHitsRect(b: Ball, r: { x: number; y: number; w: number; h: number }): boolean {
  return b.x + b.r > r.x && b.x - b.r < r.x + r.w &&
         b.y + b.r > r.y && b.y - b.r < r.y + r.h;
}

function breakBrick(idx: number, _ball: Ball): boolean {
  const br = bricks[idx];
  br.hits--;
  if (br.hits > 0) { Sound.strong(); return false; }
  combo++; comboTimer = 1.6; bestCombo = Math.max(bestCombo, combo);
  const gain = Math.round(60 * (1 + (combo - 1) * 0.4));
  score += gain;
  Sound.brick(combo - 1);
  burst(br.x + br.w / 2, br.y + br.h / 2, br.color);
  shake = Math.min(shake + 3, 9);
  if (combo >= 3) floatText(br.x + br.w / 2, br.y, '×' + combo, RB[br.color].shade);
  if (br.drop || Math.random() < 0.06) spawnPowerup(br.x + br.w / 2, br.y + br.h / 2);
  // in the back half of Poptopia the brick was never broken — it was asleep
  if (isWakeLevel()) { Sound.powerup(); wakeBrick(br); }
  bricks.splice(idx, 1);
  return true;
}

// ── Update ────────────────────────────────────────────────────────────

function update(dt: number): void {
  clouds.forEach(c => { c.x += c.vx * dt; if (c.x > W + 60) c.x = -60; });

  (Object.keys(effects) as (keyof Effects)[]).forEach(k => {
    if (effects[k] > 0) {
      effects[k] -= dt;
      if (effects[k] <= 0) {
        effects[k] = 0;
        if (k === 'wide')  paddle.w = paddle.baseW;
        if (k === 'slow')  speedMulTarget = 1;
      }
    }
  });
  speedMul += (speedMulTarget - speedMul) * Math.min(1, dt * 6);

  if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) combo = 0; }

  paddle.x += ((mouseX - paddle.w / 2) - paddle.x) * Math.min(1, dt * 18);
  paddle.x = Math.max(0, Math.min(W - paddle.w, paddle.x));

  if (state !== 'play' && state !== 'serve') return;

  if (currentWorld().id === 4) {
    const D = depthAmount();
    depthSmooth += (D - depthSmooth) * Math.min(1, dt * 2.5);
    for (const b of bricks) {
      if (b.popT < 0 && b.th <= D) {
        popCursor = Math.max(popCursor, t) + 0.07; // ripple, not a wall of pops
        b.popT = popCursor;
      }
      if (!b.popped && b.popT >= 0 && t >= b.popT) {
        b.popped = true;
        burst(b.x + b.w / 2, b.y + b.h / 2, b.color);
      }
    }
    brickles.forEach(b => updateBrickleEnt(b, dt));
  } else {
    depthSmooth = 0;
  }

  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    if (b.stuck) {
      // clamp so the ball stays on the paddle if it shrinks while stuck (WIDE expiring)
      b.x = paddle.x + Math.max(0, Math.min(paddle.w, b.relX ?? paddle.w / 2));
      b.y = paddle.y - b.r - 6;
      continue;
    }
    b.x += b.vx * dt * speedMul;
    b.y += b.vy * dt * speedMul;

    if (b.x - b.r < 0)  { b.x = b.r;     b.vx =  Math.abs(b.vx); Sound.wall(); }
    if (b.x + b.r > W)  { b.x = W - b.r; b.vx = -Math.abs(b.vx); Sound.wall(); }
    if (b.y - b.r < HUD_H) { b.y = HUD_H + b.r; b.vy = Math.abs(b.vy); Sound.wall(); }

    if (b.vy > 0 && b.y + b.r > paddle.y && b.y - b.r < paddle.y + paddle.h &&
        b.x > paddle.x - 6 && b.x < paddle.x + paddle.w + 6) {
      if (effects.sticky > 0) {
        b.stuck = true; b.relX = b.x - paddle.x; combo = 0; Sound.catch();
      } else {
        const hit = (b.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
        const ang = (-Math.PI / 2) + hit * (Math.PI / 3);
        b.vx = Math.cos(ang) * baseSpeed;
        b.vy = Math.sin(ang) * baseSpeed;
        b.y = paddle.y - b.r - 1;
        combo = 0;
        Sound.bounce();
      }
    }

    for (let j = bricks.length - 1; j >= 0; j--) {
      if (!ballHitsRect(b, bricks[j])) continue;
      const br = bricks[j];
      const oL = (b.x + b.r) - br.x;
      const oR = (br.x + br.w) - (b.x - b.r);
      const oT = (b.y + b.r) - br.y;
      const oB = (br.y + br.h) - (b.y - b.r);
      const minX = Math.min(oL, oR), minY = Math.min(oT, oB);
      if (minX < minY) { b.vx = -b.vx; b.x += oL < oR ? -minX : minX; }
      else             { b.vy = -b.vy; b.y += oT < oB ? -minY : minY; }
      breakBrick(j, b);
      break;
    }

    if (b.y - b.r > H) balls.splice(i, 1);
  }

  if (balls.length === 0) {
    lives--;
    Sound.life();
    if (lives <= 0) { endGame(false); return; }
    paddle.w = paddle.baseW;
    effects = { wide: 0, slow: 0, sticky: 0 };
    speedMul = speedMulTarget = 1;
    powerups = [];
    resetBall();
    state = 'serve';
  }

  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.y += p.vy * dt;
    if (p.y > paddle.y - 4 && p.y < paddle.y + paddle.h + 24 &&
        p.x > paddle.x - 10 && p.x < paddle.x + paddle.w + 10) {
      applyPowerup(p); powerups.splice(i, 1); continue;
    }
    if (p.y > H + 30) powerups.splice(i, 1);
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += p.grav * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.y += f.vy * dt; f.vy *= 0.94; f.life -= dt / 1.1;
    if (f.life <= 0) floaters.splice(i, 1);
  }

  if (bricks.length === 0) levelClear();
}

// ── Transitions ───────────────────────────────────────────────────────

function levelClear(): void {
  score += 500;
  Sound.levelClear();
  const earned = score - levelStartScore;
  progress.best[levelIdx] = Math.max(progress.best[levelIdx] ?? 0, earned);
  progress.maxUnlocked = Math.min(Math.max(progress.maxUnlocked, levelIdx + 1), LEVELS.length - 1);
  saveProgress();
  if (levelIdx >= LEVELS.length - 1) { endGame(true); return; }
  state = 'levelclear';
  (document.getElementById('lc-bonus') as HTMLElement).textContent =
    'Level score  ' + earned.toLocaleString() + '  ·  best  ' + progress.best[levelIdx].toLocaleString();
  (document.getElementById('lc-name')  as HTMLElement).textContent = 'You cleared ' + LEVELS[levelIdx].name + '!';
  show('overlay-levelclear');
}

function nextLevel(): void {
  levelIdx++;
  buildLevel(levelIdx);
  state = 'serve';
  hideAll();
}

function endGame(won: boolean): void {
  state = won ? 'win' : 'gameover';
  if (won) {
    Sound.win();
    (document.getElementById('win-score') as HTMLElement).textContent = score.toLocaleString();
    (document.getElementById('win-hi')    as HTMLElement).textContent =
      'Best combo ×' + bestCombo + '  •  ' + clearedCount() + ' / ' + LEVELS.length + ' levels cleared' +
      (freedThisRun > 0 ? '  •  ' + freedThisRun + ' brickles freed ✦' : '');
    show('overlay-win');
  } else {
    Sound.life();
    const best = progress.best[levelIdx];
    (document.getElementById('go-score') as HTMLElement).textContent = score.toLocaleString();
    (document.getElementById('go-hi')    as HTMLElement).textContent =
      best != null ? 'Best on ' + LEVELS[levelIdx].name + '  ' + best.toLocaleString() : '';
    show('overlay-gameover');
  }
}

function startAt(idx: number): void {
  levelIdx = Math.min(idx, LEVELS.length - 1);
  score = 0; lives = 5; bestCombo = 0; combo = 0;
  brickles = []; freedThisRun = 0;
  buildLevel(levelIdx);
  state = 'serve';
  hideAll();
  Sound.init();
}

function startGame(): void {
  // "Play" continues at the furthest unlocked level; level select covers replays
  startAt(progress.maxUnlocked);
}

// ── Render ────────────────────────────────────────────────────────────

let t = 0;

function render(): void {
  const gray = grayscaleAmount();
  canvas.style.filter = gray > 0 ? `grayscale(${(gray * 100).toFixed(1)}%)` : '';

  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  drawBackground(ctx, W, H, t, clouds, twinkles, currentWorld());

  // spectators live behind the playfield so they never occlude the action
  brickles.forEach(b => drawBrickle(ctx, b.s, t));

  bricks.forEach(b => drawBrick(ctx, b, t, brickDepth(b)));
  powerups.forEach(p => drawPowerup(ctx, p, t, depthSmooth));
  particles.forEach(p => drawParticle(ctx, p));

  floaters.forEach(f => {
    ctx.globalAlpha = Math.max(0, f.life);
    ctx.font = '700 30px Fredoka, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 5; ctx.strokeStyle = INK;
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  });

  if (state !== 'title') {
    drawPaddle(ctx, paddle, t, depthSmooth);
    balls.forEach(b => drawBall(ctx, b, t, depthSmooth));
  }

  drawHUD(ctx, W, HUD_H, score, lives, LEVELS[levelIdx].name, effects, combo, currentWorld());

  if (state === 'serve') {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 30px Fredoka, sans-serif';
    ctx.globalAlpha = 0.6 + Math.sin(t * 4) * 0.3;
    ctx.fillStyle = INK;
    const hint = isTouchDevice ? 'tap to launch  ✦' : 'click  or  SPACE  to  launch  ✦';
    ctx.fillText(hint, W / 2, paddle.y - 70);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// ── Main loop ─────────────────────────────────────────────────────────

let last = performance.now();
function loop(now: number): void {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05;
  t += dt;
  if (shake > 0) shake = Math.max(0, shake - dt * 30);
  if (state === 'play' || state === 'serve' || state === 'title') update(dt);
  render();
  requestAnimationFrame(loop);
}

// ── Overlay helpers ───────────────────────────────────────────────────

function show(id: string): void {
  hideAll();
  document.getElementById(id)!.classList.add('show');
}
function hideAll(): void {
  document.querySelectorAll('.overlay').forEach(o => o.classList.remove('show'));
}

// ── Input ─────────────────────────────────────────────────────────────

function toStageX(clientX: number): number {
  const rect = canvas.getBoundingClientRect();
  return ((clientX - rect.left) / rect.width) * W;
}

window.addEventListener('mousemove', e => {
  mouseX = Math.max(0, Math.min(W, toStageX(e.clientX)));
});
window.addEventListener('touchmove', e => {
  if (e.touches[0]) {
    mouseX = Math.max(0, Math.min(W, toStageX(e.touches[0].clientX)));
    // let the level map scroll on touch; block page scroll everywhere else
    if (state !== 'levelselect') e.preventDefault();
  }
}, { passive: false });

function primaryAction(): void {
  Sound.init();
  if (state === 'serve') {
    launchBall(); state = 'play';
  } else if (state === 'play') {
    if (balls.some(b => b.stuck)) {
      balls.forEach(b => {
        if (b.stuck) {
          b.stuck = false;
          const ang = (-Math.PI / 2) + (Math.random() * 0.4 - 0.2);
          b.vx = Math.cos(ang) * baseSpeed;
          b.vy = Math.sin(ang) * baseSpeed;
        }
      });
      Sound.launch();
    }
  }
}

canvas.addEventListener('mousedown', primaryAction);
canvas.addEventListener('touchstart', e => { primaryAction(); e.preventDefault(); }, { passive: false });

function togglePause(): void {
  if (state === 'play' || state === 'serve') {
    state = 'paused'; show('overlay-pause');
  } else if (state === 'paused') {
    state = balls.some(b => b.stuck) ? 'serve' : 'play'; hideAll();
  }
}

function toggleMute(): void {
  const m = Sound.toggle();
  (document.getElementById('btn-mute') as HTMLElement).classList.toggle('muted', m);
}

window.addEventListener('keydown', e => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (state === 'serve') {
      primaryAction();
    } else if (state === 'play') {
      // release sticky balls first; if nothing is stuck, pause
      if (balls.some(b => b.stuck)) primaryAction();
      else togglePause();
    } else if (state === 'paused') {
      togglePause();
    }
  }
  if (e.code === 'KeyP')        togglePause();
  if (e.code === 'KeyM')        toggleMute();
  if (e.code === 'ArrowLeft')   mouseX = Math.max(0, mouseX - 60);
  if (e.code === 'ArrowRight')  mouseX = Math.min(W, mouseX + 60);
});

// ── Level select ──────────────────────────────────────────────────────

function openLevelSelect(): void {
  state = 'levelselect';
  buildLevelSelectUI();
  show('overlay-levelselect');
}

function backToTitle(): void {
  state = 'title';
  updateTitle();
  show('overlay-title');
}

function buildLevelSelectUI(): void {
  (document.getElementById('lvl-progress') as HTMLElement).textContent =
    clearedCount() + ' / ' + LEVELS.length + ' ★';

  const bands = document.getElementById('lvl-bands') as HTMLElement;
  bands.innerHTML = '';

  WORLDS.forEach(w => {
    const idxs = LEVELS.map((_, i) => i).filter(i => LEVELS[i].world === w.id);
    const cleared = idxs.filter(i => progress.best[i] != null).length;

    const band = document.createElement('div');
    band.className = 'band' + (w.night ? ' dusk' : '');
    band.innerHTML =
      '<div class="band-head">' +
        '<div class="band-pill">' +
          '<span class="wno" style="background:' + w.accent + '">' + w.id + '</span>' +
          '<span class="wtxt"><b>' + w.name + '</b>' +
            '<span>World ' + w.id + ' · ' + cleared + ' / ' + idxs.length + ' cleared</span></span>' +
        '</div><div class="band-rule"></div>' +
      '</div><div class="tiles"><div class="trail"></div></div>';

    const tiles = band.querySelector('.tiles') as HTMLElement;
    idxs.forEach(i => {
      const done = progress.best[i] != null;
      const locked = i > progress.maxUnlocked;
      // the final level keeps a little mystery until it unlocks
      const name = locked && i === LEVELS.length - 1 ? '???' : LEVELS[i].name;

      const tile = document.createElement('div');
      tile.className = 'tile ' + (locked ? 'lock' : done ? 'done' : 'cur');
      const pad = document.createElement('button');
      pad.className = 'pad';
      pad.innerHTML = locked
        ? '<span class="badge">🔒</span><span class="num">' + (i + 1) + '</span>'
        : done
          ? '<span class="badge">★</span><span class="num">' + (i + 1) + '</span>' +
            '<span class="score">' + progress.best[i].toLocaleString() + '</span>'
          : '<span class="badge">▶</span><span class="num">' + (i + 1) + '</span>' +
            '<span class="play">PLAY</span>';
      if (locked) {
        pad.disabled = true;
      } else {
        pad.addEventListener('click', () => startAt(i));
      }
      tile.appendChild(pad);
      const label = document.createElement('div');
      label.className = 'nm';
      label.textContent = name;
      tile.appendChild(label);
      tiles.appendChild(tile);
    });

    bands.appendChild(band);
  });
}

// ── Buttons ───────────────────────────────────────────────────────────

document.getElementById('btn-start')! .addEventListener('click', startGame);
document.getElementById('btn-next')!  .addEventListener('click', nextLevel);
document.getElementById('btn-retry')! .addEventListener('click', () => startAt(levelIdx));
document.getElementById('btn-again')! .addEventListener('click', () => startAt(0));
document.getElementById('btn-resume')!   .addEventListener('click', togglePause);
document.getElementById('btn-pause-map')! .addEventListener('click', openLevelSelect);
document.getElementById('btn-pause')! .addEventListener('click', togglePause);
document.getElementById('btn-mute')!  .addEventListener('click', toggleMute);
document.getElementById('btn-levels')!  .addEventListener('click', openLevelSelect);
document.getElementById('btn-lc-map')!  .addEventListener('click', openLevelSelect);
document.getElementById('btn-go-map')!  .addEventListener('click', openLevelSelect);
document.getElementById('btn-win-map')! .addEventListener('click', openLevelSelect);
document.getElementById('btn-lvl-back')!.addEventListener('click', backToTitle);

// ── Boot ──────────────────────────────────────────────────────────────

function updateTitle(): void {
  const n = clearedCount();
  (document.getElementById('title-hi') as HTMLElement).textContent =
    n > 0 ? n + ' / ' + LEVELS.length + ' levels cleared ★' : LEVELS.length + ' levels of colour to restore!';
  (document.getElementById('btn-start') as HTMLElement).textContent =
    progress.maxUnlocked > 0 ? 'Continue ✦' : 'Play ✦';
}

updateTitle();
show('overlay-title');
requestAnimationFrame(loop);

// dev-only hook so depth/wake behaviour can be exercised without rallying
if (IS_LOCAL) {
  (window as unknown as Record<string, unknown>).bricklesDebug = {
    hit: (n = 1) => { for (let k = 0; k < n && bricks.length; k++) breakBrick(bricks.length - 1, balls[0]); },
    depth: () => depthAmount(),
  };
}
