import { useEffect, useRef } from 'react';
import { motionReduced } from '../lib/motion';

/**
 * A field of text characters for page backgrounds. Faint dots cover the area and thicken (`. : - + *`) where a
 * slowly drifting cloud is dense; the densest parts spell `word` along each row. Moving the mouse scrambles the
 * cells it passes into random glyphs, leaving a trail that settles back within a second. The middle is lighter,
 * and `clearOf` elements (text on top) keep a clear margin so they stay readable.
 *
 * Drawn on a canvas at about 20 frames a second from a pre-drawn glyph atlas; it pauses while the window is
 * hidden, and with Reduce motion on (OS or Settings) it is a still picture with no trail.
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

    const LINE_PX = 13;
    const FRAME_MS = 50;
    const FONT = `11px ui-monospace, Consolas, 'Cascadia Mono', monospace`;
    const letters = word.toUpperCase().replace(/\s+/g, '') || 'A';
    // Characters by density, faint to strong; above the last level a cell shows a letter of the word.
    const LEVELS = ['.', ':', '-', '+', '*'];
    // What the mouse trail scrambles cells into.
    const GLITCH = `$%&#@?/\\<>=+~^!*${letters}`;
    /** How fast a scrambled cell settles back (share of its heat kept per frame). */
    const COOL = 0.86;

    let cols = 0;
    let rows = 0;
    let cellW = 7;
    let dpr = 1;
    let colors = readColors();
    /** How scrambled each cell is, 0 to 1. */
    let heat = new Float32Array(0);
    let lastCell: { col: number; row: number } | null = null;
    /** Areas (canvas pixels) kept nearly empty: the `clearOf` elements, padded. */
    let clear: { left: number; top: number; right: number; bottom: number }[] = [];
    let frame = 0;
    let last = 0;
    const start = performance.now();

    const measureClear = () => {
      if (!clearOf) return;
      const origin = canvas.getBoundingClientRect();
      clear = [...document.querySelectorAll(clearOf)].map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left - origin.left - 16, top: r.top - origin.top - 10, right: r.right - origin.left + 16, bottom: r.bottom - origin.top + 10 };
      });
    };

    // Every character is drawn once into an atlas (one cell each) and copied into place each frame, which is
    // several times cheaper than drawing text for thousands of cells. Row 0: the density symbols in grey, at
    // rising strength; row 1: letters and glitch glyphs in the accent colour.
    const atlas = document.createElement('canvas');
    const atlasCtx = atlas.getContext('2d');
    const accentGlyphs = [...new Set(GLITCH)];
    const accentIndex = new Map(accentGlyphs.map((g, i) => [g, i]));

    const buildAtlas = () => {
      if (!atlasCtx) return;
      const cw = Math.ceil(cellW * dpr);
      const lh = Math.ceil(LINE_PX * dpr);
      atlas.width = cw * Math.max(LEVELS.length, accentGlyphs.length);
      atlas.height = lh * 2;
      atlasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      atlasCtx.clearRect(0, 0, atlas.width, atlas.height);
      atlasCtx.font = FONT;
      atlasCtx.textBaseline = 'top';
      atlasCtx.fillStyle = colors.symbol;
      LEVELS.forEach((glyph, i) => {
        atlasCtx.globalAlpha = 0.3 + (i / (LEVELS.length - 1)) * 0.7;
        atlasCtx.fillText(glyph, (i * cw) / dpr, 0);
      });
      atlasCtx.globalAlpha = 1;
      atlasCtx.fillStyle = colors.letter;
      accentGlyphs.forEach((glyph, i) => atlasCtx.fillText(glyph, (i * cw) / dpr, LINE_PX));
    };

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = FONT;
      cellW = Math.ceil(ctx.measureText('M').width) + 1;
      cols = Math.ceil(width / cellW);
      rows = Math.ceil(height / LINE_PX);
      heat = new Float32Array(cols * rows);
      buildAtlas();
    };

    // The cloud is smooth, so it is sampled every few cells and blended in between: far less maths per frame.
    const STEP_X = 3;
    const STEP_Y = 2;
    let samples = new Float32Array(0);

    const draw = (now: number) => {
      // Very slow drift; the liveliness comes from the mouse trail.
      const t = ((now - start) / 1000) * 0.04;
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      const sCols = Math.ceil(cols / STEP_X) + 2;
      const sRows = Math.ceil(rows / STEP_Y) + 2;
      if (samples.length !== sCols * sRows) samples = new Float32Array(sCols * sRows);
      for (let sy = 0; sy < sRows; sy++) {
        for (let sx = 0; sx < sCols; sx++) {
          // Rows are taller than columns are wide, so the cloud is sampled at a matching scale.
          samples[sy * sCols + sx] = fbm(sx * STEP_X * 0.042, sy * STEP_Y * 0.075, t);
        }
      }

      const cw = Math.ceil(cellW * dpr);
      const lh = Math.ceil(LINE_PX * dpr);
      const w = cw / dpr;
      const h = lh / dpr;
      for (let row = 0; row < rows; row++) {
        const fy = row / STEP_Y;
        const sy = Math.floor(fy);
        const ky = fy - sy;
        const dy = (row / rows - 0.42) * 2;
        const y = row * LINE_PX;
        for (let col = 0; col < cols; col++) {
          const x = col * cellW;
          const cell = row * cols + col;

          // A scrambled cell from the mouse trail: a random glyph, fading as it cools.
          const hot = heat[cell];
          if (hot > 0.06) {
            heat[cell] = hot * COOL;
            const g = (Math.random() * accentGlyphs.length) | 0;
            ctx.globalAlpha = Math.min(1, 0.25 + hot);
            ctx.drawImage(atlas, g * cw, lh, cw, lh, x, y, w, h);
            ctx.globalAlpha = 1;
            continue;
          }
          if (hot > 0) heat[cell] = 0;

          const fx = col / STEP_X;
          const sx = Math.floor(fx);
          const kx = fx - sx;
          const i = sy * sCols + sx;
          const top = samples[i] + (samples[i + 1] - samples[i]) * kx;
          const bottom = samples[i + sCols] + (samples[i + sCols + 1] - samples[i + sCols]) * kx;
          // The cloud: lighter in the middle, strongest towards the edges.
          const dx = (col / cols - 0.5) * 2;
          let v = smoothstep(0.38, 0.74, top + (bottom - top) * ky);
          v *= 0.3 + 0.7 * smoothstep(0.2, 0.95, Math.sqrt(dx * dx * 0.85 + dy * dy));
          let inClear = false;
          for (const r of clear) {
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) inClear = true;
          }
          if (inClear) continue;
          if (v >= 0.72) {
            // Letters run along the row, shifted per row, so the word reads across the dense patches.
            const g = accentIndex.get(letters[(col + row * 3) % letters.length]) ?? 0;
            ctx.drawImage(atlas, g * cw, lh, cw, lh, x, y, w, h);
          } else {
            // Outside the cloud, a faint dot on every other cell: the grid shows through everywhere.
            const level = v < 0.1 ? ((col + row) & 1 ? -1 : 0) : Math.min(LEVELS.length - 1, Math.floor((v / 0.72) * LEVELS.length));
            if (level >= 0) ctx.drawImage(atlas, level * cw, 0, cw, lh, x, y, w, h);
          }
        }
      }
    };

    const loop = (now: number) => {
      frame = 0;
      if (document.hidden) return;
      if (now - last >= FRAME_MS) {
        last = now;
        draw(now);
      }
      if (!motionReduced()) frame = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(loop);
    };

    /** Scramble the cells around a point (an ellipse: cells are taller than wide). */
    const stamp = (col: number, row: number) => {
      const RX = 3;
      const RY = 1.6;
      for (let r = Math.floor(row - RY); r <= Math.ceil(row + RY); r++) {
        if (r < 0 || r >= rows) continue;
        for (let c = Math.floor(col - RX); c <= Math.ceil(col + RX); c++) {
          if (c < 0 || c >= cols) continue;
          const d = Math.sqrt(((c - col) / RX) ** 2 + ((r - row) / RY) ** 2);
          if (d >= 1) continue;
          const cell = r * cols + c;
          heat[cell] = Math.max(heat[cell], 1 - d * 0.7);
        }
      }
    };

    resize();
    measureClear();
    draw(performance.now());
    kick();
    // Content can reflow (fonts loading, data arriving); look again now and then.
    const remeasure = window.setInterval(measureClear, 1000);

    const sizes = new ResizeObserver(() => {
      resize();
      measureClear();
      draw(performance.now());
    });
    sizes.observe(canvas);
    // Theme or Reduce motion switched: new colours, and start or stop the animation.
    const settings = new MutationObserver(() => {
      colors = readColors();
      buildAtlas();
      draw(performance.now());
      kick();
    });
    settings.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-reduce-motion'] });
    const onVisibility = () => !document.hidden && kick();
    document.addEventListener('visibilitychange', onVisibility);

    // The canvas sits under the content, so the pointer is followed on the page. Fast moves fill the gap
    // between two events, so the trail stays continuous.
    const onMove = (event: PointerEvent) => {
      if (motionReduced()) return;
      const rect = canvas.getBoundingClientRect();
      const col = (event.clientX - rect.left) / cellW;
      const row = (event.clientY - rect.top) / LINE_PX;
      if (col < -4 || row < -2 || col > cols + 4 || row > rows + 2) {
        lastCell = null;
        return;
      }
      const from = lastCell ?? { col, row };
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(col - from.col) / 2, Math.abs(row - from.row))));
      for (let s = 1; s <= steps; s++) {
        const k = s / steps;
        stamp(from.col + (col - from.col) * k, from.row + (row - from.row) * k);
      }
      lastCell = { col, row };
      kick();
    };
    const onLeave = () => {
      lastCell = null;
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

/** Symbol colour (soft grey) and letter colour (the accent) for the current theme. */
function readColors() {
  const style = getComputedStyle(document.documentElement);
  const dark = document.documentElement.dataset.theme === 'dark';
  return {
    symbol: dark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(30, 30, 40, 0.26)',
    letter: style.getPropertyValue('--accent-text').trim() || (dark ? '#a79bff' : '#5b4be0'),
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** A repeatable pseudo-random value in [0, 1) for a lattice point. */
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 3D value noise in [0, 1): x and y across the grid, z is time. Written out flat: it runs thousands of times a frame. */
function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const a = hash3(xi, yi, zi);
  const b = hash3(xi + 1, yi, zi);
  const c = hash3(xi, yi + 1, zi);
  const d = hash3(xi + 1, yi + 1, zi);
  const e = hash3(xi, yi, zi + 1);
  const f = hash3(xi + 1, yi, zi + 1);
  const g = hash3(xi, yi + 1, zi + 1);
  const h = hash3(xi + 1, yi + 1, zi + 1);
  const near = a + (b - a) * u + (c + (d - c) * u - (a + (b - a) * u)) * v;
  const far = e + (f - e) * u + (g + (h - g) * u - (e + (f - e) * u)) * v;
  return near + (far - near) * w;
}

/** Two octaves: broad clouds with a little ragged detail at their edges. */
function fbm(x: number, y: number, z: number): number {
  return noise3(x, y, z) * 0.68 + noise3(x * 2.3 + 17.1, y * 2.3 + 5.3, z * 1.6) * 0.32;
}
