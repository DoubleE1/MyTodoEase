import { useEffect, useRef } from 'react';
import { motionReduced } from '../lib/motion';

/**
 * A mouse trail for the dot-halo background: the dots the pointer passes light up and swell in the brand
 * gradient, then fade out behind it like a comet's tail. It draws on the same 14px grid as the halo's dots
 * (`.main-art`), so the lit dots sit exactly on them. The faster the mouse, the wider the trail. Nothing runs
 * while the mouse is still; Reduce motion (OS or Settings) turns it off.
 */
export function DotTrail({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    /** The halo's dot spacing; dot centres sit half a step in. */
    const GRID = 14;
    /** Seconds for a lit dot to fade to about a third. */
    const FADE_S = 0.45;

    let cols = 0;
    let rows = 0;
    let width = 0;
    let height = 0;
    let heat = new Float32Array(0);
    let colours: string[] = [];
    let last: { x: number; y: number; at: number } | null = null;
    let frame = 0;
    let lastFrame = 0;

    const readColours = () => {
      const css = getComputedStyle(document.documentElement);
      const stops = ['--brand-1', '--brand-2', '--brand-3'].map((name, i) => css.getPropertyValue(name).trim() || ['#4f96ff', '#8a5cff', '#ff5fa8'][i]);
      // A colour per column across the page, from the first brand colour to the last.
      colours = Array.from({ length: Math.max(1, cols) }, (_, c) => mixStops(stops, c / Math.max(1, cols - 1)));
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(width / GRID);
      rows = Math.ceil(height / GRID);
      heat = new Float32Array(cols * rows);
      readColours();
    };

    /** Light the dots around a point; `radius` in grid steps. */
    const stamp = (x: number, y: number, radius: number) => {
      const cx = x / GRID - 0.5;
      const cy = y / GRID - 0.5;
      const reach = Math.ceil(radius);
      for (let r = Math.max(0, Math.floor(cy) - reach); r <= Math.min(rows - 1, Math.ceil(cy) + reach); r++) {
        for (let c = Math.max(0, Math.floor(cx) - reach); c <= Math.min(cols - 1, Math.ceil(cx) + reach); c++) {
          const d = Math.hypot(c - cx, r - cy) / radius;
          if (d >= 1) continue;
          const i = r * cols + c;
          heat[i] = Math.max(heat[i], 1 - d * d);
        }
      }
    };

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, width, height);
      const fade = Math.exp(-dt / FADE_S);
      let lit = false;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const h = heat[i];
          if (h < 0.02) {
            heat[i] = 0;
            continue;
          }
          lit = true;
          ctx.globalAlpha = Math.min(1, h * 1.1);
          ctx.fillStyle = colours[c];
          ctx.beginPath();
          // Lit dots swell from the halo's 1.1px to about 3.4px.
          ctx.arc(c * GRID + GRID / 2, r * GRID + GRID / 2, 1.1 + 2.3 * h, 0, Math.PI * 2);
          ctx.fill();
          heat[i] = h * fade;
        }
      }
      ctx.globalAlpha = 1;
      return lit;
    };

    const loop = (now: number) => {
      frame = 0;
      const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000 || 1 / 60);
      lastFrame = now;
      if (draw(dt) && !document.hidden) frame = requestAnimationFrame(loop);
      else lastFrame = 0;
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(loop);
    };

    resize();
    const sizes = new ResizeObserver(resize);
    sizes.observe(canvas);
    const theme = new MutationObserver(readColours);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // Light every dot along the way from the last point, so a fast move leaves an unbroken trail.
    const onMove = (event: PointerEvent) => {
      if (motionReduced()) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const now = performance.now();
      if (x < 0 || y < 0 || x > width || y > height) {
        last = null;
        return;
      }
      const from = last ?? { x, y, at: now };
      const distance = Math.hypot(x - from.x, y - from.y);
      const speed = distance / Math.max(1, now - from.at); // px per ms
      const radius = 1.6 + Math.min(2.4, speed * 1.2);
      const steps = Math.max(1, Math.ceil(distance / (GRID * 0.5)));
      for (let s = 1; s <= steps; s++) {
        const k = s / steps;
        stamp(from.x + (x - from.x) * k, from.y + (y - from.y) * k, radius);
      }
      last = { x, y, at: now };
      kick();
    };
    const onLeave = () => {
      last = null;
    };
    window.addEventListener('pointermove', onMove);
    document.addEventListener('pointerleave', onLeave);

    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      theme.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

/** A colour along evenly spaced #rrggbb stops, at t from 0 to 1. */
function mixStops(stops: string[], t: number): string {
  const rgb = stops.map((s) => {
    const hex = /^#([0-9a-f]{6})$/i.exec(s);
    return hex ? [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) : [138, 92, 255];
  });
  const x = Math.min(1, Math.max(0, t)) * (rgb.length - 1);
  const i = Math.min(rgb.length - 2, Math.floor(x));
  const k = x - i;
  const [r, g, b] = rgb[i].map((c, j) => Math.round(c + (rgb[i + 1][j] - c) * k));
  return `rgb(${r}, ${g}, ${b})`;
}
