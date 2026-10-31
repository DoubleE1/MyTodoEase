import { useEffect, useRef } from 'react';
import { motionReduced } from '../lib/motion';

/**
 * A black hole: a tilted, spinning disk of purple light round a black centre with a bright rim, after the classic
 * canvas "blackhole" demo. Each particle draws a short line from where it was to where it is, over a picture that
 * fades a little every frame, so the disk is made of light streaks.
 *
 * Every particle makes one journey: it starts at the page's edge, spirals in the way the disk turns (its orbit round
 * far out, flattening into the disk's tilted plane as it nears it), slows down and joins the disk, drifts inwards
 * through it, circling faster as it goes (as in a real disk), and drops into the hole. Then it starts again at the
 * edge. The disk is simply where particles are slow, so they gather there.
 *
 * The hole glides after the pointer (and back to the open space under `below` when the pointer leaves). Each
 * particle's orbit lags behind it, outer ones more, so a quick move smears the disk into a comet and draws streams
 * towards the pointer. Holding the mouse button down makes everything fall in and spin faster (the disk drains into
 * the hole and refills from outside afterwards); a click on the page itself (not on a card, button or field) makes
 * it flare out, then settle.
 *
 * The side coming towards you is brighter, and brightness rises and falls with the radius, which shows as rings.
 * In the light theme the light is darker purple ink. It pauses while the window is hidden; with Reduce motion it
 * draws one still picture.
 */
