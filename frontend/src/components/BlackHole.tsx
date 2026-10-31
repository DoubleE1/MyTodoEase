import { useEffect, useRef } from 'react';
import { motionReduced } from '../lib/motion';

/**
 * A black hole: a tilted, spinning disk of purple light round a black centre with a bright rim, after the classic
 * canvas "blackhole" demo. Each particle draws a short line from where it was to where it is, over a picture that
 * fades a little every frame, so the disk is made of light streaks.
 *
 * The hole glides after the pointer (and back to the open space under `below` when the pointer leaves). The disk
 * lags behind it, outer rings more than inner ones, so a quick move smears it into a comet. Loose dust across the
 * page spirals in the way the disk turns, flattening into it as it arrives, and is drawn as streams towards the
 * pointer. Holding the mouse button down pulls
 * harder (the disk shrinks and spins faster); a click on the page itself (not on a card, button or field) makes
 * the disk flare out, then settle.
 *
 * Inner particles circle faster than outer ones (as in a real disk) and drift slowly inwards; one that reaches the
 * rim comes back at the outer edge. The side coming towards you is brighter, and brightness rises and falls with
 * the radius, which shows as rings. In the light theme the light is
 * darker purple ink. It pauses while the window is hidden; with Reduce motion it draws one still picture.
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
    /** Turns per second at the inner edge (radians); outer rings are slower by (inner / r) ^ 1.5. */
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

    // Disk particles: radius, angle, their own centre (lagging behind the hole), last drawn point, sparkle.
    let n = 0;
    let r = new Float32Array(0);
    let a = new Float32Array(0);
    let ox = new Float32Array(0);
    let oy = new Float32Array(0);
    let px = new Float32Array(0);
    let py = new Float32Array(0);
    let shine = new Float32Array(0);
    // Dust: its orbit's radius and angle round the hole (in the disk's own plane, like the disk particles), its own
    // centre (trailing the hole slowly), last drawn point.
    let m = 0;
    let dr = new Float32Array(0);
    let da = new Float32Array(0);
    let dox = new Float32Array(0);
    let doy = new Float32Array(0);
    let qx = new Float32Array(0);
    let qy = new Float32Array(0);
    /** The farthest a dust orbit starts: the page's far corner from the hole. */
    let reach = 400;

    /** Line colours per level, and in the light theme a darker ink. */
    let colours: string[] = [];
    const readTheme = () => {
      dark = document.documentElement.dataset.theme === 'dark';
      colours = dark
        ? ['rgba(96,56,200,0.55)', 'rgba(124,78,240,0.65)', 'rgba(152,102,255,0.75)', 'rgba(184,142,255,0.85)', 'rgba(222,200,255,0.9)', 'rgba(255,246,255,0.95)']
        : ['rgba(150,120,230,0.35)', 'rgba(130,95,225,0.45)', 'rgba(110,70,220,0.55)', 'rgba(90,50,200,0.65)', 'rgba(70,35,170,0.75)', 'rgba(50,20,130,0.85)'];
    };

    const spawnDisk = (i: number, anywhere: boolean) => {
      // Most particles sit near the inner edge; new ones (anywhere = false) arrive at the outer edge.
      const u = anywhere ? Math.random() ** 1.6 : 0.75 + Math.random() * 0.25;
      r[i] = inner + (outer - inner) * u;
      a[i] = Math.random() * Math.PI * 2;
      ox[i] = center.x;
      oy[i] = center.y;
      const p = diskPoint(i);
      px[i] = p.x;
      py[i] = p.y;
    };

    /**
     * New dust: anywhere on the page at first (`anywhere`), later from the far edge. Spread evenly over the area
     * (the square root), so the page is not crowded near the hole.
     */
    const spawnDust = (j: number, anywhere: boolean) => {
      const from = anywhere ? outer * 1.15 : reach * 0.8;
      dr[j] = Math.sqrt(from * from + Math.random() * (reach * reach - from * from));
      da[j] = Math.random() * Math.PI * 2;
      dox[j] = center.x;
      doy[j] = center.y;
      const p = dustPoint(j);
      qx[j] = p.x;
      qy[j] = p.y;
    };

    /**
     * Dust's place on the screen. Far out its orbit is round; nearing the disk it flattens into the disk's tilted
     * plane, so it arrives moving the way the disk turns and joins it sideways.
     */
    const dustPoint = (j: number) => {
      const flat = Math.min(1, Math.max(0, (dr[j] - outer) / (outer * 2.5)));
      const squash = SQUASH + (1 - SQUASH) * flat;
      const lx = Math.cos(da[j]) * dr[j];
      const ly = Math.sin(da[j]) * dr[j] * squash;
      return { x: dox[j] + lx * Math.cos(TILT) - ly * Math.sin(TILT), y: doy[j] + lx * Math.sin(TILT) + ly * Math.cos(TILT) };
    };

    /** A disk particle's place on the screen: its circle, flattened and tilted, round its own centre. */
    const diskPoint = (i: number) => {
      const spread = 1 + burst * (0.5 + (r[i] - inner) / (outer - inner)) - pull * 0.28;
      const re = r[i] * spread;
      const lx = Math.cos(a[i]) * re;
      const ly = Math.sin(a[i]) * re * SQUASH;
      return { x: ox[i] + lx * Math.cos(TILT) - ly * Math.sin(TILT), y: oy[i] + lx * Math.sin(TILT) + ly * Math.cos(TILT) };
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
      n = Math.round(Math.max(500, Math.min(1400, area / 900)));
      m = Math.round(Math.max(60, Math.min(260, area / 6000)));
      r = new Float32Array(n);
      a = new Float32Array(n);
      ox = new Float32Array(n);
      oy = new Float32Array(n);
      px = new Float32Array(n);
      py = new Float32Array(n);
      shine = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        shine[i] = 0.55 + Math.random() * 0.6;
        spawnDisk(i, true);
      }
      dr = new Float32Array(m);
      da = new Float32Array(m);
      dox = new Float32Array(m);
      doy = new Float32Array(m);
      qx = new Float32Array(m);
      qy = new Float32Array(m);
      reach = Math.hypot(Math.max(center.x, width - center.x), Math.max(center.y, height - center.y)) + 40;
      for (let j = 0; j < m; j++) spawnDust(j, true);

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
        const near = inner / r[i];
        // Inner rings follow the hole closely; outer ones trail behind.
        const lag = 1 - Math.exp(-(2.5 + 16 * near) * dt);
        ox[i] += (center.x - ox[i]) * lag;
        oy[i] += (center.y - oy[i]) * lag;
        a[i] += SPIN * near ** 1.5 * (1 + pull * 1.6) * (1 - burst * 0.5) * dt;
        r[i] -= r[i] * (0.03 + pull * 0.35) * dt;
        if (r[i] < inner * 0.92) {
          spawnDisk(i, false);
          continue;
        }
        const p = diskPoint(i);
        const sin = Math.sin(a[i]);
        // Brighter near the centre and on the side coming towards you (the left, as it turns).
        const t = 1 - (r[i] - inner) / (outer - inner);
        const toward = Math.cos(a[i]) < -0.2 ? 1 : 0;
        // Rings: brightness rises and falls with the radius, so the disk shows bands (fixed in place as particles
        // drift through them).
        const band = 0.55 + 0.45 * Math.sin((r[i] / hole) * 4.2) ** 2;
        const level = Math.max(0, Math.min(LEVELS - 1, Math.floor((0.25 + t ** 1.2) * shine[i] * band * LEVELS + toward)));
        // The near half passes in front of the hole (across its lower part), so the disk reads as orbiting round it.
        const path = sin > 0 ? front[level] : back[level];
        path.moveTo(px[i], py[i]);
        path.lineTo(p.x, p.y);
        px[i] = p.x;
        py[i] = p.y;
      }

      for (let j = 0; j < m; j++) {
        // The dust's own centre trails the hole slowly, so a moving hole drags streams after it.
        const lag = 1 - Math.exp(-1.6 * dt);
        dox[j] += (center.x - dox[j]) * lag;
        doy[j] += (center.y - doy[j]) * lag;
        // It turns the way the disk does (faster nearer in) and falls in, quickly far out and slowly near the disk,
        // so its path bends from a fall into an orbit. Holding the mouse pulls it in faster; the flare pushes it out.
        da[j] += SPIN * (inner / dr[j]) ** 1.2 * (1 + pull) * dt;
        dr[j] -= (30 + 0.12 * (dr[j] - outer)) * (1 + pull * 3) * dt;
        dr[j] += kick * 300 * dt;
        if (dr[j] < outer * 0.92) {
          spawnDust(j, false);
          continue;
        }
        const p = dustPoint(j);
        const level = Math.max(0, Math.min(LEVELS - 1, Math.floor((outer * 1.6) / dr[j])));
        back[level].moveTo(qx[j], qy[j]);
        back[level].lineTo(p.x, p.y);
        qx[j] = p.x;
        qy[j] = p.y;
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
