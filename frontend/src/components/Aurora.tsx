import { useEffect, useRef } from 'react';
import { motionReduced } from '../lib/motion';

/**
 * Northern lights over a night sky, after a photo of an aurora over a lake: ribbons of green light that sweep across
 * the sky, low over the mountain in the middle and rising towards the top corners, made of fine rays that fan out
 * (they point away from a spot below the horizon, so they lean outwards with the perspective); green and white at a
 * ribbon's lower edge, teal above, violet at the tips. Behind them a dark sky with twinkling stars; in front a black
 * mountain range and a still lake that reflects it all.
 *
 * Each ribbon's lower edge follows a curve round that spot, folding slowly (overlapping sine waves, so it never repeats
 * visibly), and its brightness shimmers along it, which shows as rays coming and going. The rays are drawn at half
 * size on a layer of their own, which is then laid over the sky twice: blurred (the soft glow) and sharp (the rays).
 *
 * The lights brighten towards the pointer; a click on the page itself (not on a card, button or field) sends a pulse
 * of brightness out along them. It always paints its own dark sky (in the light theme Home keeps its cards light over
 * it). It pauses while the window is hidden; with Reduce motion it draws one still picture.
 */
export function Aurora({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    /** Spacing of the rays along a ribbon, and each ray's width (px). */
    const SPACING = 3;
    const RAY_WIDTH = 14;
    /** The horizon (where the mountains meet the lake), as a share of the height. */
    const HORIZON = 0.8;
    /** The share of a ray picture below the ribbon's edge (a soft glow under it). */
    const EDGE = 0.08;
    /** The rays' layer is drawn at this scale (cheaper; the glow hides the difference). */
    const SCALE = 0.5;

    type Ribbon = {
      /** The span of directions it covers (radians either side of straight up). */
      from: number;
      to: number;
      /** Its edge's distance from the fan's centre (share of the height) straight up, how much further it is
       *  towards the sides (it rises there), and its folds (share of the height, waves per radian, speed). */
      near: number;
      rise: number;
      folds: { amp: number; k: number; speed: number; phase: number }[];
      /** Ray length (share of the height), brightness, shimmer speed and ray picture. */
      length: number;
      strength: number;
      shimmer: number;
      ray: HTMLCanvasElement;
    };

    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame = 0;
    let lastFrame = 0;
    let time = Math.random() * 100;
    let ribbons: Ribbon[] = [];
    let stars: { x: number; y: number; size: number; phase: number }[] = [];
    let mountains = new Path2D();
    const layer = document.createElement('canvas');
    const lctx = layer.getContext('2d');
    const canBlur = 'filter' in ctx;

    /** Where the pointer is felt (eases in and out) and its x; a click's pulse (where, and how long ago in s). */
    let pointerX: number | null = null;
    let lean = 0;
    let leanX = 0;
    let pulse: { x: number; age: number } | null = null;

    /**
     * One ray: a soft column (fading to both sides), its lower edge at EDGE from the bottom, brightest there and fading
     * upwards, the colour changing with height (`stops`: [position from the bottom, r, g, b, alpha]).
     */
    const raySprite = (stops: [number, number, number, number, number][]) => {
      const sprite = document.createElement('canvas');
      sprite.width = 16;
      sprite.height = 256;
      const s = sprite.getContext('2d');
      if (!s) return sprite;
      const g = s.createLinearGradient(0, 256, 0, 0);
      for (const [at, r, gr, b, a] of stops) g.addColorStop(at, `rgba(${r},${gr},${b},${a})`);
      s.fillStyle = g;
      s.fillRect(0, 0, 16, 256);
      s.globalCompositeOperation = 'destination-in';
      const across = s.createLinearGradient(0, 0, 16, 0);
      across.addColorStop(0, 'rgba(0,0,0,0)');
      across.addColorStop(0.5, 'rgba(0,0,0,1)');
      across.addColorStop(1, 'rgba(0,0,0,0)');
      s.fillStyle = across;
      s.fillRect(0, 0, 16, 256);
      return sprite;
    };

    /**
     * The mountains' outline: [across the page, height above the horizon] (both as shares): low on the left, climbing
     * to a broad high plateau with a small bump right of the middle, down into a valley, then rising steeply off the
     * right edge.
     */
    const RIDGE: [number, number][] = [
      [0, 0.03],
      [0.1, 0.022],
      [0.21, 0.02],
      [0.29, 0.047],
      [0.37, 0.083],
      [0.43, 0.102],
      [0.49, 0.124],
      [0.57, 0.12],
      [0.63, 0.12],
      [0.655, 0.129],
      [0.7, 0.066],
      [0.76, 0.051],
      [0.81, 0.044],
      [0.855, 0.049],
      [0.875, 0.073],
      [0.92, 0.127],
      [0.96, 0.166],
      [1, 0.193],
    ];

    /** The ridge's height at `u` (0 to 1 across), eased between its points (no corners). */
    const ridgeHeight = (u: number) => {
      let i = 1;
      while (i < RIDGE.length - 1 && RIDGE[i][0] < u) i++;
      const [x0, y0] = RIDGE[i - 1];
      const [x1, y1] = RIDGE[i];
      const t = Math.min(1, Math.max(0, (u - x0) / (x1 - x0 || 1)));
      return y0 + (y1 - y0) * (t * t * (3 - 2 * t));
    };

    const fold = (amp: number, k: number, speed: number) => ({ amp, k, speed, phase: Math.random() * Math.PI * 2 });

    /** The fan's centre: below the middle of the horizon. */
    const origin = () => ({ x: width * 0.5, y: height * 1.12 });

    const build = () => {
      const green = raySprite([
        [0, 120, 255, 190, 0],
        [EDGE, 210, 255, 225, 1],
        [0.13, 90, 255, 165, 0.85],
        [0.4, 50, 225, 150, 0.45],
        [0.68, 50, 175, 180, 0.18],
        [0.88, 120, 100, 230, 0.07],
        [1, 150, 80, 255, 0],
      ]);
      const teal = raySprite([
        [0, 90, 240, 230, 0],
        [EDGE, 170, 255, 230, 0.8],
        [0.2, 70, 230, 200, 0.5],
        [0.6, 60, 160, 210, 0.18],
        [1, 130, 90, 255, 0],
      ]);
      const violet = raySprite([
        [0, 120, 230, 200, 0],
        [EDGE, 130, 230, 200, 0.4],
        [0.35, 120, 150, 240, 0.28],
        [0.7, 180, 100, 240, 0.2],
        [1, 230, 90, 200, 0],
      ]);
      ribbons = [
        // The main ribbon: low over the middle, sweeping up to both top corners.
        { from: -1.25, to: 1.25, near: 0.46, rise: 1.0, length: 0.4, strength: 1, shimmer: 1, ray: green, folds: [fold(0.06, 2.3, 0.1), fold(0.025, 6.1, -0.18)] },
        // A second one behind and above it.
        { from: -1.1, to: 0.95, near: 0.62, rise: 0.75, length: 0.3, strength: 0.6, shimmer: 1.3, ray: teal, folds: [fold(0.05, 2.8, -0.08), fold(0.02, 7.3, 0.15)] },
        // A lower, flatter one in front: from the left edge down to the mountain's shoulder, behind it, and up to the
        // right edge.
        { from: -1.05, to: 1.05, near: 0.38, rise: 0.68, length: 0.22, strength: 0.5, shimmer: 1.15, ray: green, folds: [fold(0.035, 2.6, -0.09), fold(0.015, 6.8, 0.2)] },
        // A faint violet veil high on the left.
        { from: -1.3, to: -0.05, near: 0.82, rise: 0.5, length: 0.32, strength: 0.45, shimmer: 0.8, ray: violet, folds: [fold(0.05, 2.1, 0.07)] },
      ];

      const count = Math.round(Math.min(320, (width * height) / 4500));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height * HORIZON * 0.92,
        size: Math.random() < 0.85 ? 1 : 1.6,
        phase: Math.random() * Math.PI * 2,
      }));

      // Mountains: a ridge through RIDGE's points (smoothed), with a little roughness, down to the horizon.
      const horizon = height * HORIZON;
      const ridge = new Path2D();
      ridge.moveTo(0, horizon);
      const p1 = Math.random() * 10;
      const p2 = Math.random() * 10;
      for (let x = 0; x <= width + 6; x += 6) {
        const u = x / Math.max(1, width);
        const rough = Math.sin(x * 0.05 + p1) * 0.004 + Math.sin(x * 0.13 + p2) * 0.002 + Math.sin(x * 0.31 + p1) * 0.0015;
        ridge.lineTo(x, horizon - height * (ridgeHeight(u) + rough));
      }
      ridge.lineTo(width + 6, horizon);
      ridge.closePath();
      mountains = ridge;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layer.width = Math.max(1, Math.round(width * SCALE));
      layer.height = Math.max(1, Math.round(height * SCALE));
      build();
    };

    /** Brightness at a point along a ribbon (`along`: px along it, `x`: across the page). */
    const glow = (r: Ribbon, along: number, x: number) => {
      const patches = 0.5 + 0.5 * Math.sin(along * 0.0042 + time * 0.2 * r.shimmer + r.folds[0].phase) * Math.sin(along * 0.0019 - time * 0.12 + r.near * 9);
      const rays = 0.7 + 0.3 * Math.sin(along * 0.16 + time * 0.8 * r.shimmer + Math.sin(along * 0.027 + time * 0.35) * 3) * Math.sin(along * 0.061 - time * 0.5);
      const near = 1 + lean * 0.7 * Math.exp(-(((x - leanX) / 240) ** 2));
      let surge = 1;
      if (pulse) {
        const front = pulse.age * 520;
        surge += 1.5 * Math.exp(-pulse.age * 1.3) * Math.exp(-(((Math.abs(x - pulse.x) - front) / 100) ** 2));
      }
      return (0.15 + 0.85 * Math.max(0, patches)) * rays * near * surge * r.strength;
    };

    /** The rays, on the half-size layer. */
    const drawRays = () => {
      if (!lctx) return;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, layer.width, layer.height);
      lctx.globalCompositeOperation = 'lighter';
      const o = origin();
      for (const r of ribbons) {
        const length = r.length * height;
        let along = 0;
        let theta = r.from;
        while (theta <= r.to) {
          let distance = r.near + r.rise * theta * theta;
          for (const f of r.folds) distance += Math.sin(theta * f.k + time * f.speed + f.phase) * f.amp;
          distance *= height;
          const sin = Math.sin(theta);
          const cos = Math.cos(theta);
          const x = o.x + distance * sin;
          const y = o.y - distance * cos;
          // Next ray: SPACING px further along the ribbon.
          const step = SPACING / Math.max(60, distance);
          theta += step;
          along += SPACING;
          if (x < -80 || x > width + 80 || y > height * HORIZON + 40 || y < -length) continue;
          const g = glow(r, along, x);
          if (g < 0.03) continue;
          const h = length * (0.55 + 0.45 * Math.min(1, g));
          lctx.globalAlpha = Math.min(1, g * 0.46);
          // Rotated so the ray points away from the fan's centre.
          lctx.setTransform(cos * SCALE, sin * SCALE, -sin * SCALE, cos * SCALE, x * SCALE, y * SCALE);
          lctx.drawImage(r.ray, -RAY_WIDTH / 2, -h * (1 - EDGE), RAY_WIDTH, h);
        }
      }
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.globalAlpha = 1;
      lctx.globalCompositeOperation = 'source-over';
    };

    const drawSky = () => {
      const sky = ctx.createLinearGradient(0, 0, 0, height * HORIZON);
      sky.addColorStop(0, '#02040a');
      sky.addColorStop(0.6, '#051019');
      sky.addColorStop(1, '#081c24');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);
      // A faint violet haze high on the left, as in the photo.
      const haze = ctx.createRadialGradient(width * 0.2, height * 0.12, 0, width * 0.2, height * 0.12, width * 0.45);
      haze.addColorStop(0, 'rgba(90,50,140,0.22)');
      haze.addColorStop(1, 'rgba(90,50,140,0)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#ffffff';
      for (const s of stars) {
        ctx.globalAlpha = 0.3 + 0.35 * Math.sin(time * 1.3 + s.phase);
        ctx.fillRect(s.x, s.y, s.size, s.size);
      }
      ctx.globalAlpha = 1;
    };

    /** The rays' layer over the sky: blurred for the glow, then sharp for the rays. */
    const drawLights = () => {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (canBlur) {
        ctx.filter = 'blur(18px)';
        ctx.drawImage(layer, 0, 0, width, height);
        ctx.drawImage(layer, 0, 0, width, height);
        ctx.filter = 'none';
      }
      ctx.globalAlpha = 0.95;
      ctx.drawImage(layer, 0, 0, width, height);
      ctx.restore();
    };

    /** Mountains, then the lake: everything above the horizon, upside down and dimmed, with a dark gradient over it. */
    const drawLand = () => {
      const horizon = height * HORIZON;
      const depth = height - horizon;
      ctx.fillStyle = '#000000';
      ctx.fill(mountains);
      if (depth > 1) {
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.translate(0, horizon * 2);
        ctx.scale(1, -1);
        ctx.drawImage(canvas, 0, (horizon - depth) * dpr, width * dpr, depth * dpr, 0, horizon - depth, width, depth);
        ctx.restore();
        const water = ctx.createLinearGradient(0, horizon, 0, height);
        water.addColorStop(0, 'rgba(3,8,14,0.15)');
        water.addColorStop(1, 'rgba(2,5,10,0.85)');
        ctx.fillStyle = water;
        ctx.fillRect(0, horizon, width, depth);
      }
    };

    const draw = () => {
      drawRays();
      drawSky();
      drawLights();
      drawLand();
    };

    const step = (dt: number) => {
      time += dt;
      lean += ((pointerX === null ? 0 : 1) - lean) * (1 - Math.exp(-2.5 * dt));
      if (pointerX !== null) leanX += (pointerX - leanX) * (1 - Math.exp(-3 * dt));
      if (pulse) {
        pulse.age += dt;
        if (pulse.age > 3) pulse = null;
      }
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
        draw();
        return;
      }
      frame = requestAnimationFrame(loop);
    };

    resize();
    const sizes = new ResizeObserver(() => {
      resize();
      if (motionReduced()) draw();
    });
    sizes.observe(canvas);

    const inside = (event: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      return x >= 0 && y >= 0 && x <= rect.width && y <= rect.height ? { x, y } : null;
    };
    const onMove = (event: PointerEvent) => {
      const p = inside(event);
      if (p && pointerX === null) leanX = p.x;
      pointerX = p ? p.x : null;
    };
    const onLeave = () => {
      pointerX = null;
    };
    const onClick = (event: MouseEvent) => {
      const el = event.target instanceof Element ? event.target : null;
      const p = inside(event);
      if (event.button !== 0 || !p) return;
      if (el?.closest('a, button, input, select, textarea, label, summary, [role="button"], [role="menuitem"], [contenteditable="true"], .home-card, .home-bg-switcher')) return;
      pulse = { x: p.x, age: 0 };
    };
    const onVisible = () => {
      if (!document.hidden) start();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('click', onClick);
    window.addEventListener('blur', onLeave);
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisible);
    start();

    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('click', onClick);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
