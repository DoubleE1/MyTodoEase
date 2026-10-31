import { useEffect, useRef } from 'react';
import { motionReduced } from '../lib/motion';

/**
 * A glowing light-trail that follows the mouse, after the "chromatic wave" shader: a smooth curve with a white-hot
 * core, a soft glow, and rainbow edges where its red, green and blue copies sit slightly apart (warm on one side,
 * blue on the other), the split widening towards the tail as it thins and fades.
 *
 * Drawn by stamping soft glow dots closely along the smoothed path and adding their light together, which gives
 * the same bright-centre, long-falloff profile as the shader. The trail's head glides after the pointer, so a quick
 * change of direction comes out as a rounded arc, and the colour edges turn round gradually with it. While the
 * pointer rests, a glowing orb stays with it, drifting slowly a few px around it and gently growing and shrinking
 * (30 frames a second; still with Reduce motion); it fades when the pointer leaves. In the light theme, where added light would vanish
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
    const RADIUS = 44;

    type Point = { x: number; y: number; at: number };
    let points: Point[] = [];
    /** Where the pointer is, and the trail's head gliding after it (so sharp turns come out as arcs). */
    let target: { x: number; y: number } | null = null;
    let head: { x: number; y: number } | null = null;
    /** How quickly the head catches up with the pointer (per second). */
    const FOLLOW = 22;
    /** The glow that stays at the pointer while it rests: 0 to 1, easing towards `orbTarget`. */
    let orb = 0;
    let orbTarget = 0;
    /** Which way the colour rims face (the trail's last sideways direction). */
    let edge = { x: -1, y: 0 };
    /** When the pointer last moved; the orb starts drifting a moment after it rests. */
    let lastMoveAt = 0;
    /** Frame pace while only the resting orb drifts (no trail): slow and cheap. */
    const DRIFT_MS = 33;
    let lastDrift = 0;
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
      g.addColorStop(0.12, `rgba(${r}, ${gr}, ${b}, 0.8)`);
      g.addColorStop(0.26, `rgba(${r}, ${gr}, ${b}, 0.3)`);
      g.addColorStop(0.5, `rgba(${r}, ${gr}, ${b}, 0.08)`);
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

    /**
     * The path again with a point every STEP px measured along it (however close or far apart the recorded points
     * are, so the light is even), then smoothed so mouse jitter does not show.
     */
    const smoothPath = (): Point[] => {
      const even: Point[] = [points[0]];
      let carry = 0; // distance since the last emitted point
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        let d = STEP - carry;
        while (d <= length) {
          const f = d / length;
          even.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, at: a.at + (b.at - a.at) * f });
          d += STEP;
        }
        carry = length - (d - STEP);
      }
      const W = 9;
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

    /** The resting glow at the head: the three colours stacked (white core) with slight warm and blue rims. */
    const drawOrb = (now: number) => {
      if (!head || orb < 0.01) return;
      // Resting, the orb wanders slowly round the pointer (overlapping slow waves, so it never loops visibly),
      // its colour rims turning with it. It eases in after the pointer stops; while moving it sits on the pointer.
      const rest = motionReduced() ? 0 : Math.min(1, Math.max(0, (now - lastMoveAt - 250) / 900));
      const t = now / 1000;
      const dx = (Math.sin(t * 0.9) * 6 + Math.sin(t * 0.37 + 1.3) * 3) * rest;
      const dy = (Math.cos(t * 0.73) * 5 + Math.sin(t * 0.51 + 0.4) * 3) * rest;
      const dl = Math.hypot(dx, dy);
      const rim = rest > 0.05 && dl > 0.5 ? { x: dx / dl, y: dy / dl } : edge;
      const x = head.x + dx;
      const y = head.y + dy;
      // ...and breathes, growing and shrinking a little (about 6%, every ~3 s).
      const breathe = 1 + Math.sin(t * 2.1) * 0.06 * rest;
      const radius = RADIUS * 1.45 * breathe;
      ctx.globalAlpha = (dark ? 0.62 : 0.26) * orb;
      for (let pass = 0; pass < 2; pass++) {
        sprites.forEach((sprite, channel) => {
          const shift = (channel - 1) * 4;
          ctx.drawImage(sprite, x + rim.x * shift - radius, y + rim.y * shift - radius, radius * 2, radius * 2);
        });
      }
    };

    /** Draws the frame; true while anything is still changing (trail fading, orb easing). */
    const draw = (now: number) => {
      ctx.clearRect(0, 0, width, height);
      points = points.filter((p) => now - p.at < LIFE_MS);
      ctx.save();
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      const trail = points.length >= 2;
      if (trail) drawTrail(now);
      drawOrb(now);
      ctx.restore();
      return trail;
    };

    const drawTrail = (now: number) => {
      const path = smoothPath();
      // Across the path (where the colours split to either side), eased along it, so through a sharp turn the
      // warm and blue edges rotate round gradually instead of jumping sides.
      let nx = 0;
      let ny = 0;
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        const life = 1 - (now - p.at) / LIFE_MS; // 1 at the head, 0 at the end of the tail
        const prev = path[Math.max(0, i - 8)];
        const next = path[Math.min(path.length - 1, i + 8)];
        let tx = -(next.y - prev.y);
        let ty = next.x - prev.x;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        if (i === 0) {
          nx = tx;
          ny = ty;
        } else {
          nx += (tx - nx) * 0.12;
          ny += (ty - ny) * 0.12;
          const nl = Math.hypot(nx, ny) || 1;
          nx /= nl;
          ny /= nl;
        }
        if (life <= 0) continue;
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
      // The orb's rims face the way the trail's did at its head.
      edge = { x: nx, y: ny };
    };

    let lastFrame = 0;
    const loop = (now: number) => {
      frame = 0;
      const dt = Math.min(0.05, lastFrame ? (now - lastFrame) / 1000 : 1 / 60);
      lastFrame = now;
      let chasing = false;
      if (target && head) {
        const k = 1 - Math.exp(-FOLLOW * dt);
        head.x += (target.x - head.x) * k;
        head.y += (target.y - head.y) * k;
        const last = points[points.length - 1];
        // Points closer than 1.5px add nothing.
        if (!last || Math.hypot(head.x - last.x, head.y - last.y) > 1.5) {
          points.push({ x: head.x, y: head.y, at: performance.now() });
          if (points.length > 400) points.shift();
        }
        chasing = Math.hypot(target.x - head.x, target.y - head.y) > 0.5;
      }
      // The resting glow eases in while the pointer is here and out when it leaves.
      orb += (orbTarget - orb) * (1 - Math.exp(-8 * dt));
      const easing = Math.abs(orbTarget - orb) > 0.01;
      if (!easing) orb = orbTarget;
      // With only the resting orb drifting (no trail), a slower pace is enough.
      const drifting = orb > 0.01 && !motionReduced();
      const busy = chasing || easing || points.length > 0;
      if (busy || now - lastDrift >= DRIFT_MS) {
        lastDrift = now;
        draw(now);
      }
      if ((busy || drifting) && !document.hidden) frame = requestAnimationFrame(loop);
      else lastFrame = 0;
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
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (event.pointerId !== pointerId || !head) {
        pointerId = event.pointerId;
        points = [];
        head = { x, y };
      }
      target = { x, y };
      orbTarget = 1;
      lastMoveAt = performance.now();
      kick();
    };
    // The pointer left the page (or a finger lifted): the resting glow fades out.
    const onGone = (event?: PointerEvent) => {
      if (event && event.type === 'pointerup' && event.pointerType === 'mouse') return;
      orbTarget = 0;
      kick();
    };
    window.addEventListener('pointermove', onMove);
    document.addEventListener('pointerleave', onGone);
    window.addEventListener('pointerup', onGone);
    const onBlur = () => onGone();
    const onVisible = () => {
      if (!document.hidden) kick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('blur', onBlur);

    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      theme.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onGone);
      window.removeEventListener('pointerup', onGone);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

function hexRgb(hex: string, fallback: [number, number, number]): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return fallback;
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}