export function BlackHole({ className, below }: { className?: string; below?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The near half of the disk is drawn on a layer of its own over the hole, so its streaks keep their tails as they
  // cross it (the hole is painted afresh every frame on the layer below).
  const frontRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frontCanvas = frontRef.current;
    const glow = glowRef.current;
    const ctx = canvas?.getContext('2d');
    const fctx = frontCanvas?.getContext('2d');
    if (!canvas || !frontCanvas || !glow || !ctx || !fctx) return;

    /** The disk's tilt (radians, rising to the right) and how flat it looks (height over width). */
    const TILT = -0.22;
    const SQUASH = 0.34;
    /** Turns per second at the disk's inner edge (radians); outer rings are slower by (inner / r) ^ 1.5. */
    const SPIN = 2.4;
    /** How quickly the hole catches up with the pointer (per second): slow and heavy. */
    const FOLLOW = 3.2;
    /** Share of the picture that fades each second (the length of the streaks). */
    const FADE = 9;
    /** Brightness levels, from the dim outer edge (0) to white (5). */
    const LEVELS = 6;

    let width = 0;
    let height = 0;
    let dark = true;
    let frame = 0;
    let lastFrame = 0;

    /** Horizon radius, and the disk's inner and outer edges (px). */
    let hole = 30;
    let inner = 45;
    let outer = 180;
    let home = { x: 0, y: 0 };
    let center = { x: 0, y: 0 };
    let target = { x: 0, y: 0 };
    /** Holding the mouse down: 0 to 1, easing towards `pullTarget`. */
    let pull = 0;
    let pullTarget = 0;
    /** The flare after a click: `kick` jumps to 1 and decays; `burst` eases after it. */
    let kick = 0;
    let burst = 0;

    // Particles: the radius and angle of their orbit round the hole (in the disk's plane), their own centre (trailing
    // the hole), last drawn point, sparkle. One set for everything: a particle starts at the page's edge, spirals in,
    // slows down and joins the disk, drifts through it, and drops into the hole.
    let n = 0;
    let r = new Float32Array(0);
    let a = new Float32Array(0);
    let ox = new Float32Array(0);
    let oy = new Float32Array(0);
    let px = new Float32Array(0);
    let py = new Float32Array(0);
    let shine = new Float32Array(0);
    /** Where particles start: the page's far corner from the hole. */
    let reach = 400;

    /** Line colours per level, and in the light theme a darker ink. */
    let colours: string[] = [];
    const readTheme = () => {
      dark = document.documentElement.dataset.theme === 'dark';
      colours = dark
        ? ['rgba(96,56,200,0.55)', 'rgba(124,78,240,0.65)', 'rgba(152,102,255,0.75)', 'rgba(184,142,255,0.85)', 'rgba(222,200,255,0.9)', 'rgba(255,246,255,0.95)']
        : ['rgba(150,120,230,0.35)', 'rgba(130,95,225,0.45)', 'rgba(110,70,220,0.55)', 'rgba(90,50,200,0.65)', 'rgba(70,35,170,0.75)', 'rgba(50,20,130,0.85)'];
    };

    const smoothstep = (from: number, to: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
      return t * t * (3 - 2 * t);
    };

    /**
     * How fast a particle falls in at a radius (px per second): fast far out, slow in the disk (so particles gather
     * there and it stays full), then a quick plunge past its inner edge into the hole.
     */
    const fallSpeed = (radius: number) =>
      0.035 * radius +
      0.12 * Math.max(0, radius - outer) +
      22 * smoothstep(outer * 0.85, outer * 1.25, radius) +
      (radius < inner ? 25 + 90 * (1 - radius / inner) : 0);

    /** How fast it turns (radians per second): as a real disk inside it (faster nearer in), more gently outside. */
    const turnSpeed = (radius: number) =>
      radius <= outer ? SPIN * (inner / radius) ** 1.5 : SPIN * (inner / outer) ** 1.5 * (outer / radius);

    /**
     * A particle's place on the screen. Far out its orbit is round; nearing the disk it flattens into the disk's
     * tilted plane, so it arrives moving the way the disk turns and joins it sideways. The flare after a click
     * spreads everything out for a moment.
     */
    const point = (i: number) => {
      const flat = smoothstep(outer, outer * 3.5, r[i]);
      const squash = SQUASH + (1 - SQUASH) * flat;
      const spread = 1 + burst * (0.4 + 0.6 * Math.min(1, Math.max(0, (r[i] - inner) / (outer - inner))));
      const re = r[i] * spread;
      const lx = Math.cos(a[i]) * re;
      const ly = Math.sin(a[i]) * re * squash;
      return { x: ox[i] + lx * Math.cos(TILT) - ly * Math.sin(TILT), y: oy[i] + lx * Math.sin(TILT) + ly * Math.cos(TILT) };
    };

    /**
     * Start a particle at `radius`, or (none given) at the page's edge, spread evenly over that band's area (the
     * square root).
     */
    const spawn = (i: number, radius?: number) => {
      const from = reach * 0.85;
      r[i] = radius ?? Math.sqrt(from * from + Math.random() * (reach * reach - from * from));
      a[i] = Math.random() * Math.PI * 2;
      ox[i] = center.x;
      oy[i] = center.y;
      const p = point(i);
      px[i] = p.x;
      py[i] = p.y;
    };

    /**
     * The radii one particle passes through on its way in, one every 1/20 s. Starting each particle at a random one
     * fills the page as if it had been running for a while: most in the disk, where they are slow, a few on the way.
     */
    const journey = () => {
      const radii: number[] = [];
      for (let radius = reach; radius > hole && radii.length < 4000; radius -= fallSpeed(radius) * 0.05) radii.push(radius);
      return radii;
    };

    const restPoint = () => {
      const rect = canvas.getBoundingClientRect();
      const anchor = below ? document.querySelector(below)?.getBoundingClientRect() : null;
      const top = anchor ? Math.min(height * 0.8, anchor.bottom - rect.top + 30) : 0;
      return { x: width / 2, y: top + (height - top) * 0.52 };
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const [c, x] of [
        [canvas, ctx],
        [frontCanvas, fctx],
      ] as const) {
        c.width = Math.max(1, Math.round(width * dpr));
        c.height = Math.max(1, Math.round(height * dpr));
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      // The disk's size follows the space; the hole is small inside it, so most of the disk is light.
      const scale = Math.max(18, Math.min(60, Math.min(width, height * 2) * 0.062));
      hole = scale * 0.6;
      inner = hole * 1.55;
      outer = Math.min(scale * 5.5, width * 0.42);
      home = restPoint();
      center = { ...home };
      target = { ...home };

      const area = width * height;
      n = Math.round(Math.max(560, Math.min(1660, area / 800)));
      reach = Math.hypot(Math.max(center.x, width - center.x), Math.max(center.y, height - center.y)) + 40;
      r = new Float32Array(n);
      a = new Float32Array(n);
      ox = new Float32Array(n);
      oy = new Float32Array(n);
      px = new Float32Array(n);
      py = new Float32Array(n);
      shine = new Float32Array(n);
      const radii = journey();
      for (let i = 0; i < n; i++) {
        shine[i] = 0.55 + Math.random() * 0.6;
        spawn(i, radii[Math.floor(Math.random() * radii.length)]);
      }

      const size = outer * 3.2;
      glow.style.width = glow.style.height = `${size}px`;
      ctx.clearRect(0, 0, width, height);
      fctx.clearRect(0, 0, width, height);
    };

    // One path per brightness level, behind and in front of the hole, so a frame is twelve strokes.
    const back: Path2D[] = [];
    const front: Path2D[] = [];

    const step = (dt: number) => {
      const follow = 1 - Math.exp(-FOLLOW * dt);
      center.x += (target.x - center.x) * follow;
      center.y += (target.y - center.y) * follow;
      pull += (pullTarget - pull) * (1 - Math.exp(-5 * dt));
      kick *= Math.exp(-2.2 * dt);
      burst += (kick - burst) * (1 - Math.exp(-9 * dt));

      for (let l = 0; l < LEVELS; l++) {
        back[l] = new Path2D();
        front[l] = new Path2D();
      }

      for (let i = 0; i < n; i++) {
        // Inner orbits follow the hole closely; outer ones trail behind, so a moving hole drags streams after it.
        const lag = 1 - Math.exp(-(1.2 + 16 * (inner / r[i])) * dt);
        ox[i] += (center.x - ox[i]) * lag;
        oy[i] += (center.y - oy[i]) * lag;
        // Holding the mouse down: everything falls in faster (the disk drains into the hole) and spins faster.
        a[i] += turnSpeed(r[i]) * (1 + pull * 1.2) * (1 - burst * 0.5) * dt;
        r[i] -= fallSpeed(r[i]) * (1 + pull * 4) * dt;
        if (r[i] < hole) {
          // Gone into the hole; it starts again at the page's edge.
          spawn(i);
          continue;
        }
        const p = point(i);
        let level: number;
        if (r[i] > outer) {
          // On the way in: faint far out, brighter nearer the disk.
          level = Math.floor((outer * 1.6) / r[i]);
        } else {
          // In the disk: brighter near the centre and on the side coming towards you (the left, as it turns). Rings:
          // brightness rises and falls with the radius, so the disk shows bands (fixed in place as particles drift
          // through them).
          const t = Math.min(1, Math.max(0, 1 - (r[i] - inner) / (outer - inner)));
          const toward = Math.cos(a[i]) < -0.2 ? 1 : 0;
          const band = 0.55 + 0.45 * Math.sin((r[i] / hole) * 4.2) ** 2;
          level = Math.floor((0.25 + t ** 1.2) * shine[i] * band * LEVELS + toward);
        }
        level = Math.max(0, Math.min(LEVELS - 1, level));
        // The near half of the disk passes in front of the hole (across its lower part), so it reads as orbiting.
        const path = Math.sin(a[i]) > 0 && r[i] < outer * 1.4 ? front[level] : back[level];
        path.moveTo(px[i], py[i]);
        path.lineTo(p.x, p.y);
        px[i] = p.x;
        py[i] = p.y;
      }
    };

    const strokeAll = (c: CanvasRenderingContext2D, paths: Path2D[]) => {
      c.lineCap = 'round';
      c.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      for (let l = 0; l < LEVELS; l++) {
        c.strokeStyle = colours[l];
        c.lineWidth = 0.8 + l * 0.22;
        c.stroke(paths[l]);
      }
      c.globalCompositeOperation = 'source-over';
    };

    /** Fade what is there (keeping the canvas see-through, so the page shows behind in both themes). */
    const fade = (c: CanvasRenderingContext2D, dt: number) => {
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = `rgba(0,0,0,${1 - Math.exp(-FADE * dt)})`;
      c.fillRect(0, 0, width, height);
      c.globalCompositeOperation = 'source-over';
    };

    const draw = (dt: number) => {
      fade(ctx, dt);
      fade(fctx, dt);
      strokeAll(ctx, back);

      // The hole, with a thin bright rim of bent light.
      const h = hole * (1 - pull * 0.12);
      ctx.fillStyle = dark ? '#05030a' : '#0c0816';
      ctx.beginPath();
      ctx.arc(center.x, center.y, h, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.shadowColor = dark ? 'rgba(190,150,255,0.9)' : 'rgba(120,80,230,0.8)';
      ctx.shadowBlur = h * 0.5;
      ctx.strokeStyle = dark ? 'rgba(255,250,255,0.95)' : 'rgba(150,110,255,0.95)';
      ctx.lineWidth = Math.max(1.2, h * 0.07);
      ctx.beginPath();
      ctx.arc(center.x, center.y, h * 1.03, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      strokeAll(fctx, front);

      const size = outer * 3.2;
      glow.style.transform = `translate(${center.x - size / 2}px, ${center.y - size / 2}px) scale(${1 + burst * 0.4})`;
      glow.style.opacity = String(0.85 + pull * 0.15);
    };

    const loop = (now: number) => {
      frame = 0;
      const dt = Math.min(0.05, lastFrame ? (now - lastFrame) / 1000 : 1 / 60);
      lastFrame = now;
      step(dt);
      draw(dt);
      if (!document.hidden && !motionReduced()) frame = requestAnimationFrame(loop);
      else lastFrame = 0;
    };
    const start = () => {
      if (frame) return;
      if (motionReduced()) {
        // One still picture: a moment of the disk turning.
        for (let k = 0; k < 24; k++) {
          step(1 / 60);
          draw(1 / 60);
        }
        return;
      }
      frame = requestAnimationFrame(loop);
    };

    readTheme();
    resize();
    const sizes = new ResizeObserver(() => {
      resize();
      if (motionReduced()) start();
    });
    sizes.observe(canvas);
    const theme = new MutationObserver(() => {
      readTheme();
      ctx.clearRect(0, 0, width, height);
      fctx.clearRect(0, 0, width, height);
      if (motionReduced()) start();
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const inside = (event: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      return x >= 0 && y >= 0 && x <= rect.width && y <= rect.height ? { x, y } : null;
    };
    const onMove = (event: PointerEvent) => {
      target = inside(event) ?? { ...home };
    };
    const onLeave = () => {
      target = { ...home };
      pullTarget = 0;
    };
    const onPage = (event: MouseEvent) => {
      const el = event.target instanceof Element ? event.target : null;
      return (
        event.button === 0 &&
        !!inside(event) &&
        !el?.closest('a, button, input, select, textarea, label, summary, [role="button"], [role="menuitem"], [contenteditable="true"], .home-card, .home-bg-switcher')
      );
    };
    const onDown = (event: PointerEvent) => {
      if (onPage(event)) pullTarget = 1;
    };
    // Holding and moving the mouse over the background would otherwise select the page's text.
    const onMouseDown = (event: MouseEvent) => {
      if (onPage(event)) event.preventDefault();
    };
    const onUp = () => {
      pullTarget = 0;
    };
    const onClick = (event: MouseEvent) => {
      if (onPage(event)) kick = 1;
    };
    const onVisible = () => {
      if (!document.hidden) start();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('click', onClick);
    window.addEventListener('blur', onLeave);
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisible);
    start();

    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      theme.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('click', onClick);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [below]);

  return (
    <div className={`blackhole ${className ?? ''}`} aria-hidden="true">
      <div ref={glowRef} className="blackhole-glow" />
      <canvas ref={canvasRef} className="blackhole-canvas" />
      <canvas ref={frontRef} className="blackhole-canvas" />
    </div>
  );
}
