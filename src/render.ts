import { RB, INK, INK_DK, type ColorName, type BrickKind, type World } from './levels.ts';

// ── Shared render types ──────────────────────────────────────────────

export interface Brick {
  x: number; y: number; w: number; h: number;
  color: ColorName; kind: BrickKind;
  hits: number; maxHits: number;
  drop: boolean;
}

export interface Ball {
  x: number; y: number; r: number;
  vx: number; vy: number;
  stuck: boolean;
  relX?: number;
}

export interface Paddle {
  x: number; y: number; w: number; h: number;
  baseW: number;
}

export interface PowerUp {
  type: string; label: string;
  color: ColorName; weight: number;
  x: number; y: number;
  vy: number; ph: number;
}

export interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  size: number; color: string;
  shape: 'star' | 'dot';
  rot: number; vr: number;
  life: number; maxLife: number;
  grav: number;
}

export interface Floater {
  x: number; y: number;
  text: string; color: string;
  life: number; vy: number;
}

export interface Cloud {
  x: number; y: number; s: number; vx: number;
}

export interface Twinkle {
  x: number; y: number; r: number; sp: number; ph: number;
}

export interface Effects {
  wide: number; slow: number; sticky: number;
}

// ── Path helpers ─────────────────────────────────────────────────────

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number, innerR: number, points: number, rot: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (Math.PI / points) * i - Math.PI / 2 + rot;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function heartPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.beginPath();
  const top = cy - s * 0.28;
  ctx.moveTo(cx, cy + s * 0.42);
  ctx.bezierCurveTo(cx - s * 0.62, cy - s * 0.06, cx - s * 0.5, top - s * 0.36, cx, top);
  ctx.bezierCurveTo(cx + s * 0.5, top - s * 0.36, cx + s * 0.62, cy - s * 0.06, cx, cy + s * 0.42);
  ctx.closePath();
}

// ── 3D extrusion ─────────────────────────────────────────────────────
// All pieces extrude toward down-right (light stays top-left). The solid is
// built by stamping the silhouette along the extrusion axis: ink strokes
// first (they survive only at the rim, forming the outline of the union),
// then shade fills back-to-front. Front face art is drawn on top at offset 0.

const EX = 0.5, EY = 0.87; // extrusion direction (unit-ish vector)

export function easeOutBack(k: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
}

export function extrudePath(
  ctx: CanvasRenderingContext2D,
  path: (ox: number, oy: number) => void,
  e: number,
  shade: string,
): void {
  if (e < 0.75) return;
  const steps = Math.max(2, Math.ceil(e / 3));
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  for (let i = steps; i >= 1; i--) {
    const o = (e * i) / steps;
    path(o * EX, o * EY);
    ctx.stroke();
  }
  ctx.fillStyle = shade;
  for (let i = steps; i >= 0; i--) {
    const o = (e * i) / steps;
    path(o * EX, o * EY);
    ctx.fill();
  }
}

// ── Internal helpers ─────────────────────────────────────────────────

function drawFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, cheekColor?: string, blink = 0): void {
  const e = 2.2 * scale;
  if (blink > 0.5) {
    // happy closed eyes: two little "∩" arcs
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.8 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx - 6 * scale, cy + 0.6 * scale, 2.6 * scale, Math.PI, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 6 * scale, cy + 0.6 * scale, 2.6 * scale, Math.PI, Math.PI * 2); ctx.stroke();
  } else {
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(cx - 6 * scale, cy, e, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 6 * scale, cy, e, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(cx - 6 * scale + 0.8 * scale, cy - 0.8 * scale, 0.8 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 6 * scale + 0.8 * scale, cy - 0.8 * scale, 0.8 * scale, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.8 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy + 1.5 * scale, 4 * scale, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  if (cheekColor) {
    ctx.fillStyle = cheekColor;
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.arc(cx - 9 * scale, cy + 3 * scale, 2.2 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 9 * scale, cy + 3 * scale, 2.2 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = fill;
  const puffs: [number, number, number][] = [[0, 0, 26], [28, 6, 22], [-28, 6, 22], [14, -10, 20], [-14, -10, 20]];
  ctx.beginPath();
  puffs.forEach(([px, py, pr]) => { ctx.moveTo(px + pr, py); ctx.arc(px, py, pr, 0, Math.PI * 2); });
  ctx.fill();
  ctx.fillRect(-44, 0, 88, 18);
  ctx.restore();
}

// ── Exported draw functions ───────────────────────────────────────────

export function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, clouds: Cloud[], twinkles: Twinkle[], world: World): void {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0,    world.sky[0]);
  sky.addColorStop(0.45, world.sky[1]);
  sky.addColorStop(1,    world.sky[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  const sx = W * 0.18, sy = H * 0.12;
  const glow = ctx.createRadialGradient(sx, sy, 10, sx, sy, 360);
  glow.addColorStop(0, world.night ? 'rgba(255,250,224,0.45)' : 'rgba(255,249,210,0.85)');
  glow.addColorStop(1, world.night ? 'rgba(255,250,224,0)'    : 'rgba(255,249,210,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  if (world.night) {
    // crescent moon: cream disc, then carve by re-filling an offset disc with
    // the same sky gradient (gradients use canvas coords, so the seam is invisible)
    ctx.fillStyle = '#fff2c4';
    ctx.beginPath(); ctx.arc(sx, sy, 64, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(52,33,90,0.12)';
    ctx.beginPath(); ctx.arc(sx - 22, sy + 14, 9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx - 4,  sy + 32, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = sky;
    ctx.beginPath(); ctx.arc(sx + 28, sy - 12, 56, 0, Math.PI * 2); ctx.fill();
  }

  const cx = W * 0.5, cy = H * 1.02;
  const bands = ['#ff7fc4', '#a87cff', '#4db5ff', '#5fd97a', '#ffd93b', '#ff9f43', '#ff5d6c'];
  const baseR = H * 0.92;
  const bw = 26;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = bw;
  bands.forEach((c, i) => {
    ctx.strokeStyle = c;
    ctx.beginPath();
    ctx.arc(cx, cy, baseR - i * bw, Math.PI, Math.PI * 2);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  clouds.forEach(cl => drawCloud(ctx, cl.x, cl.y, cl.s, world.cloudFill));

  const n = Math.min(world.twinkles, twinkles.length);
  for (let i = 0; i < n; i++) {
    const tw = twinkles[i];
    const tw2 = (Math.sin(t * tw.sp + tw.ph) + 1) / 2;
    ctx.globalAlpha = 0.25 + tw2 * 0.6;
    ctx.fillStyle = '#fffce0';
    starPath(ctx, tw.x, tw.y, tw.r * (0.6 + tw2 * 0.5), tw.r * 0.35, 4, t * 0.2 + tw.ph);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function drawBrick(ctx: CanvasRenderingContext2D, b: Brick, t: number, depth = 0): void {
  const { x, y, w, h } = b;
  const col = RB[b.color];
  const e = depth * Math.min(w, h) * 0.25;

  if (b.kind === 'heart') {
    const cx = x + w / 2, cy = y + h / 2;
    const s = Math.min(w, h) * 1.15;
    extrudePath(ctx, (ox, oy) => heartPath(ctx, cx + ox, cy + oy, s), e, col.shade);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = INK;
    heartPath(ctx, cx, cy, s); ctx.stroke();
    ctx.fillStyle = col.fill; heartPath(ctx, cx, cy, s); ctx.fill();
    ctx.fillStyle = col.light; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.ellipse(cx - s * 0.16, cy - s * 0.12, s * 0.12, s * 0.08, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    drawFace(ctx, cx, cy + 1, Math.min(w, h) / 26, col.light);
    return;
  }

  if (b.kind === 'sprite') {
    const cx = x + w / 2, cy = y + h / 2;
    const r = Math.min(w, h) * 0.46;
    extrudePath(ctx, (ox, oy) => starPath(ctx, cx + ox, cy + oy, r * 1.32, r * 0.92, 8, t * 0.6), e, col.shade);
    ctx.fillStyle = col.fill;
    ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.lineJoin = 'round';
    starPath(ctx, cx, cy, r * 1.32, r * 0.92, 8, t * 0.6);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff7fb';
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2); ctx.stroke();
    drawFace(ctx, cx, cy, Math.min(w, h) / 24, col.fill);
    return;
  }

  // normal / strong rounded brick
  extrudePath(ctx, (ox, oy) => roundRect(ctx, x + 2.5 + ox, y + 2.5 + oy, w - 5, h - 5, 12), e, col.shade);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  roundRect(ctx, x + 2.5, y + 2.5, w - 5, h - 5, 12); ctx.stroke();
  ctx.fillStyle = col.fill;
  roundRect(ctx, x + 2.5, y + 2.5, w - 5, h - 5, 12); ctx.fill();
  ctx.fillStyle = col.light; ctx.globalAlpha = 0.85;
  roundRect(ctx, x + 8, y + 7, w - 16, (h - 5) * 0.34, 8); ctx.fill();
  ctx.globalAlpha = 1;
  if (b.kind === 'strong' && b.hits >= 2) {
    ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.7; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(x + w / 2 + i * 14 - 6, y + h * 0.62);
      ctx.lineTo(x + w / 2 + i * 14 + 6, y + h * 0.4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  if (b.hits === 1 && b.maxHits >= 2) {
    ctx.strokeStyle = INK; ctx.globalAlpha = 0.35; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.3, y + 6); ctx.lineTo(x + w * 0.45, y + h * 0.5);
    ctx.lineTo(x + w * 0.35, y + h - 6);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

export function drawPaddle(ctx: CanvasRenderingContext2D, p: Paddle, _t: number, depth = 0): void {
  const { x, y, w, h } = p;
  const e = depth * h * 0.36;
  ctx.save();
  ctx.fillStyle = 'rgba(52,33,90,0.18)';
  roundRect(ctx, x + 4 + e * 0.45, y + 8 + e * 0.55, w + e * 0.3, h, h / 2); ctx.fill();

  extrudePath(ctx, (ox, oy) => roundRect(ctx, x + ox, y + oy, w, h, h / 2), e, '#5b4292');

  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = 5;
  roundRect(ctx, x, y, w, h, h / 2); ctx.stroke();

  ctx.save();
  roundRect(ctx, x, y, w, h, h / 2); ctx.clip();
  const bands = ['#ff5d6c', '#ff9f43', '#ffd93b', '#5fd97a', '#4db5ff', '#a87cff', '#ff7fc4'];
  const bh = h / bands.length;
  bands.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(x, y + i * bh, w, bh + 1); });
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(x, y, w, h * 0.3);
  ctx.restore();

  ctx.strokeStyle = INK; ctx.lineWidth = 5;
  roundRect(ctx, x, y, w, h, h / 2); ctx.stroke();

  const cx = x + w / 2, cy = y + h / 2;
  const sc = h / 18;
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(cx - 7 * sc, cy - 1 * sc, 2.4 * sc, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 7 * sc, cy - 1 * sc, 2.4 * sc, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(cx - 6.2 * sc, cy - 1.8 * sc, 0.9 * sc, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 7.8 * sc, cy - 1.8 * sc, 0.9 * sc, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 2.4 * sc; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy + 0.5 * sc, 5 * sc, 0.12 * Math.PI, 0.88 * Math.PI); ctx.stroke();
  ctx.restore();
}

export function drawBall(ctx: CanvasRenderingContext2D, ball: Ball, t: number, depth = 0): void {
  const { x, y, r } = ball;
  const d = Math.max(0, Math.min(1, depth)) * 0.62;
  ctx.save();
  const glow = ctx.createRadialGradient(x, y, 1, x, y, r * 2.4);
  glow.addColorStop(0, 'rgba(255,248,180,0.9)');
  glow.addColorStop(1, 'rgba(255,248,180,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, Math.PI * 2); ctx.fill();

  // sphere fades in beneath the star; the star shrinks into a sticker on it
  if (d > 0.02) {
    const R = r * 1.5;
    const sph = ctx.createRadialGradient(x - R * 0.4, y - R * 0.45, R * 0.15, x, y, R * 1.05);
    sph.addColorStop(0, '#fff6c9');
    sph.addColorStop(0.55, '#ffd93b');
    sph.addColorStop(1, '#dfa400');
    ctx.globalAlpha = Math.min(1, d * 1.7);
    ctx.strokeStyle = INK; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fillStyle = sph; ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const rot = t * 1.5;
  const so = r * (1.5 - 0.32 * d), si = r * (0.66 - 0.16 * d);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = 4;
  starPath(ctx, x, y, so, si, 5, rot); ctx.stroke();
  ctx.fillStyle = '#ffd93b';
  starPath(ctx, x, y, so, si, 5, rot); ctx.fill();
  ctx.fillStyle = '#fff3a8';
  starPath(ctx, x, y, r * (0.9 - 0.2 * d), r * (0.4 - 0.09 * d), 5, rot); ctx.fill();

  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(x - r * 0.32, y - r * 0.05, r * 0.16, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + r * 0.32, y - r * 0.05, r * 0.16, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(x, y + r * 0.1, r * 0.34, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.restore();
}

export const PU_ICON: Record<string, string> = {
  multi: '◈', wide: '↔', slow: '🐌', life: '♥', sticky: '✦',
};

export function drawPowerup(ctx: CanvasRenderingContext2D, pu: PowerUp, t: number, depth = 0): void {
  const { x, y } = pu;
  const col = RB[pu.color];
  const r = 22;
  ctx.save();
  ctx.translate(x, y);
  const bob = Math.sin(t * 4 + pu.ph) * 2;
  ctx.translate(0, bob);
  const e = depth * 5.5;
  if (pu.type === 'life') {
    extrudePath(ctx, (ox, oy) => heartPath(ctx, ox, oy, r * 2.0), e, col.shade);
  } else {
    extrudePath(ctx, (ox, oy) => { ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); }, e, col.shade);
  }
  ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = INK;
  if (pu.type === 'life') {
    heartPath(ctx, 0, 0, r * 2.0); ctx.stroke();
    ctx.fillStyle = col.fill; heartPath(ctx, 0, 0, r * 2.0); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = col.fill; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col.light; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.3, r * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#fff';
  ctx.font = '700 20px Fredoka, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 4; ctx.strokeStyle = INK;
  ctx.strokeText(pu.label, 0, 2);
  ctx.fillText(pu.label, 0, 2);
  ctx.restore();
}

// ── Brickle creature ─────────────────────────────────────────────────
// A woken brick: same body as a brick front face, plus stubby limbs and a
// face. `limb`/`face` animate the wake-up; `walk` drives the waddle cycle.

export interface BrickleState {
  x: number; y: number;      // body centre
  w: number; h: number;      // body size (use the brick's front-face size)
  color: ColorName;
  kind?: BrickKind;          // heart/sprite brickles keep their body shape
  face: number;              // 0 → 1 face fade-in
  limb: number;              // 0 → 1 limb extension
  walk: number;              // walk-cycle phase (radians)
  moving: boolean;
  blink: number;             // 0 open → 1 closed
  wave: number;              // 0 → 1 right-arm wave
  squash: number;            // 1 neutral, <1 landing squash
}

export function drawBrickle(ctx: CanvasRenderingContext2D, s: BrickleState, t: number): void {
  const col = RB[s.color];
  const bw = s.w, bh = s.h;
  const kind = s.kind === 'heart' || s.kind === 'sprite' ? s.kind : 'normal';
  const m = Math.min(bw, bh);
  const e = m * 0.22;                // always fully 3D — it's alive
  const lw = bw * 0.15;              // limb thickness
  const leg = s.limb * bh * 0.42;
  const arm = s.limb * bw * 0.26;

  // per-kind body geometry: where the feet hang and the arms attach
  const hs = m * 1.15;               // heart size (matches drawBrick)
  const rOut = m * 0.66;             // sprite star outer radius
  const bodyBottom = kind === 'heart' ? hs * 0.42 : kind === 'sprite' ? rOut * 0.88 : bh / 2;
  const legX = kind === 'heart' ? bw * 0.14 : kind === 'sprite' ? rOut * 0.42 : bw * 0.24;
  const armX = kind === 'heart' ? hs * 0.48 : kind === 'sprite' ? rOut * 0.78 : bw * 0.47;
  const armY = kind === 'heart' ? -hs * 0.1 : kind === 'sprite' ? 0 : -bh * 0.02;

  ctx.save();
  ctx.translate(s.x, s.y);
  const sy = s.squash, sx = 1 / Math.max(0.7, sy);
  ctx.scale(sx, sy);
  ctx.rotate(s.moving ? Math.sin(s.walk) * 0.055 : Math.sin(t * 2.2) * 0.02);
  ctx.lineJoin = 'round';

  // legs — capsules from the body bottom; each lifts on its half of the cycle
  if (leg > 1) {
    const liftL = s.moving ? Math.max(0, Math.sin(s.walk)) * leg * 0.6 : 0;
    const liftR = s.moving ? Math.max(0, -Math.sin(s.walk)) * leg * 0.6 : 0;
    const topY = kind === 'normal' ? bh * 0.5 - 6 : bodyBottom * 0.35;
    ([[-legX, liftL], [legX, liftR]] as [number, number][]).forEach(([fx, lift]) => {
      ctx.strokeStyle = INK; ctx.lineWidth = 4;
      ctx.fillStyle = col.fill;
      roundRect(ctx, fx - lw / 2, topY, lw, bodyBottom + leg - lift - topY, lw / 2);
      ctx.fill(); ctx.stroke();
    });
  }

  // arms — left hangs (swings when walking), right can wave hello
  if (arm > 1) {
    const drawArm = (side: -1 | 1, ang: number) => {
      ctx.save();
      ctx.translate(side * armX, armY);
      ctx.rotate(ang);
      ctx.strokeStyle = INK; ctx.lineWidth = 4;
      ctx.fillStyle = col.fill;
      roundRect(ctx, 0, -lw / 2, arm, lw, lw / 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    };
    const swing = s.moving ? Math.sin(s.walk) * 0.35 : Math.sin(t * 2.2) * 0.08;
    drawArm(-1, Math.PI - 1.1 + swing);
    const waveAng = -1.15 - Math.sin(t * 11) * 0.4 * s.wave;
    drawArm(1, s.wave > 0.05 ? 1.1 + (waveAng - 1.1) * s.wave : 1.1 - swing);
  }

  // body — extruded, keeping the brick's original shape
  if (kind === 'heart') {
    extrudePath(ctx, (ox, oy) => heartPath(ctx, ox, oy, hs), e, col.shade);
    ctx.strokeStyle = INK; ctx.lineWidth = 5;
    heartPath(ctx, 0, 0, hs); ctx.stroke();
    ctx.fillStyle = col.fill; heartPath(ctx, 0, 0, hs); ctx.fill();
    ctx.fillStyle = col.light; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.ellipse(-hs * 0.16, -hs * 0.12, hs * 0.12, hs * 0.08, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (kind === 'sprite') {
    extrudePath(ctx, (ox, oy) => starPath(ctx, ox, oy, rOut, rOut * 0.7, 8, 0), e, col.shade);
    ctx.strokeStyle = INK; ctx.lineWidth = 4;
    starPath(ctx, 0, 0, rOut, rOut * 0.7, 8, 0); ctx.stroke();
    ctx.fillStyle = col.fill;
    starPath(ctx, 0, 0, rOut, rOut * 0.7, 8, 0); ctx.fill();
    ctx.fillStyle = '#fff7fb';
    ctx.beginPath(); ctx.arc(0, 0, rOut * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(0, 0, rOut * 0.62, 0, Math.PI * 2); ctx.stroke();
  } else {
    extrudePath(ctx, (ox, oy) => roundRect(ctx, -bw / 2 + ox, -bh / 2 + oy, bw, bh, 14), e, col.shade);
    ctx.strokeStyle = INK; ctx.lineWidth = 5;
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 14); ctx.stroke();
    ctx.fillStyle = col.fill;
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 14); ctx.fill();
    ctx.fillStyle = col.light; ctx.globalAlpha = 0.85;
    roundRect(ctx, -bw / 2 + 6, -bh / 2 + 5, bw - 12, bh * 0.32, 8); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // face
  if (s.face > 0.02) {
    ctx.globalAlpha = s.face;
    if (kind === 'heart')       drawFace(ctx, 0, hs * 0.04, m / 26, col.light, s.blink);
    else if (kind === 'sprite') drawFace(ctx, 0, 0, m / 24, col.fill, s.blink);
    else                        drawFace(ctx, 0, bh * 0.06, m / 24, col.light, s.blink);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

export function drawParticle(ctx: CanvasRenderingContext2D, p: Particle): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.fillStyle = p.color;
  if (p.shape === 'star') {
    starPath(ctx, 0, 0, p.size, p.size * 0.45, 5, 0);
  } else {
    ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}

export function drawHUD(
  ctx: CanvasRenderingContext2D,
  W: number,
  HUD: number,
  score: number,
  lives: number,
  levelName: string,
  effects: Effects,
  combo: number,
  world: World,
): void {
  const night = world.night;
  const bx = 14, by = 12, bw = W - 28, bh = HUD - 22;

  // hard ink drop shadow — clip out the bar shape so it doesn't darken the
  // translucent glass fill (same as CSS box-shadow clipping at the border box)
  ctx.save();
  roundRect(ctx, bx, by, bw, bh, 22);
  ctx.rect(0, 0, W, HUD * 2);
  ctx.clip('evenodd');
  ctx.fillStyle = INK;
  roundRect(ctx, bx, by + 6, bw, bh, 22); ctx.fill();
  ctx.restore();

  ctx.fillStyle = night ? 'rgba(52,33,90,0.42)' : 'rgba(255,255,255,0.78)';
  roundRect(ctx, bx, by, bw, bh, 22); ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = INK;
  roundRect(ctx, bx, by, bw, bh, 22); ctx.stroke();

  const lblColor = night ? '#cdbff0' : '#6a5a8c';
  const valColor = night ? '#ffffff' : INK;
  // night values get an offset dark-ink shadow so they read on any sky
  const text = (s: string, x: number, y: number, color: string) => {
    if (night) { ctx.fillStyle = INK_DK; ctx.fillText(s, x, y + 2); }
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  };

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = lblColor;
  ctx.font = '700 30px Fredoka, sans-serif';
  ctx.fillText('SCORE', 44, 44);
  ctx.font = '600 42px Fredoka, sans-serif';
  text(score.toLocaleString(), 44, 80, valColor);

  // keep clear of the pause/mute buttons overlaid at the top-right (right: 30..168px)
  const hx = W - 196;
  ctx.textAlign = 'right';
  ctx.font = '700 24px Fredoka, sans-serif';
  ctx.fillStyle = lblColor;
  ctx.fillText('LIVES', hx, 40);
  // compress the row when lives stack up so it never reaches the centered level text
  const hsp = lives > 1 ? Math.min(42, 224 / (lives - 1)) : 42;
  const hs = 34 * (hsp / 42);
  for (let i = 0; i < lives; i++) {
    const hcx = W - 206 - i * hsp, hcy = 80;
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.lineJoin = 'round';
    heartPath(ctx, hcx, hcy, hs); ctx.stroke();
    ctx.fillStyle = RB.pink.fill; heartPath(ctx, hcx, hcy, hs); ctx.fill();
  }

  ctx.textAlign = 'center';
  ctx.font = '600 28px Fredoka, sans-serif';
  if (night) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5; ctx.strokeStyle = INK_DK;
    ctx.strokeText(levelName, W / 2, 38);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(levelName, W / 2, 38);
  } else {
    ctx.fillStyle = INK;
    ctx.fillText(levelName, W / 2, 38);
  }

  const tags: string[] = [];
  if (effects.wide > 0) tags.push('WIDE');
  if (effects.slow > 0) tags.push('SLOW');
  if (effects.sticky > 0) tags.push('STICKY');
  ctx.font = '600 22px Fredoka, sans-serif';
  if (combo >= 2) {
    text('COMBO ×' + combo, W / 2, 74, RB.red.fill);
  } else if (tags.length) {
    text(tags.join('  ·  '), W / 2, 74, night ? RB.teal.light : RB.teal.shade);
  }
}
