import { useEffect, useRef } from 'react';
import { motionReduced } from '../lib/motion';
import { wordStrokes, wordWidth } from '../lib/strokeWord';

/**
 * A glowing light-trail, after the "chromatic wave" shader: a smooth curve with a white-hot core, a soft glow, and
 * rainbow edges where its red, green and blue copies sit slightly apart (warm on one side, blue on the other), the
 * split widening towards the tail as it thins and fades.
 *
 * At first the light signs `word` across the open space under `below`: one joined, slanted stroke, left to right,
 * in a thinner line, which stays until it is finished, fades, and is signed again after a pause. A click on the page
 * (not on a card, button or field) switches to following the pointer; another click goes back to signing.
 *
 * Drawn by stamping soft glow dots closely along the smoothed path and adding their light together, which gives
 * the same bright-centre, long-falloff profile as the shader. Following the pointer, the trail's head glides after
 * it, so a quick change of direction comes out as a rounded arc, and the colour edges turn round gradually with it.
 * While the pointer rests, a glowing orb stays with it, drifting slowly a few px around it and gently growing and
 * shrinking.
 *
 * In the light theme, where added light would vanish against white, it is a softer glow in the brand colours. It
 * pauses while the window is hidden; Reduce motion (OS or Settings) turns it off.
 */
