import { useEffect, useRef } from 'react';
import { motionReduced } from '../lib/motion';

/**
 * A glowing light-trail that follows the mouse, after the "chromatic wave" shader: a smooth curve with a white-hot
 * core, a soft glow, and rainbow edges where its red, green and blue copies sit slightly apart (warm on one side,
 * blue on the other), the split widening towards the tail as it thins and fades.
 *
 * Drawn by stamping soft glow dots closely along the smoothed path and adding their light together, which gives
 * the same bright-centre, long-falloff profile as the shader. In the light theme, where added light would vanish
 * against white, it is a softer glow in the brand colours. Nothing runs once the trail has faded; Reduce motion
 * (OS or Settings) turns it off.
 */
export function ChromaTrail({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    /** How long a point of the path stays, in ms. */
    const LIFE_MS = 900;
    /** Spacing of the glow stamps along the path, in px. */
    const STEP = 3;
    /** Glow radius at the head, in px. */
    const RADIUS = 38;

    type Point = { x: number; y: number; at: number };
    let points: Point[] = [];
    let width = 0;
    let height = 0;
    let dark = true;
    let frame = 0;
    /** Pre-drawn glow dots, one per colour. */
    let sprites: HTMLCanvasElement[] = [];

    /** A soft dot: bright centre, long falloff (about 1/distance, like the shader's glow). */
    const glowSprite = (rgb: [number, number, number]) => {
      const size = 128;
      const sprite = document.createElement('canvas');
      sprite.width = sprite.height = size;
      const s = sprite.getContext('2d');
      if (!s) return sprite;
      const g = s.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      const [r, gr, b] = rgb;
      g.addColorStop(0, `rgba(${r}, ${gr}, ${b}, 1)`);
      g.addColorStop(0.08, `rgba(${r}, ${gr}, ${b}, 0.75)`);
      g.addColorStop(0.2, `rgba(${r}, ${gr}, ${b}, 0.28)`);
      g.addColorStop(0.45, `rgba(${r}, ${gr}, ${b}, 0.08)`);
      g.addColorStop(1, `rgba(${r}, ${gr}, ${b}, 0)`);
      s.fillStyle = g;
      s.fillRect(0, 0, size, size);
      return sprite;
    };

    const readTheme = () => {
      const root = document.documentElement;
      dark = root.dataset.theme === 'dark';
      if (dark) {
        // Red, green and blue light: white where all three overlap.
        sprites = [glowSprite([255, 70, 40]), glowSprite([70, 255, 110]), glowSprite([60, 110, 255])];
      } else {
        const css = getComputedStyle(root);
        const fallbacks: [number, number, number][] = [
          [255, 95, 168],
          [123, 77, 255],
          [63, 140, 255],
        ];
        sprites = ['--brand-3', '--brand-2', '--brand-1'].map((name, i) => glowSprite(hexRgb(css.getPropertyValue(name).trim(), fallbacks[i])));
      }
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /** The path again, a point every STEP px, then smoothed so mouse jitter does not show. */
    const smoothPath = (): Point[] => {
      const even: Point[] = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STEP));
        for (let k = 1; k <= n; k++) {
          const f = k / n;
          even.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, at: a.at + (b.at - a.at) * f });
        }
      }
      const W = 6;
      return even.map((p, i) => {
        let x = 0;
        let y = 0;
        let n = 0;
        for (let j = Math.max(0, i - W); j <= Math.min(even.length - 1, i + W); j++) {
          x += even[j].x;
          y += even[j].y;
          n++;
        }
        return { x: x / n, y: y / n, at: p.at };
      });
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, width, height);
      points = points.filter((p) => now - p.at < LIFE_MS);
      if (points.length < 2) return points.length > 0;
      const path = smoothPath();
      ctx.save();
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        const life = 1 - (now - p.at) / LIFE_MS; // 1 at the head, 0 at the end of the tail
        if (life <= 0) continue;
        // Across the path: the normal of the local direction, so the colours split to either side.
        const prev = path[Math.max(0, i - 4)];
        const next = path[Math.min(path.length - 1, i + 4)];
        let nx = -(next.y - prev.y);
        let ny = next.x - prev.x;
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl;
        ny /= nl;
        // The band stays bright and wide along most of its length, thinning only near the end of the tail;
        // the colours stay together (white) near the head and split towards the tail.
        const radius = RADIUS * (0.45 + 0.55 * life);
        const split = 1.5 + 6 * (1 - life) ** 1.5;
        ctx.globalAlpha = (dark ? 0.2 : 0.08) * Math.min(1, 0.2 + life * 1.1);
        sprites.forEach((sprite, channel) => {
          const shift = (channel - 1) * split;
          ctx.drawImage(sprite, p.x + nx * shift - radius, p.y + ny * shift - radius, radius * 2, radius * 2);
        });
      }
      ctx.restore();
      return true;
    };

    const loop = (now: number) => {
      frame = 0;
      if (draw(now) && !document.hidden) frame = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(loop);
    };

    readTheme();
    resize();
    const sizes = new ResizeObserver(resize);
    sizes.observe(canvas);
    const theme = new MutationObserver(readTheme);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    let pointerId = -1;
    const onMove = (event: PointerEvent) => {
      if (motionReduced()) return;
      // A different pointer (touch after mouse, a second pen) starts its own trail rather than joining this one.
      if (event.pointerId !== pointerId) {
        pointerId = event.pointerId;
        points = [];
      }
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const last = points[points.length - 1];
      // Points closer than 2px add nothing.
      if (last && Math.hypot(x - last.x, y - last.y) < 2) return;
      points.push({ x, y, at: performance.now() });
      if (points.length > 240) points.shift();
      kick();
    };
    window.addEventListener('pointermove', onMove);

    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      theme.disconnect();
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

function hexRgb(hex: string, fallback: [number, number, number]): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return fallback;
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}
