import { useEffect, useRef } from 'react';
import { motionReduced } from '../lib/motion';

/**
 * A black hole: a tilted, spinning disk of purple light round a black centre with a bright rim, after the classic
 * canvas "blackhole" demo. Each particle draws a short line from where it was to where it is, over a picture that
 * fades a little every frame, so the disk is made of light streaks.
 *
 * The hole glides after the pointer (and back to the open space under `below` when the pointer leaves). The disk
 * lags behind it, outer rings more than inner ones, so a quick move smears it into a comet. Loose dust across the
 * page falls in, spiralling, and is drawn as streams towards the pointer. Holding the mouse button down pulls
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
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const glow = glowRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !glow || !ctx) return;

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
    // Dust: position, velocity, last drawn point.
    let m = 0;
    let dx = new Float32Array(0);
    let dy = new Float32Array(0);
    let vx = new Float32Array(0);
    let vy = new Float32Array(0);
    let qx = new Float32Array(0);
    let qy = new Float32Array(0);

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

    const spawnDust = (j: number) => {
      // Somewhere on the page, away from the disk.
      for (let tries = 0; tries < 8; tries++) {
        dx[j] = Math.random() * width;
        dy[j] = Math.random() * height;
        if (Math.hypot(dx[j] - center.x, dy[j] - center.y) > outer * 1.4) break;
      }
      const ang = Math.atan2(dy[j] - center.y, dx[j] - center.x);
      // A small sideways push, so the dust spirals in rather than dropping straight.
      vx[j] = -Math.sin(ang) * 12;
      vy[j] = Math.cos(ang) * 12;
      qx[j] = dx[j];
      qy[j] = dy[j];
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
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      hole = Math.max(18, Math.min(60, Math.min(width, height * 2) * 0.062));
      inner = hole * 1.45;
      outer = Math.min(hole * 5.5, width * 0.42);
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
      dx = new Float32Array(m);
      dy = new Float32Array(m);
      vx = new Float32Array(m);
      vy = new Float32Array(m);
      qx = new Float32Array(m);
      qy = new Float32Array(m);
      for (let j = 0; j < m; j++) spawnDust(j);

      const size = outer * 3.2;
      glow.style.width = glow.style.height = `${size}px`;
      ctx.clearRect(0, 0, width, height);
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
        // The near half passes in front of the hole, except where it would cross the black centre (it reads as noise
        // there; the rim stays clean).
        const overHole = Math.hypot(p.x - center.x, p.y - center.y) < hole * 1.05;
        const path = sin > 0 && !overHole ? front[level] : back[level];
        path.moveTo(px[i], py[i]);
        path.lineTo(p.x, p.y);
        px[i] = p.x;
        py[i] = p.y;
      }

      for (let j = 0; j < m; j++) {
        const ex = center.x - dx[j];
        const ey = center.y - dy[j];
        const d = Math.hypot(ex, ey) || 1;
        // Reaching the disk, the dust joins it (and comes back elsewhere): left to circle, it would settle into a
        // round ring of its own.
        if (d < outer * 0.55) {
          spawnDust(j);
          continue;
        }
        // Gravity (softened so nothing slingshots), a sideways swirl, and drag.
        const g = (2.2e5 * (1 + pull * 4)) / (d * d + 2500) + 6;
        vx[j] += ((ex / d) * g - (ey / d) * g * 0.45) * dt * 6;
        vy[j] += ((ey / d) * g + (ex / d) * g * 0.45) * dt * 6;
        const drag = Math.exp(-0.9 * dt);
        vx[j] *= drag;
        vy[j] *= drag;
        // The flare pushes dust out too.
        vx[j] -= (ex / d) * kick * 260 * dt;
        vy[j] -= (ey / d) * kick * 260 * dt;
        dx[j] += vx[j] * dt;
        dy[j] += vy[j] * dt;
        if (dx[j] < -40 || dy[j] < -40 || dx[j] > width + 40 || dy[j] > height + 40) {
          spawnDust(j);
          continue;
        }
        const level = Math.max(0, Math.min(LEVELS - 1, Math.floor((outer * 1.6) / d)));
        back[level].moveTo(qx[j], qy[j]);
        back[level].lineTo(dx[j], dy[j]);
        qx[j] = dx[j];
        qy[j] = dy[j];
      }
    };

    const strokeAll = (paths: Path2D[]) => {
      for (let l = 0; l < LEVELS; l++) {
        ctx.strokeStyle = colours[l];
        ctx.lineWidth = 0.8 + l * 0.22;
        ctx.stroke(paths[l]);
      }
    };

    const draw = (dt: number) => {
      // Fade what is there (keeping the canvas see-through, so the page shows behind in both themes).
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${1 - Math.exp(-FADE * dt)})`;
      ctx.fillRect(0, 0, width, height);

      ctx.lineCap = 'round';
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      strokeAll(back);

      // The hole, with a thin bright rim of bent light.
      const h = hole * (1 - pull * 0.12);
      ctx.globalCompositeOperation = 'source-over';
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

      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      strokeAll(front);
      ctx.globalCompositeOperation = 'source-over';

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
    </div>
  );
}
