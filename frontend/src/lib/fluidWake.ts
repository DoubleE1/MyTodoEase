/**
 * The mouse wake behind the Home background (components/AsciiField.tsx): a small 2D fluid on a grid of at most
 * 128 points across, after the hero of shadcn.io/background. Its feel (glide, curl, width) is a setting, and a
 * click can burst it outward. The mouse stirs it in short oval stamps; each step
 * carries velocity and dye along the flow, adds back the small swirls the grid smooths away (vorticity
 * confinement) and keeps the flow from piling up (a few pressure iterations), so a stroke curls and spreads
 * like smoke before it fades. `trailAt` reads how stirred a spot is, from the flow's speed and its dye.
 */

/** A mouse movement to stamp, in grid units. */
interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Stamps along the segment. */
  count: number;
  /** Oval width. */
  width: number;
  /** Dye per stamp. */
  ink: number;
  /** Push per stamp. */
  push: number;
}

const MAX_SPEED = 80;

/** How the wake feels: how long it glides and stays tinted, how much it curls, how wide and hard a stroke is. */
export interface WakeFeel {
  /** Velocity fade per second (higher stops sooner). */
  fadeVelocity: number;
  /** Dye fade per second. */
  fadeDye: number;
  /** Strength of the curls given back each step. */
  swirl: number;
  /** Stroke width as a share of the grid's shorter side. */
  width: number;
  /** Push per unit moved, for a crawl and for a flick. */
  pushSlow: number;
  pushFast: number;
}

/** The shadcn.io hero's feel. */
export const CLASSIC_FEEL: WakeFeel = { fadeVelocity: 1.9, fadeDye: 3.2, swirl: 10, width: 0.0445, pushSlow: 2, pushFast: 20 };

export class FluidWake {
  constructor(private feel: WakeFeel = CLASSIC_FEEL) {}

  width = 0;
  height = 0;
  private vx = new Float32Array(0);
  private vy = new Float32Array(0);
  private dye = new Float32Array(0);
  /** How stirred each point is, 0 to 1 (from speed and dye), refreshed every step. */
  private trail = new Float32Array(0);
  private tmpX = new Float32Array(0);
  private tmpY = new Float32Array(0);
  private tmpD = new Float32Array(0);
  private curl = new Float32Array(0);
  private pressure = new Float32Array(0);
  private pressureNext = new Float32Array(0);
  private segments: Segment[] = [];
  private previous: { x: number; y: number; at: number } | null = null;
  /** True while anything is still moving or tinted. */
  active = false;

  /** Size the grid to the area's shape: 128 points along the longer side. */
  resize(areaWidth: number, areaHeight: number) {
    const aspect = areaWidth / Math.max(1, areaHeight);
    const width = Math.max(2, Math.round(aspect >= 1 ? 128 : 128 * aspect));
    const height = Math.max(2, Math.round(aspect >= 1 ? 128 / aspect : 128));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    const n = width * height;
    for (const key of ['vx', 'vy', 'dye', 'trail', 'tmpX', 'tmpY', 'tmpD', 'curl', 'pressure', 'pressureNext'] as const) {
      this[key] = new Float32Array(n);
    }
    this.segments = [];
    this.previous = null;
    this.active = false;
  }

  /** Forget the last point (the mouse left), so the next move does not draw a line from it. */
  lift() {
    this.previous = null;
  }

