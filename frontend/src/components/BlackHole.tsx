import { useEffect, useRef } from 'react';
import { motionReduced } from '../lib/motion';

/**
 * A black hole: a tilted, spinning disk of purple light round a black centre with a bright rim, after the classic
 * canvas "blackhole" demo. Each particle is drawn with a short tail through where it was over the last moment,
 * fading towards its end, so the disk is made of light streaks. The tails are kept relative to the hole, so they
 * travel with it, and the canvas is cleared every frame (no fading picture, so no faint haze builds up).
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
 * Bent light: the far half of the disk is seen through the hole's gravity, so it arches up over the hole (each far
 * point is moved by the lens equation of a point mass: strongly just behind the hole, hardly at all far out), and a
 * thin faint arc shows under it. A soft glow fills the band round the hole (brightest over the top), with a thin
 * bright ring at its edge.
 *
 * The side coming towards you is brighter, and brightness rises and falls with the radius, which shows as rings.
 * It is made of added light, so it always needs a dark sky: in the light theme Home turns its page dark for it (the
 * cards stay light). It pauses while the window is hidden; with Reduce motion it draws one still picture.
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
    const SQUASH = 0.24;
    /** Turns per second at the disk's inner edge (radians); outer rings are slower by (inner / r) ^ 1.5. */
    const SPIN = 2.4;
    /**
     * The hole moves like a heavy mass on a spring towards the pointer: it speeds up and slows down smoothly
     * (critically damped, so it never overshoots), and never faster than its top speed, so the disk is carried
     * along instead of torn into straight streaks.
     */
    const SPRING = 10;
    const DAMPING = 2 * Math.sqrt(SPRING);
    /** Points kept for each particle's tail, one every TRAIL_STEP seconds (the tail's length), and how bright its
     *  newest, middle and oldest parts are. */
    const TRAIL = 6;
    const TRAIL_STEP = 1 / 30;
    const AGE_ALPHA = [1, 0.6, 0.28];
    /** Brightness levels, from the dim outer edge (0) to white (5), and their colours. */
    const LEVELS = 6;
    const COLOURS = ['rgba(96,56,200,0.55)', 'rgba(124,78,240,0.65)', 'rgba(152,102,255,0.75)', 'rgba(184,142,255,0.85)', 'rgba(222,200,255,0.9)', 'rgba(255,246,255,0.95)'];
    /** The arch of the bent far side: its inner edge's distance from the centre, and the most the outer rings sit
     *  above that (both in hole radii), so the whole far side is squeezed into a thin band at the bright edge. */
    const LENS = 1.12;
    const ARCH_RISE = 0.45;

    let width = 0;
    let height = 0;
    let frame = 0;
    let lastFrame = 0;
    /** Time since the tails last took a point. */
    let sinceSample = 0;

    /** Horizon radius, and the disk's inner and outer edges (px). */
    let hole = 30;
    let inner = 45;
    let outer = 180;
    let home = { x: 0, y: 0 };
    let center = { x: 0, y: 0 };
    let target = { x: 0, y: 0 };
    /** The hole's velocity (px per second), and its top speed (set with the size). */
    let velocity = { x: 0, y: 0 };
    let topSpeed = 240;
    /** Holding the mouse down: 0 to 1, easing towards `pullTarget`. */
    let pull = 0;
    let pullTarget = 0;
    /** The flare after a click: `kick` jumps to 1 and decays; `burst` eases after it. */
    let kick = 0;
    let burst = 0;

    // Particles: the radius and angle of their orbit round the hole (in the disk's plane), their own centre (trailing
    // the hole), sparkle, and their tail's points (relative to the hole, newest first). One set for everything: a
    // particle starts at the page's edge, spirals in, slows down and joins the disk, drifts through it, and drops into
    // the hole.
    let n = 0;
    let r = new Float32Array(0);
    let a = new Float32Array(0);
    let ox = new Float32Array(0);
    let oy = new Float32Array(0);
    let hx = new Float32Array(0);
    let hy = new Float32Array(0);
    let shine = new Float32Array(0);
    /** Where particles start: the page's far corner from the hole. */
    let reach = 400;

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
     *
     * Behind the hole its light is bent by the hole's gravity, so the far side of the disk is seen arching up over
     * the hole. Each ring of the far side is lifted (straight up, never sideways, so neighbouring streaks never cross)
     * onto a round arch hugging the hole: the inner edge just outside it, outer rings only a little higher, so the
     * whole disk's width is squeezed into a thin bright band over the top. Where the arch comes down to the flat disk the two are
     * blended smoothly, so the arch flows into the disk on both sides. Far out (the dust) nothing is bent.
     */
    const point = (i: number) => {
      const flat = smoothstep(outer, outer * 3.5, r[i]);
      const squash = SQUASH + (1 - SQUASH) * flat;
      const spread = 1 + burst * (0.4 + 0.6 * Math.min(1, Math.max(0, (r[i] - inner) / (outer - inner))));
      const re = r[i] * spread;
      const lx = Math.cos(a[i]) * re;
      let ly = Math.sin(a[i]) * re * squash;
      if (ly < 0) {
        // The arch for this ring: a circle round the hole, higher for rings further out but levelling off quickly, so
        // even the outermost rings stay within ARCH_RISE of the inner edge.
        const radius = hole * (LENS + ARCH_RISE * (1 - Math.exp(-Math.max(0, r[i] - inner) / (hole * 2.5))));
        const arch = Math.abs(lx) < radius ? Math.sqrt(radius * radius - lx * lx) : 0;
        if (arch > 0) {
          // A smooth "higher of the two" (the arch or the flat disk), softest where the arch is high, sharp where it
          // meets the disk (so it joins it exactly). Fades out beyond the disk.
          const height = -ly;
          const soft = Math.min(hole * 0.35, arch);
          const lifted = (height + arch + Math.sqrt((height - arch) ** 2 + soft * soft)) / 2;
          ly = -(height + (lifted - height) * (1 - smoothstep(outer, outer * 1.6, r[i])));
        }
      }
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
      // A new particle has no tail yet: every point of it is where the particle is.
      const p = point(i);
      hx.fill(p.x - center.x, i * TRAIL, (i + 1) * TRAIL);
      hy.fill(p.y - center.y, i * TRAIL, (i + 1) * TRAIL);
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
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // The disk's size follows the space; the hole is small inside it, so most of the disk is light.
      const scale = Math.max(18, Math.min(60, Math.min(width, height * 2) * 0.062));
      hole = scale * 0.6;
      inner = hole * 1.35;
      outer = Math.min(scale * 5.5, width * 0.42);
      home = restPoint();
      center = { ...home };
      target = { ...home };
      velocity = { x: 0, y: 0 };
      // Crossing about its own disk's width per second at most.
      topSpeed = Math.max(140, outer * 0.8);

      const area = width * height;
      n = Math.round(Math.max(560, Math.min(1660, area / 800)));
      reach = Math.hypot(Math.max(center.x, width - center.x), Math.max(center.y, height - center.y)) + 40;
      r = new Float32Array(n);
      a = new Float32Array(n);
      ox = new Float32Array(n);
      oy = new Float32Array(n);
      hx = new Float32Array(n * TRAIL);
      hy = new Float32Array(n * TRAIL);
      shine = new Float32Array(n);
      const radii = journey();
      for (let i = 0; i < n; i++) {
        shine[i] = 0.55 + Math.random() * 0.6;
        spawn(i, radii[Math.floor(Math.random() * radii.length)]);
      }

      const size = outer * 3.2;
      glow.style.width = glow.style.height = `${size}px`;
      ctx.clearRect(0, 0, width, height);
    };

    // One path per tail age and brightness level, behind and in front of the hole.
    const back: Path2D[] = [];
    const front: Path2D[] = [];

    const step = (dt: number) => {
      velocity.x += ((target.x - center.x) * SPRING - velocity.x * DAMPING) * dt;
      velocity.y += ((target.y - center.y) * SPRING - velocity.y * DAMPING) * dt;
      const speed = Math.hypot(velocity.x, velocity.y);
      if (speed > topSpeed) {
        velocity.x *= topSpeed / speed;
        velocity.y *= topSpeed / speed;
      }
      center.x += velocity.x * dt;
      center.y += velocity.y * dt;
      pull += (pullTarget - pull) * (1 - Math.exp(-5 * dt));
      kick *= Math.exp(-2.2 * dt);
      burst += (kick - burst) * (1 - Math.exp(-9 * dt));

      for (let k = 0; k < AGE_ALPHA.length * LEVELS; k++) {
        back[k] = new Path2D();
        front[k] = new Path2D();
      }
      sinceSample += dt;
      const sample = sinceSample >= TRAIL_STEP;
      if (sample) sinceSample %= TRAIL_STEP;

      for (let i = 0; i < n; i++) {
        // Each orbit is carried along with the hole: inner ones tightly, outer ones and the dust on its way in a
        // little behind, so a moving hole draws a short comet tail rather than leaving its disk behind.
        const lag = 1 - Math.exp(-(1.2 + 24 * (inner / r[i]) ** 0.8) * dt);
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
        const paths = Math.sin(a[i]) > 0 && r[i] < outer * 1.4 ? front : back;
        // The tail: from where the particle is back through its earlier points (relative to the hole, so it travels
        // with it), two segments per age. Past the disk's inner edge, in its last quick plunge, it is no longer drawn
        // (its tail would point straight in, as a spike); the ring of bent light round the hole covers that gap.
        const base = i * TRAIL;
        const plunging = r[i] < inner;
        let x = p.x;
        let y = p.y;
        for (let k = 0; k < TRAIL && !plunging; k++) {
          const path = paths[(k >> 1) * LEVELS + level];
          const nx = hx[base + k] + center.x;
          const ny = hy[base + k] + center.y;
          path.moveTo(x, y);
          path.lineTo(nx, ny);
          x = nx;
          y = ny;
        }
        if (sample) {
          hx.copyWithin(base + 1, base, base + TRAIL - 1);
          hy.copyWithin(base + 1, base, base + TRAIL - 1);
          hx[base] = p.x - center.x;
          hy[base] = p.y - center.y;
        }
        // The far side's light also reaches us bent the other way round the hole, as a thin faint arc under it.
        if (!plunging && r[i] < outer && Math.sin(a[i]) < 0) underArc(i, level);
      }
    };

    /** The far side's second image: the inner part of the disk squeezed into a thin arc just under the hole. */
    const underArc = (i: number, level: number) => {
      const u = Math.min(1, Math.max(0, (r[i] - inner) / (outer - inner)));
      if (u >= 0.45) return;
      const radius = hole * (1.06 + 0.4 * u);
      const arc = (angle: number) => {
        const lx = Math.cos(angle) * radius;
        const ly = -Math.sin(angle) * radius;
        return { x: center.x + lx * Math.cos(TILT) - ly * Math.sin(TILT), y: center.y + lx * Math.sin(TILT) + ly * Math.cos(TILT) };
      };
      const from = arc(a[i] - turnSpeed(r[i]) * 0.2);
      const to = arc(a[i]);
      const path = back[2 * LEVELS + Math.max(0, level - 1)];
      path.moveTo(from.x, from.y);
      path.lineTo(to.x, to.y);
    };

    const strokeAll = (c: CanvasRenderingContext2D, paths: Path2D[]) => {
      c.lineCap = 'round';
      // Light adds up: white where streaks cross.
      c.globalCompositeOperation = 'lighter';
      AGE_ALPHA.forEach((alpha, age) => {
        c.globalAlpha = alpha;
        for (let l = 0; l < LEVELS; l++) {
          c.strokeStyle = COLOURS[l];
          c.lineWidth = 0.8 + l * 0.22;
          c.stroke(paths[age * LEVELS + l]);
        }
      });
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      strokeAll(ctx, back);

      // The bent light round the hole as one continuous glow, so the band between the hole and the arched far side
      // is filled (the streaks alone spread thin there, where the bending stretches them, and the page showed
      // through). Brightest at the hole's edge and fading outwards; centred a little above the hole, so the arch
      // over the top glows most. Then a thin bright ring right at the edge. The hole covers the middle.
      const h = hole * (1 - pull * 0.12);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gy = center.y - h * 0.22;
      const halo = ctx.createRadialGradient(center.x, gy, h * 0.9, center.x, gy, h * 2.5);
      halo.addColorStop(0, 'rgba(245,235,255,0.85)');
      halo.addColorStop(0.18, 'rgba(215,190,255,0.6)');
      halo.addColorStop(0.45, 'rgba(170,130,255,0.28)');
      halo.addColorStop(0.75, 'rgba(130,90,240,0.08)');
      halo.addColorStop(1, 'rgba(130,90,240,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(center.x, gy, h * 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(240,228,255,0.8)';
      ctx.lineWidth = h * 0.16;
      ctx.shadowColor = 'rgba(190,150,255,0.9)';
      ctx.shadowBlur = h * 0.4;
      ctx.beginPath();
      ctx.arc(center.x, center.y, h * 1.06, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // The hole, with a thin bright rim of bent light.
      ctx.fillStyle = '#05030a';
      ctx.beginPath();
      ctx.arc(center.x, center.y, h, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.shadowColor = 'rgba(190,150,255,0.9)';
      ctx.shadowBlur = h * 0.5;
      ctx.strokeStyle = 'rgba(255,250,255,0.95)';
      ctx.lineWidth = Math.max(1.2, h * 0.07);
      ctx.beginPath();
      ctx.arc(center.x, center.y, h * 1.03, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // The near half of the disk, over the hole.
      strokeAll(ctx, front);

      const size = outer * 3.2;
      glow.style.transform = `translate(${center.x - size / 2}px, ${center.y - size / 2}px) scale(${1 + burst * 0.4})`;
      glow.style.opacity = String(0.85 + pull * 0.15);
    };

    const loop = (now: number) => {
      frame = 0;
      const dt = Math.min(0.05, lastFrame ? (now - lastFrame) / 1000 : 1 / 60);
      lastFrame = now;
      step(dt);
      draw();
      if (!document.hidden && !motionReduced()) frame = requestAnimationFrame(loop);
      else lastFrame = 0;
    };
    const start = () => {
      if (frame) return;
      if (motionReduced()) {
        // One still picture: a moment of the disk turning (long enough for the tails to fill in).
        for (let k = 0; k < 24; k++) {
          step(1 / 60);
          draw();
        }
        return;
      }
      frame = requestAnimationFrame(loop);
    };

    resize();
    const sizes = new ResizeObserver(() => {
      resize();
      if (motionReduced()) start();
    });
    sizes.observe(canvas);

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
    </div>
  );
}
