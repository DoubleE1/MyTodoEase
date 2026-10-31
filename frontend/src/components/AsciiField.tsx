import { useEffect, useRef } from 'react';
import { motionReduced } from '../lib/motion';

/**
 * A field of text characters for page backgrounds (after the hero of shadcn.io/background, rebuilt here on a 2D
 * canvas). A warped noise drifts very slowly; its tone picks a mark per cell, ` · : +`, shaded with an ordered
 * dither so areas blend instead of edging, and from half tone up the cells spell `word` along each row. Moving
 * the mouse leaves a wake that swirls and fades: it lifts letters out of the dots, and the freshest part flickers
 * through symbols. The field fades in with a short scramble, stays clear round `clearOf` elements (text on top),
 * and fades out at the top and bottom.
 *
 * About 20 frames a second at rest and 30 while a wake is moving; it pauses while the window is hidden, and with
 * Reduce motion on (OS or Settings) it is a still picture with no wake.
 */
export function AsciiField({
  word,
  clearOf,
  className,
}: {
  word: string;
  /** CSS selector of elements (text) the field stays clear of, so they remain readable. */
  clearOf?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // ---- Glyphs: empty, the three marks, the word's letters, and the symbols the wake flickers through ----
    const MARKS = [' ', '·', ':', '+'];
    const SCRAMBLE = [...'#%&*=/<>?$@'];
    const letters = [...(word.toUpperCase().replace(/[^A-Z0-9#-]+/g, '') || 'A')];
    const glyphs = [...MARKS, ...new Set(letters), ...SCRAMBLE];
    const glyphOf = new Map(glyphs.map((g, i) => [g, i]));
    const wordIndex = letters.map((l) => glyphOf.get(l) ?? 0);
    const scrambleAt = glyphs.length - SCRAMBLE.length;
    /** The atlas holds every glyph at this many strengths, so a frame never changes canvas state. */
    const SHADES = 16;

    const IDLE_MS = 50;
    const WAKE_MS = 33;
    const REVEAL_S = 1.4;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let cellW = 7;
    let cellH = 11;
    let cols = 0;
    let rows = 0;
    let ink = '#e8e8e8';
    let opacity = 0.92;
    let clear: { left: number; top: number; right: number; bottom: number }[] = [];
    const atlas = document.createElement('canvas');
    const atlasCtx = atlas.getContext('2d');

    // ---- The wake: a coarse grid (one point per 2 x 2 cells) of velocity and dye ----
    let gw = 0;
    let gh = 0;
    let vx = new Float32Array(0);
    let vy = new Float32Array(0);
    let dye = new Float32Array(0);
    let scratch = new Float32Array(0);
    let wakeUntil = 0;
    let lastPointer: { x: number; y: number; at: number } | null = null;

    // ---- The drift: noise sampled every few cells and blended in between ----
    const STEP_X = 3;
    const STEP_Y = 2;
    let tones = new Float32Array(0);

    const start = performance.now();
    let time = 0;
    let clock = 0;
    let lastFrame = 0;
    let frame = 0;

    const measureClear = () => {
      if (!clearOf) return;
      const origin = canvas.getBoundingClientRect();
      const next = [...document.querySelectorAll(clearOf)].map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top };
      });
      // Only a real change in layout means working the cells out again.
      if (JSON.stringify(next) === JSON.stringify(clear)) return;
      clear = next;
      shown = new Int32Array(0);
    };

    const readTheme = () => {
      const root = document.documentElement;
      ink = getComputedStyle(root).getPropertyValue('--text').trim() || '#e8e8e8';
      opacity = root.dataset.theme === 'dark' ? 0.92 : 0.9;
    };

    /** Each glyph drawn once per strength: row = strength, column = glyph. */
    const buildAtlas = () => {
      if (!atlasCtx) return;
      const cw = Math.round(cellW * dpr);
      const ch = Math.round(cellH * dpr);
      atlas.width = cw * glyphs.length;
      atlas.height = ch * SHADES;
      atlasCtx.clearRect(0, 0, atlas.width, atlas.height);
      atlasCtx.font = `500 ${Math.max(1, 0.74 * ch)}px ui-monospace, "SF Mono", Consolas, "Cascadia Mono", monospace`;
      atlasCtx.textAlign = 'center';
      atlasCtx.textBaseline = 'alphabetic';
      atlasCtx.fillStyle = ink;
      const m = atlasCtx.measureText('M');
      const ascent = m.actualBoundingBoxAscent || 0.74 * ch * 0.7;
      const baseline = (ch + ascent - (m.actualBoundingBoxDescent || 0)) / 2;
      for (let s = 0; s < SHADES; s++) {
        atlasCtx.globalAlpha = ((s + 1) / SHADES) * opacity;
        glyphs.forEach((glyph, i) => {
          if (glyph === ' ') return;
          const cx = i * cw + cw / 2;
          const w = atlasCtx.measureText(glyph).width;
          atlasCtx.save();
          atlasCtx.beginPath();
          atlasCtx.rect(i * cw, s * ch, cw, ch);
          atlasCtx.clip();
          atlasCtx.translate(cx, s * ch + baseline);
          // Wide glyphs are squeezed into the cell rather than cut.
          if (w > cw * 0.96) atlasCtx.scale((cw * 0.96) / w, 1);
          atlasCtx.fillText(glyph, 0, 0);
          atlasCtx.restore();
        });
      }
      atlasCtx.globalAlpha = 1;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      // Cap the pixel count so a 4K window does not cost four times as much.
      dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8294400 / Math.max(1, width * height)));
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      cellH = Math.max(2, Math.round(11 * dpr)) / dpr;
      cellW = Math.max(2, Math.round(0.62 * cellH * dpr)) / dpr;
      cols = Math.ceil(width / cellW);
      rows = Math.ceil(height / cellH);
      gw = Math.ceil(cols / 2) + 1;
      gh = Math.ceil(rows / 2) + 1;
      vx = new Float32Array(gw * gh);
      vy = new Float32Array(gw * gh);
      dye = new Float32Array(gw * gh);
      scratch = new Float32Array(gw * gh);
      buildAtlas();
      shown = new Int32Array(0);
    };

    /** Tone of the drifting pattern on the coarse sample grid (domain-warped noise). */
    const sampleTones = () => {
      const sCols = Math.ceil(cols / STEP_X) + 2;
      const sRows = Math.ceil(rows / STEP_Y) + 2;
      if (tones.length !== sCols * sRows) tones = new Float32Array(sCols * sRows);
      const aspect = width / Math.max(1, height);
      const scale = window.innerWidth < 760 ? 1.6 : 1;
      const t = time * 0.05;
      for (let sy = 0; sy < sRows; sy++) {
        const v = (sy * STEP_Y + 0.5) / rows;
        for (let sx = 0; sx < sCols; sx++) {
          const u = (sx * STEP_X + 0.5) / cols;
          const px = (u - 0.5) * aspect * scale;
          const py = (v - 0.5) * scale;
          const qx = fbm(px * 1.1, py * 1.1 + t);
          const qy = fbm(px * 1.1 + 5.2, py * 1.1 + 1.3 - t);
          tones[sy * sCols + sx] = smoothstep(0.32, 0.68, fbm(px * 1.4 + qx * 1.5 + t * 0.7, py * 1.4 + qy * 1.5 - t * 0.4));
        }
      }
      return sCols;
    };

    /** Advance the wake: carry dye and velocity along the velocity, then let both fade. */
    const stepWake = (dt: number) => {
      const fadeV = Math.exp(-1.9 * dt);
      const fadeD = Math.exp(-3.2 * dt);
      const advect = (field: Float32Array, fade: number) => {
        for (let y = 1; y < gh - 1; y++) {
          for (let x = 1; x < gw - 1; x++) {
            const i = y * gw + x;
            const px = Math.min(gw - 1.5, Math.max(0.5, x - vx[i] * dt));
            const py = Math.min(gh - 1.5, Math.max(0.5, y - vy[i] * dt));
            const ix = Math.floor(px);
            const iy = Math.floor(py);
            const fx = px - ix;
            const fy = py - iy;
            const j = iy * gw + ix;
            const top = field[j] + (field[j + 1] - field[j]) * fx;
            const bottom = field[j + gw] + (field[j + gw + 1] - field[j + gw]) * fx;
            scratch[i] = (top + (bottom - top) * fy) * fade;
          }
        }
        field.set(scratch);
      };
      advect(dye, fadeD);
      advect(vx, fadeV);
      advect(vy, fadeV);
    };

    /**
     * Stir the wake along the mouse's path: dye where it passed, pushed the way it went. Each stamp is an oval
     * stretched along the movement, with a slight twist and ragged edges, so the wake curls like smoke rather
     * than printing circles; the faster the mouse, the wider it is.
     */
    const splat = (x0: number, y0: number, x1: number, y1: number, dt: number) => {
      // Grid steps are wider apart down than across; `a` turns a step down into steps across.
      const a = cellH / cellW;
      const gx0 = x0 / (cellW * 2);
      const gy0 = y0 / (cellH * 2);
      const dx = x1 / (cellW * 2) - gx0;
      const dy = y1 / (cellH * 2) - gy0;
      const length = Math.hypot(dx, dy * a);
      if (length === 0) return;
      const dirX = dx / length;
      const dirY = (dy * a) / length;
      const speed = Math.min(80, length / Math.max(dt, 1 / 120));
      // A slow drag leaves a thin line, a flick a broad swirl.
      const R = 0.9 + 3.8 * smoothstep(2, 60, speed);
      const steps = Math.max(1, Math.ceil(length));
      for (let s = 0; s <= steps; s++) {
        const cx = gx0 + (dx * s) / steps;
        const cy = gy0 + (dy * s) / steps;
        for (let y = Math.max(1, Math.floor(cy - (R * 3) / a)); y <= Math.min(gh - 2, Math.ceil(cy + (R * 3) / a)); y++) {
          for (let x = Math.max(1, Math.floor(cx - R * 3)); x <= Math.min(gw - 2, Math.ceil(cx + R * 3)); x++) {
            const ex = x - cx;
            const ey = (y - cy) * a;
            const u = (ex * dirX + ey * dirY) / R; // along the movement
            const r = (ey * dirX - ex * dirY) / R; // across it
            const falloff = Math.exp(-u * u * 0.65 - r * r * 1.7);
            if (falloff < 0.01) continue;
            // Ragged, changing edges instead of a clean oval.
            const ragged = 0.55 + 0.9 * noise2(x * 0.7 + time * 2.1, y * 0.7 * a - time * 1.3);
            const w = (falloff * ragged) / steps;
            const i = y * gw + x;
            dye[i] = 1 - (1 - dye[i]) * Math.exp(-w * 3.5);
            // Mostly along the movement, with a twist that grows away from the centre line: the wake curls.
            const side = 1 - r * r * 0.55;
            const twist = u * r * 0.7;
            vx[i] += (dirX * side - dirY * twist) * speed * w * 0.6;
            vy[i] += ((dirY * side + dirX * twist) * speed * w * 0.6) / a;
          }
        }
      }
    };

    const wakeAt = (col: number, row: number) => {
      const x = Math.min(gw - 1.001, col / 2);
      const y = Math.min(gh - 1.001, row / 2);
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      const i = iy * gw + ix;
      const top = dye[i] + (dye[i + 1] - dye[i]) * fx;
      const bottom = dye[i + gw] + (dye[i + gw + 1] - dye[i + gw]) * fx;
      return top + (bottom - top) * fy;
    };

    /**
     * Per cell, how much of the field shows: faded at the top and foot, and clear round the `clearOf` elements.
     * It only changes with the layout, so it is worked out then rather than every frame.
     */
    let keepMap = new Float32Array(0);
    /** Per row, where the word starts, so the letters never line up in columns. */
    let rowOffset = new Int32Array(0);
    /** What each cell shows now (glyph and strength, 0 for nothing; -1 unknown): only changed cells are redrawn. */
    let shown = new Int32Array(0);

    const layoutCells = () => {
      keepMap = new Float32Array(cols * rows);
      rowOffset = new Int32Array(rows);
      for (let row = 0; row < rows; row++) {
        const y = row * cellH;
        const v = (row + 0.5) / rows;
        const edgeFade = smoothstep(0, 0.16, v) * smoothstep(0, 0.16, 1 - v);
        rowOffset[row] = Math.floor(hash2(row, 7.13) * letters.length);
        for (let col = 0; col < cols; col++) {
          const x = col * cellW;
          let keep = edgeFade;
          for (const r of clear) {
            // Distance outside the element's box: clear inside, rising over 48px around it.
            const ox = Math.max(r.left - x, 0, x - r.right);
            const oy = Math.max(r.top - y, 0, y - r.bottom);
            keep *= smoothstep(0, 48, Math.hypot(ox, oy));
          }
          keepMap[row * cols + col] = keep;
        }
      }
      shown = new Int32Array(cols * rows).fill(-1);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    const draw = () => {
      if (shown.length !== cols * rows) layoutCells();
      const sCols = sampleTones();
      const elapsed = (performance.now() - start) / 1000;
      const reduced = motionReduced();
      const reveal = reduced ? 1 : Math.min(1, elapsed / REVEAL_S);
      const intro = reduced ? 0 : Math.max(0, 1 - elapsed / (REVEAL_S * 0.9)) * 0.85;
      const wakeOn = !reduced && performance.now() < wakeUntil;
      const flicker = Math.floor(clock * 10);
      const cw = Math.round(cellW * dpr);
      const ch = Math.round(cellH * dpr);

      for (let row = 0; row < rows; row++) {
        const py = Math.round(row * cellH * dpr);
        const sy = Math.floor(row / STEP_Y);
        const ky = row / STEP_Y - sy;
        const offset = rowOffset[row];
        for (let col = 0; col < cols; col++) {
          const cell = row * cols + col;
          const keep = keepMap[cell];
          let code = 0;
          if (keep > 0.001) {
            const sx = Math.floor(col / STEP_X);
            const kx = col / STEP_X - sx;
            const i = sy * sCols + sx;
            const top = tones[i] + (tones[i + 1] - tones[i]) * kx;
            const bottom = tones[i + sCols] + (tones[i + sCols + 1] - tones[i + sCols]) * kx;
            let tone = (top + (bottom - top) * ky) * reveal;

            let k = 0;
            if (wakeOn) {
              // The wake raises the tone: letters out of the dots.
              k = Math.min(1, Math.max(0, (wakeAt(col, row) * 0.9) / 0.38));
              k = k * k * (3 - 2 * k);
              tone += (1 - tone) * k * 0.92;
            }
            tone *= keep;
            k *= keep;

            // Ordered dither for the marks; letters from a little under half tone, in runs along the row.
            const level = tone * 7;
            const tier = level >= 3.5 ? 4 : Math.min(3, Math.max(0, Math.floor(level + (BAYER[(col & 3) + (row & 3) * 4] + 0.5) / 16)));
            if (tier > 0) {
              let glyph = tier < 4 ? tier : wordIndex[(col + offset) % letters.length];
              if (tier === 4 && hash2(col + 3.1, row + 8.7) < Math.max(k * 0.9 - 0.2, intro)) {
                glyph = scrambleAt + Math.floor(hash2(col + flicker * 0.71, row + flicker * 0.37) * SCRAMBLE.length);
              }
              const strength = tier < 4 ? 0.32 + tier * 0.07 : 0.58 + 0.32 * tone;
              const alpha = strength + (1 - strength) * k;
              const shade = Math.min(SHADES - 1, Math.max(0, Math.round(alpha * SHADES) - 1));
              code = 1 + glyph * SHADES + shade;
            }
          }
          if (code === shown[cell]) continue;
          shown[cell] = code;
          const px = Math.round(col * cellW * dpr);
          ctx.clearRect(px, py, cw, ch);
          if (code > 0) {
            const glyph = Math.floor((code - 1) / SHADES);
            const shade = (code - 1) % SHADES;
            ctx.drawImage(atlas, glyph * cw, shade * ch, cw, ch, px, py, cw, ch);
          }
        }
      }
    };

    const loop = (now: number) => {
      frame = 0;
      if (document.hidden) return;
      const waking = now < wakeUntil;
      const pace = waking ? WAKE_MS : IDLE_MS;
      if (now - lastFrame >= pace) {
        const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000 || 0.016);
        lastFrame = now;
        time += dt;
        if (waking) {
          stepWake(dt);
          clock += dt;
        }
        if (now - start < REVEAL_S * 1000) clock += dt;
        draw();
      }
      if (!motionReduced()) frame = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(loop);
    };

    readTheme();
    resize();
    measureClear();
    draw();
    kick();
    // Content can reflow (fonts loading, data arriving); look again now and then.
    const remeasure = window.setInterval(measureClear, 1000);

    const sizes = new ResizeObserver(() => {
      resize();
      measureClear();
      draw();
    });
    sizes.observe(canvas);
    // Theme or Reduce motion switched: new ink, and start or stop the animation.
    const settings = new MutationObserver(() => {
      readTheme();
      buildAtlas();
      shown = new Int32Array(0);
      draw();
      kick();
    });
    settings.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-reduce-motion'] });
    const onVisibility = () => !document.hidden && kick();
    document.addEventListener('visibilitychange', onVisibility);

    // The canvas sits under the content, so the pointer is followed on the page.
    const onMove = (event: PointerEvent) => {
      if (motionReduced()) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const now = performance.now();
      if (x < 0 || y < 0 || x > width || y > height) {
        lastPointer = null;
        return;
      }
      if (lastPointer) splat(lastPointer.x, lastPointer.y, x, y, (now - lastPointer.at) / 1000);
      lastPointer = { x, y, at: now };
      wakeUntil = now + 2500;
      kick();
    };
    const onLeave = () => {
      lastPointer = null;
    };
    window.addEventListener('pointermove', onMove);
    document.addEventListener('pointerleave', onLeave);

    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(remeasure);
      sizes.disconnect();
      settings.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [word, clearOf]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

/** A 4 x 4 ordered-dither matrix: neighbouring cells switch marks at different tones. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** A repeatable pseudo-random value in [0, 1) for a point (integer or not). */
function hash2(x: number, y: number): number {
  let h = Math.imul(Math.floor(x * 1013) | 0, 374761393) ^ Math.imul(Math.floor(y * 1009) | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function lattice(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 2D value noise in [0, 1). */
function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = lattice(xi, yi);
  const b = lattice(xi + 1, yi);
  const c = lattice(xi, yi + 1);
  const d = lattice(xi + 1, yi + 1);
  const top = a + (b - a) * u;
  return top + (c + (d - c) * u - top) * v;
}

/** Four octaves of value noise. */
function fbm(x: number, y: number): number {
  let value = 0;
  let amplitude = 0.5;
  for (let i = 0; i < 4; i++) {
    value += amplitude * noise2(x, y);
    x = x * 2.02 + 1.7;
    y = y * 2.02 + 9.2;
    amplitude *= 0.5;
  }
  return value;
}
