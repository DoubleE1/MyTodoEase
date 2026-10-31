import { useEffect, useRef } from 'react';
import { motionReduced } from '../lib/motion';

/**
 * A glowing ribbon that follows the mouse, after the "chromatic wave" shader (a sine line drawn once per colour
 * channel, slightly apart): the last ~0.7 s of the pointer's path is drawn as a line that waves along its length,
 * its red, green and blue copies drifting apart towards the tail, then fading out. The faster the mouse, the
 * bigger the wave. In the dark theme the channels add up to white where they meet; in the light theme (where
 * added light would vanish) it is drawn in the brand gradient instead.
 *
 * Nothing runs once the trail has faded; Reduce motion (OS or Settings) turns it off.
 */
export function ChromaTrail({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    /** How long a point of the path stays, in ms. */
    const LIFE_MS = 700;
    /** Wave: cycles per px along the trail, and how fast it travels. */
    const WAVE_FREQ = 0.045;
    const WAVE_SPEED = 7;

    type Point = { x: number; y: number; at: number; speed: number };
    let points: Point[] = [];
    let width = 0;
    let height = 0;
    let dark = true;
    let brand = ['#4f96ff', '#8a5cff', '#ff5fa8'];
    let frame = 0;
    const start = performance.now();

    const readTheme = () => {
      const root = document.documentElement;
      dark = root.dataset.theme === 'dark';
      const css = getComputedStyle(root);
      brand = ['--brand-1', '--brand-2', '--brand-3'].map((name, i) => css.getPropertyValue(name).trim() || brand[i]);
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

    /**
     * One copy of the ribbon: each point pushed sideways (across the path) by the travelling sine wave, the
     * wave and the channel's spread growing towards the tail.
     */
    /** The pointer's path again, a point every STEP px, so the wave bends smoothly whatever the mouse speed. */
    const STEP = 4;
    const resample = (): Point[] => {
      const out: Point[] = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STEP));
        for (let s = 1; s <= n; s++) {
          const k = s / n;
          out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, at: a.at + (b.at - a.at) * k, speed: a.speed + (b.speed - a.speed) * k });
        }
      }
      return out;
    };

    const ribbon = (now: number, spread: number, colour: string | CanvasGradient, smooth: Point[]) => {
      const t = (now - start) / 1000;
      const path: { x: number; y: number; life: number }[] = [];
      let along = 0;
      for (let i = 0; i < smooth.length; i++) {
        const p = smooth[i];
        const life = 1 - (now - p.at) / LIFE_MS; // 1 at the head, 0 at the end of the tail
        // Direction from a few points either side, so the sideways push does not jitter.
        const prev = smooth[Math.max(0, i - 3)];
        const next = smooth[Math.min(smooth.length - 1, i + 3)];
        if (i > 0) along += Math.hypot(p.x - smooth[i - 1].x, p.y - smooth[i - 1].y);
        // Across the path: the normal of the local direction.
        let nx = -(next.y - prev.y);
        let ny = next.x - prev.x;
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl;
        ny /= nl;
        const amp = (4 + Math.min(26, p.speed * 18)) * (1 - life * 0.7);
        // Each channel waves at a slightly different rate, so they cross and split like light through a prism.
        const wave = Math.sin(along * WAVE_FREQ * (1 + spread * 0.18) - t * WAVE_SPEED + spread * 0.6) * amp;
        const shift = spread * 14 * (1 - life);
        path.push({ x: p.x + nx * (wave + shift), y: p.y + ny * (wave + shift), life });
      }
      // Drawn in runs of a few points, so each run can thin out and fade with its age.
      ctx.strokeStyle = colour;
      ctx.shadowColor = typeof colour === 'string' ? colour : brand[1];
      const RUN = 4;
      for (let i = 0; i < path.length - 1; i += RUN) {
        const end = Math.min(path.length - 1, i + RUN);
        const life = Math.max(0, (path[i].life + path[end].life) / 2);
        ctx.globalAlpha = life * (dark ? 0.9 : 0.75);
        ctx.lineWidth = 0.6 + 2.4 * life;
        ctx.shadowBlur = 6 + 10 * life;
        ctx.beginPath();
        ctx.moveTo(path[i].x, path[i].y);
        for (let j = i + 1; j <= end; j++) ctx.lineTo(path[j].x, path[j].y);
        ctx.stroke();
      }
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, width, height);
      points = points.filter((p) => now - p.at < LIFE_MS);
      if (points.length < 2) return points.length > 0;
      ctx.save();
      ctx.lineCap = 'round';
      const smooth = resample();
      if (dark) {
        // The three channels, slightly apart, added together: white where they meet, colour fringes at the edges.
        ctx.globalCompositeOperation = 'lighter';
        ribbon(now, -1, 'rgb(255, 40, 80)', smooth);
        ribbon(now, 0, 'rgb(60, 255, 140)', smooth);
        ribbon(now, 1, 'rgb(70, 110, 255)', smooth);
      } else {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        brand.forEach((c, i) => gradient.addColorStop(i / (brand.length - 1), c));
        ribbon(now, -0.6, gradient, smooth);
        ribbon(now, 0.6, gradient, smooth);
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

    const onMove = (event: PointerEvent) => {
      if (motionReduced()) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const now = performance.now();
      const last = points[points.length - 1];
      // Speed in px per ms, for the wave's size; points closer than 3px are skipped.
      if (last && Math.hypot(x - last.x, y - last.y) < 3) return;
      const speed = last ? Math.hypot(x - last.x, y - last.y) / Math.max(1, now - last.at) : 0;
      points.push({ x, y, at: now, speed });
      if (points.length > 160) points.shift();
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