export function ChromaTrail({ className, word = 'TodoEase', below }: { className?: string; word?: string; below?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    /** How long a point of the mouse's trail stays, in ms. (The written word stays until it is finished, plus
     *  WORD_HOLD_MS, so it can be read whole.) */
    const LIFE_MS = 900;
    const WORD_HOLD_MS = 1300;
    /** Spacing of the glow stamps along the path, in px. */
    const STEP = 3;
    /** Glow radius at the head, in px, and the written line's share of it (thinner, so the letters stay apart). */
    const RADIUS = 44;
    const WRITE_WIDTH = 0.5;
    /** How quickly the head catches up with the pointer (per second). */
    const FOLLOW = 22;
    /** Writing: pen speed while drawing and while lifted (px per second), the pause between words, and the wait
     *  before the first word, once the page has laid out (ms). */
    const PEN_SPEED = 720;
    const LIFT_SPEED = 1500;
    const WORD_PAUSE_MS = 1500;
    const FIRST_WORD_MS = 400;
    /** Frame pace while only the resting orb drifts (no trail): slow and cheap. */
    const DRIFT_MS = 33;

    /** A point of the trail. `start` begins a new stroke (no line from the point before); `life` in ms. */
    type Point = { x: number; y: number; at: number; life: number; start?: boolean; written?: boolean };
    let points: Point[] = [];
    let width = 0;
    let height = 0;
    let dark = true;
    let frame = 0;
    /** Pre-drawn glow dots, one per colour. */
    let sprites: HTMLCanvasElement[] = [];

    /** Where the pointer is, and the trail's head gliding after it (so sharp turns come out as arcs). */
    let target: { x: number; y: number } | null = null;
    let head: { x: number; y: number } | null = null;
    /** The glow that stays at the head: 0 to 1, easing towards `orbTarget`. */
    let orb = 0;
    let orbTarget = 0;
    /** Which way the colour rims face (the trail's last sideways direction). */
    let edge = { x: -1, y: 0 };
    /** When the head last moved; the orb starts drifting a moment after it rests. */
    let lastMoveAt = 0;
    let lastDrift = 0;

    /** The pen writing the word while the pointer is away (null while the pointer is here). */
    let pen: {
      strokes: { x: number; y: number }[][];
      stroke: number;
      /** Distance drawn along the current stroke, in px. */
      along: number;
      lifted: boolean;
      /** Waiting before the next word, in ms. */
      wait: number;
      /** How long each written point stays, in ms. */
      life: number;
    } | null = null;
    let firstWord = 0;
    /** Following the pointer (after a click) rather than signing the word. */
    let following = false;

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

    /** The word's strokes, sized to the open space under `below` (or the lower part of the page). */
    const newPen = () => {
      const rect = canvas.getBoundingClientRect();
      const anchor = below ? document.querySelector(below)?.getBoundingClientRect() : null;
      const openTop = Math.max(height * 0.3, anchor ? anchor.bottom - rect.top + 40 : 0);
      const openBottom = Math.max(openTop + 120, height * 0.92);
      const em = Math.max(1, wordWidth(word));
      const size = Math.min((width * 0.82) / em, (openBottom - openTop) * 0.6, 170);
      const left = (width - em * size) / 2;
      const top = openTop + (openBottom - openTop - size) / 2;
      const strokes = wordStrokes(word, left, top, size);
      let length = 0;
      for (const stroke of strokes) for (let i = 1; i < stroke.length; i++) length += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y);
      const life = (length / PEN_SPEED) * 1000 + WORD_HOLD_MS;
      return { strokes, stroke: 0, along: 0, lifted: true, wait: 0, life };
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (pen) pen = newPen();
    };

    /** Where `along` px down a stroke lands, and whether the stroke has ended. */
    const pointOn = (stroke: { x: number; y: number }[], along: number) => {
      let left = along;
      for (let i = 1; i < stroke.length; i++) {
        const a = stroke[i - 1];
        const b = stroke[i];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (left <= length) {
          const f = length ? left / length : 0;
          return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, done: false };
        }
        left -= length;
      }
      const end = stroke[stroke.length - 1];
      return { x: end.x, y: end.y, done: true };
    };

    /** Move the pen on: glide (lifted) to the next stroke's start, or draw along it, laying trail points. */
    const writeStep = (dt: number, now: number) => {
      if (!pen || !pen.strokes.length) return;
      if (pen.wait > 0) {
        pen.wait -= dt * 1000;
        return;
      }
      const stroke = pen.strokes[pen.stroke];
      if (!head) head = { ...stroke[0] };
      if (pen.lifted) {
        const dx = stroke[0].x - head.x;
        const dy = stroke[0].y - head.y;
        const d = Math.hypot(dx, dy);
        const move = LIFT_SPEED * dt;
        if (d <= move) {
          head = { ...stroke[0] };
          pen.lifted = false;
          pen.along = 0;
          points.push({ ...head, at: now, life: pen.life, start: true, written: true });
        } else {
          head = { x: head.x + (dx / d) * move, y: head.y + (dy / d) * move };
        }
        return;
      }
      pen.along += PEN_SPEED * dt;
      const p = pointOn(stroke, pen.along);
      head = { x: p.x, y: p.y };
      points.push({ x: p.x, y: p.y, at: now, life: pen.life, written: true });
      if (points.length > 2400) points.shift();
      if (p.done) {
        pen.lifted = true;
        pen.stroke += 1;
        if (pen.stroke >= pen.strokes.length) {
          pen.stroke = 0;
          pen.wait = WORD_HOLD_MS + WORD_PAUSE_MS;
        }
      }
    };

    /**
     * The path of one stroke again with a point every STEP px measured along it (however close or far apart the
     * recorded points are, so the light is even), then smoothed: strongly for the mouse (hides jitter), lightly for
     * writing (keeps the letters' corners).
     */
    const smoothPath = (stroke: Point[]): Point[] => {
      const even: Point[] = [stroke[0]];
      let carry = 0; // distance since the last emitted point
      for (let i = 1; i < stroke.length; i++) {
        const a = stroke[i - 1];
        const b = stroke[i];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        let d = STEP - carry;
        while (d <= length) {
          const f = d / length;
          even.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, at: a.at + (b.at - a.at) * f, life: a.life });
          d += STEP;
        }
        carry = length - (d - STEP);
      }
      const W = stroke[0].written ? 2 : 9;
      return even.map((p, i) => {
        let x = 0;
        let y = 0;
        let n = 0;
        for (let j = Math.max(0, i - W); j <= Math.min(even.length - 1, i + W); j++) {
          x += even[j].x;
          y += even[j].y;
          n++;
        }
        return { x: x / n, y: y / n, at: p.at, life: p.life };
      });
    };

    const drawStroke = (stroke: Point[], now: number) => {
      const path = smoothPath(stroke);
      const width = stroke[0].written ? RADIUS * WRITE_WIDTH : RADIUS;
      // Across the path (where the colours split to either side), eased along it, so through a sharp turn the
      // warm and blue edges rotate round gradually instead of jumping sides.
      let nx = 0;
      let ny = 0;
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        const life = 1 - (now - p.at) / p.life; // 1 at the head, 0 at the end of the tail
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
        const radius = width * (0.45 + 0.55 * life);
        const split = 1.5 + 6 * (1 - life) ** 1.5;
        // In the light theme the thinner written line needs more ink to read.
        ctx.globalAlpha = (dark ? 0.2 : stroke[0].written ? 0.16 : 0.08) * Math.min(1, 0.2 + life * 1.1);
        sprites.forEach((sprite, channel) => {
          const shift = (channel - 1) * split;
          ctx.drawImage(sprite, p.x + nx * shift - radius, p.y + ny * shift - radius, radius * 2, radius * 2);
        });
      }
      // The orb's rims face the way the trail's did at its head.
      edge = { x: nx, y: ny };
    };

    /** The glow at the head: the three colours stacked (white core) with slight warm and blue rims. */
    const drawOrb = (now: number) => {
      if (!head || orb < 0.01) return;
      // Resting, the orb wanders slowly round the pointer (overlapping slow waves, so it never loops visibly),
      // its colour rims turning with it, and breathes a little. Both ease in after the pointer stops; the pen
      // never rests.
      const rest = motionReduced() || pen ? 0 : Math.min(1, Math.max(0, (now - lastMoveAt - 250) / 900));
      const t = now / 1000;
      const dx = (Math.sin(t * 0.9) * 6 + Math.sin(t * 0.37 + 1.3) * 3) * rest;
      const dy = (Math.cos(t * 0.73) * 5 + Math.sin(t * 0.51 + 0.4) * 3) * rest;
      const dl = Math.hypot(dx, dy);
      const rim = rest > 0.05 && dl > 0.5 ? { x: dx / dl, y: dy / dl } : edge;
      const breathe = 1 + Math.sin(t * 2.1) * 0.06 * rest;
      // The pen tip is a smaller glow, so the letters stay readable round it.
      const radius = RADIUS * (pen ? 0.8 : 1.45) * breathe;
      ctx.globalAlpha = (dark ? 0.62 : 0.26) * orb;
      for (let pass = 0; pass < 2; pass++) {
        sprites.forEach((sprite, channel) => {
          const shift = (channel - 1) * 4;
          ctx.drawImage(sprite, head!.x + dx + rim.x * shift - radius, head!.y + dy + rim.y * shift - radius, radius * 2, radius * 2);
        });
      }
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, width, height);
      points = points.filter((p) => now - p.at < p.life);
      ctx.save();
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      // Strokes are runs of points between `start` marks (pen lifts, or the pointer taking over).
      let stroke: Point[] = [];
      const flush = () => {
        if (stroke.length >= 2) drawStroke(stroke, now);
        stroke = [];
      };
      for (const p of points) {
        if (p.start) flush();
        stroke.push(p);
      }
      flush();
      drawOrb(now);
      ctx.restore();
    };

    let lastFrame = 0;
    const loop = (now: number) => {
      frame = 0;
      const dt = Math.min(0.05, lastFrame ? (now - lastFrame) / 1000 : 1 / 60);
      lastFrame = now;
      let chasing = false;
      if (pen) {
        writeStep(dt, now);
        lastMoveAt = now;
      } else if (target && head) {
        const k = 1 - Math.exp(-FOLLOW * dt);
        head.x += (target.x - head.x) * k;
        head.y += (target.y - head.y) * k;
        const last = points[points.length - 1];
        // Points closer than 1.5px add nothing.
        if (!last || Math.hypot(head.x - last.x, head.y - last.y) > 1.5) {
          points.push({ x: head.x, y: head.y, at: now, life: LIFE_MS });
          if (points.length > 2400) points.shift();
        }
        chasing = Math.hypot(target.x - head.x, target.y - head.y) > 0.5;
      }
      // The orb eases in while the pointer (or the pen) is here and out when it leaves.
      orb += (orbTarget - orb) * (1 - Math.exp(-8 * dt));
      const easing = Math.abs(orbTarget - orb) > 0.01;
      if (!easing) orb = orbTarget;
      // With only the resting orb drifting (no trail, no pen), a slower pace is enough.
      const drifting = orb > 0.01 && !motionReduced();
      const busy = !!pen || chasing || easing || points.length > 0;
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

    /** Sign the word, from wherever the light is now. */
    const startWriting = () => {
      if (motionReduced()) return;
      following = false;
      pen = newPen();
      target = null;
      orbTarget = 1;
      kick();
    };

    readTheme();
    resize();
    const sizes = new ResizeObserver(resize);
    sizes.observe(canvas);
    const theme = new MutationObserver(readTheme);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    let pointerId = -1;
    /** Follow the pointer to (clientX, clientY): a new stroke, gliding from wherever the light was. */
    const follow = (clientX: number, clientY: number, id: number, fresh: boolean) => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const now = performance.now();
      if (fresh || id !== pointerId || !head) {
        pointerId = id;
        head = head ?? { x, y };
        points.push({ ...head, at: now, life: LIFE_MS, start: true });
      }
      target = { x, y };
      orbTarget = 1;
      lastMoveAt = now;
      kick();
    };
    const onMove = (event: PointerEvent) => {
      if (following && !motionReduced()) follow(event.clientX, event.clientY, event.pointerId, false);
    };
    // A click on the page itself (cards, buttons and fields keep their own clicks) switches between following the
    // pointer and signing the word.
    const onClick = (event: MouseEvent) => {
      if (motionReduced() || event.button !== 0) return;
      const el = event.target instanceof Element ? event.target : null;
      if (el?.closest('a, button, input, select, textarea, label, summary, [role="button"], [role="menuitem"], [contenteditable="true"], .home-card, .home-bg-switcher')) return;
      window.clearTimeout(firstWord);
      if (following) {
        startWriting();
        return;
      }
      following = true;
      pen = null;
      follow(event.clientX, event.clientY, pointerId, true);
    };
    // Following, and the pointer left the page (or a finger lifted): the orb fades until it is back.
    const onGone = (event?: PointerEvent) => {
      if (!following) return;
      if (event && event.type === 'pointerup' && event.pointerType === 'mouse') return;
      orbTarget = 0;
      kick();
    };
    const onBlur = () => onGone();
    const onVisible = () => {
      if (!document.hidden) kick();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('click', onClick);
    document.addEventListener('pointerleave', onGone);
    window.addEventListener('pointerup', onGone);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisible);
    firstWord = window.setTimeout(startWriting, FIRST_WORD_MS);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(firstWord);
      sizes.disconnect();
      theme.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('click', onClick);
      document.removeEventListener('pointerleave', onGone);
      window.removeEventListener('pointerup', onGone);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [word, below]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

function hexRgb(hex: string, fallback: [number, number, number]): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return fallback;
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}