  /**
   * A mouse position as a share of the area (0 to 1). Joins it to the previous one: the faster the move, the
   * wider the stamp and the harder the push.
   */
  point(x: number, y: number, now: number) {
    if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) {
      this.previous = null;
      return;
    }
    const sx = Math.min(1, Math.max(0, x));
    const sy = Math.min(1, Math.max(0, y));
    const from = this.previous;
    this.previous = { x: sx, y: sy, at: now };
    if (!from) return;
    const { width: w, height: h } = this;
    const bx = (sx - from.x) * (w - 1);
    const by = (sy - from.y) * (h - 1);
    const length = Math.hypot(bx, by);
    if (length < 0.001) return;
    const short = Math.min(w, h);
    const seconds = now > from.at ? Math.max(1 / 240, (now - from.at) / 1000) : 1 / 60;
    // Speed in shares of the area per second, eased: 0 for a crawl, close to 1 for a flick.
    const fast = 1 - Math.exp(-Math.min(12, length / short / seconds) / 2.2);
    const width = this.feel.width * short * (0.65 + 0.95 * fast);
    const count = Math.min(128, Math.max(1, Math.ceil(length / (0.4 * width))));
    this.segments.push({
      ax: from.x * (w - 1),
      ay: from.y * (h - 1),
      bx,
      by,
      count,
      width,
      ink: ((length / width) * (0.32 + 0.22 * fast)) / count,
      push: (length * (this.feel.pushSlow + (this.feel.pushFast - this.feel.pushSlow) * fast)) / count,
    });
    this.active = true;
  }

  /**
   * A click at a point (shares of the area): the fluid is pushed outward in a ring and tinted round it, so the
   * field ripples out from the pointer.
   */
  burst(x: number, y: number, strength = 1) {
    const { width: w, height: h, vx, vy, dye } = this;
    const cx = Math.min(1, Math.max(0, x)) * (w - 1);
    const cy = Math.min(1, Math.max(0, y)) * (h - 1);
    const radius = 0.06 * Math.min(w, h);
    const reach = Math.ceil(radius * 2.2);
    for (let gy = Math.max(1, Math.floor(cy - reach)); gy <= Math.min(h - 2, Math.ceil(cy + reach)); gy++) {
      for (let gx = Math.max(1, Math.floor(cx - reach)); gx <= Math.min(w - 2, Math.ceil(cx + reach)); gx++) {
        const dx = gx - cx;
        const dy = gy - cy;
        const d = Math.hypot(dx, dy);
        if (d > reach) continue;
        const ring = Math.exp(-(((d - radius) / (radius * 0.45)) ** 2));
        const i = gy * w + gx;
        dye[i] = 1 - (1 - dye[i]) * Math.exp(-ring * 0.35 * strength);
        if (d > 0.001) {
          const push = 12 * strength * ring;
          vx[i] = clamp(vx[i] + (dx / d) * push, -MAX_SPEED, MAX_SPEED);
          vy[i] = clamp(vy[i] + (dy / d) * push, -MAX_SPEED, MAX_SPEED);
        }
      }
    }
    this.active = true;
  }

  /** Advance by `dt` seconds (in steps of at most 1/60 s). */
  step(dt: number) {
    if (this.segments.length) this.splat();
    let left = Math.min(0.05, dt);
    while (left > 1e-7) {
      const step = Math.min(1 / 60, left);
      left -= step;
      this.advect(step);
      this.confine(step);
      this.project();
    }
  }

  /** How stirred the wake is at a point given as a share of the area (0 to 1), smoothly between grid points. */
  trailAt(u: number, v: number): number {
    const { width: w, height: h, trail } = this;
    const px = Math.min(w - 1.001, Math.max(0, u * w - 0.5));
    const py = Math.min(h - 1.001, Math.max(0, v * h - 0.5));
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const fx = px - ix;
    const fy = py - iy;
    const i = iy * w + ix;
    const top = trail[i] + (trail[i + 1] - trail[i]) * fx;
    const bottom = trail[i + w] + (trail[i + w + 1] - trail[i + w]) * fx;
    return top + (bottom - top) * fy;
  }

  /** Clear everything (the wake has run its course). */
  settle() {
    for (const field of [this.vx, this.vy, this.dye, this.trail]) field.fill(0);
    this.active = false;
  }

  // ---- The simulation ----

  private isEdge(x: number, y: number) {
    return x < 1 || y < 1 || x > this.width - 2 || y > this.height - 2;
  }

  /** Stamp the queued mouse segments: ovals along each, dye in, velocity pushed along with a slight twist. */
  private splat() {
    const { width: w, vx, vy, dye } = this;
    for (const seg of this.segments.splice(0)) {
      const length = Math.hypot(seg.bx, seg.by);
      const gx = seg.bx / length;
      const gy = seg.by / length;
      const f = seg.width;
      const reach = (3 * f + 1) * 1.415;
      const minX = Math.max(1, Math.floor(Math.min(seg.ax, seg.ax + seg.bx) - reach));
      const maxX = Math.min(this.width - 2, Math.ceil(Math.max(seg.ax, seg.ax + seg.bx) + reach));
      const minY = Math.max(1, Math.floor(Math.min(seg.ay, seg.ay + seg.by) - reach));
      const maxY = Math.min(this.height - 2, Math.ceil(Math.max(seg.ay, seg.ay + seg.by) + reach));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const along = (x - seg.ax) * gx + (y - seg.ay) * gy;
          // Only the stamps whose box (3 widths round each) can reach this point.
          const lo = Math.max(0, Math.floor(((along - reach) / length) * seg.count - 0.5));
          const hi = Math.min(seg.count - 1, Math.ceil(((along + reach) / length) * seg.count - 0.5));
          let sum = 0;
          let dvx = 0;
          let dvy = 0;
          for (let n = lo; n <= hi; n++) {
            const k = (n + 0.5) / seg.count;
            const ox = seg.ax + seg.bx * k;
            const oy = seg.ay + seg.by * k;
            if (x < Math.floor(ox - 3 * f) || y < Math.floor(oy - 3 * f) || x > Math.ceil(ox + 3 * f) || y > Math.ceil(oy + 3 * f)) continue;
            const ex = x - ox;
            const ey = y - oy;
            const u = (ex * gx + ey * gy) / f; // along the move
            const r = (ey * gx - ex * gy) / f; // across it
            const wgt = Math.exp(-u * u * 0.65 - r * r * 1.7);
            const side = 1 - r * r * 0.55;
            const twist = u * r * 0.7;
            sum += wgt;
            dvx += (gx * side - gy * twist) * wgt * seg.push;
            dvy += (gy * side + gx * twist) * wgt * seg.push;
          }
          if (sum === 0) continue;
          const i = y * w + x;
          dye[i] = 1 - (1 - dye[i]) * Math.exp(-sum * seg.ink);
          vx[i] = clamp(vx[i] + dvx, -MAX_SPEED, MAX_SPEED);
          vy[i] = clamp(vy[i] + dvy, -MAX_SPEED, MAX_SPEED);
        }
      }
    }
  }

  /** Carry velocity and dye along the flow (looking back along it), then let both fade. */
  private advect(dt: number) {
    const { width: w, height: h, vx, vy, dye, tmpX, tmpY, tmpD } = this;
    const fadeV = Math.exp(-this.feel.fadeVelocity * dt);
    const fadeD = Math.exp(-this.feel.fadeDye * dt);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (this.isEdge(x, y)) {
          tmpX[i] = tmpY[i] = tmpD[i] = 0;
          continue;
        }
        const px = clamp(x - vx[i] * dt, 0.5, w - 1.5);
        const py = clamp(y - vy[i] * dt, 0.5, h - 1.5);
        const ix = Math.floor(px);
        const iy = Math.floor(py);
        const fx = px - ix;
        const fy = py - iy;
        const j = iy * w + ix;
        tmpX[i] = bilerp(vx, j, w, fx, fy) * fadeV;
        tmpY[i] = bilerp(vy, j, w, fx, fy) * fadeV;
        tmpD[i] = bilerp(dye, j, w, fx, fy) * fadeD;
      }
    }
    vx.set(tmpX);
    vy.set(tmpY);
    dye.set(tmpD);
  }

  /** Give back the small swirls the grid smooths away: turn the flow towards its curls, keeping its speed. */
  private confine(dt: number) {
    const { width: w, height: h, vx, vy, curl, tmpX, tmpY } = this;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        curl[i] = this.isEdge(x, y) ? 0 : 0.5 * (vy[i + 1] - vy[i - 1] - vx[i + w] + vx[i - w]);
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (this.isEdge(x, y)) {
          tmpX[i] = tmpY[i] = 0;
          continue;
        }
        const ox = Math.abs(curl[i + 1]) - Math.abs(curl[i - 1]);
        const oy = Math.abs(curl[i + w]) - Math.abs(curl[i - w]);
        const l = Math.hypot(ox, oy) + 1e-4;
        const k = curl[i] * dt * this.feel.swirl;
        const speed = Math.hypot(vx[i], vy[i]);
        const nx = vx[i] + (oy / l) * k;
        const ny = vy[i] - (ox / l) * k;
        const keep = Math.min(1, speed / (Math.hypot(nx, ny) + 1e-6));
        tmpX[i] = nx * keep;
        tmpY[i] = ny * keep;
      }
    }
    vx.set(tmpX);
    vy.set(tmpY);
  }

  /** Remove the flow's build-up (a few pressure iterations), then note how stirred each point is. */
  private project() {
    const { width: w, height: h, vx, vy, dye, trail } = this;
    let p = this.pressure;
    let next = this.pressureNext;
    p.fill(0);
    for (let iteration = 0; iteration < 4; iteration++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (this.isEdge(x, y)) {
            next[i] = 0;
            continue;
          }
          const div = -0.5 * (vx[i + 1] - vx[i - 1] + vy[i + w] - vy[i - w]);
          next[i] = 0.25 * (div + p[i - 1] + p[i + 1] + p[i - w] + p[i + w]);
        }
      }
      [p, next] = [next, p];
    }
    let moving = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (this.isEdge(x, y)) {
          trail[i] = 0;
          continue;
        }
        vx[i] = clamp(vx[i] - 0.5 * (p[i + 1] - p[i - 1]), -MAX_SPEED, MAX_SPEED);
        vy[i] = clamp(vy[i] - 0.5 * (p[i + w] - p[i - w]), -MAX_SPEED, MAX_SPEED);
        const stirred = 1 - Math.exp(-0.06 * Math.hypot(vx[i], vy[i]) - 0.16 * dye[i]);
        trail[i] = stirred;
        if (stirred > 0.01) moving = true;
      }
    }
    this.pressure = p;
    this.pressureNext = next;
    this.active = moving || this.segments.length > 0;
  }
}

function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value;
}

/** Bilinear read of a grid at index `j` (the top-left point) with fractions fx, fy. */
function bilerp(field: Float32Array, j: number, w: number, fx: number, fy: number) {
  const top = field[j] + (field[j + 1] - field[j]) * fx;
  const bottom = field[j + w] + (field[j + w + 1] - field[j + w]) * fx;
  return top + (bottom - top) * fy;
}
