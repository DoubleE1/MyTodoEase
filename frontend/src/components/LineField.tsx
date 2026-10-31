import { useEffect, useRef } from 'react';
import { motionReduced } from '../lib/motion';

/** Where the word sits, in px from the canvas's top-left corner. */
export interface WordBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A background of fine horizontal lines with `word` raised out of them like an embossed print. The mouse pushes
 * the lines aside and they spring back; when `word` changes, the lines flow into the new word rather than jump.
 * Drawn on a canvas in the brand gradient; it only animates while lines are moving (an idle page costs nothing),
 * and with Reduce motion on (OS or Settings) it is a still picture.
 *
 * `below`: a CSS selector; the word sits in the open space under that element (e.g. the Home cards), so nothing
 * covers it. `onWordBox` reports where the word is, so the page can put an editor over it.
 */
export function LineField({
  word,
  below,
  className,
  onWordBox,
}: {
  word: string;
  below?: string;
  className?: string;
  onWordBox?: (box: WordBox) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Set by the drawing effect: re-shape the lines for a new word without starting over. */
  const setWordRef = useRef<((word: string) => void) | null>(null);
  const wordRef = useRef(word);
  const onWordBoxRef = useRef(onWordBox);
  onWordBoxRef.current = onWordBox;

  useEffect(() => {
    wordRef.current = word;
    setWordRef.current?.(word);
  }, [word]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    /** Gap between lines, and between the points along a line, in px. */
    const LINE_GAP = 7;
    const POINT_GAP = 5;
    /** How far the word lifts the lines, in px. */
    const LIFT = 20;
    const PUSH_RADIUS = 110;
    const PUSH_SPEED = 9;
    const SPRING = 0.1;
    const FONT = '"Segoe UI Black", "Arial Black", system-ui, sans-serif';

    type Point = { x: number; y: number; baseX: number; baseY: number };
    let lines: Point[][] = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let box = { left: 0, top: 0, right: 0, bottom: 0 };
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;
    let stroke: CanvasGradient | string = '#8a5cff';

    /** The word, drawn white on black and blurred a little, so its brightness lifts the lines smoothly. */
    const wordMask = (text: string, boxW: number, boxH: number) => {
      const mask = document.createElement('canvas');
      mask.width = Math.max(1, Math.round(boxW / 2));
      mask.height = Math.max(1, Math.round(boxH / 2));
      const m = mask.getContext('2d');
      if (!m) return null;
      m.fillStyle = '#000';
      m.fillRect(0, 0, mask.width, mask.height);
      m.filter = 'blur(1.5px)';
      m.fillStyle = '#fff';
      m.textAlign = 'center';
      m.textBaseline = 'middle';
      // As large as fits the box.
      let size = mask.height * 0.82;
      m.font = `900 ${size}px ${FONT}`;
      const measured = m.measureText(text).width;
      if (measured > mask.width * 0.92) size *= (mask.width * 0.92) / measured;
      m.font = `900 ${size}px ${FONT}`;
      m.fillText(text, mask.width / 2, mask.height / 2);
      return { data: m.getImageData(0, 0, mask.width, mask.height).data, w: mask.width, h: mask.height };
    };

    const readTheme = () => {
      const root = document.documentElement;
      const css = getComputedStyle(root);
      const dark = root.dataset.theme === 'dark';
      const stops = ['--brand-1', '--brand-2', '--brand-3'].map((name, i) => css.getPropertyValue(name).trim() || ['#4f96ff', '#8a5cff', '#ff5fa8'][i]);
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      stops.forEach((colour, i) => gradient.addColorStop(i / (stops.length - 1), colour));
      stroke = gradient;
      ctx.globalAlpha = dark ? 0.55 : 0.7;
    };

    /** Each point's resting height for `text`; with `keep`, points stay where they are and spring into place. */
    const shape = (text: string, keep: boolean) => {
      const mask = wordMask(text.toUpperCase() || ' ', box.right - box.left, box.bottom - box.top);
      lines.forEach((line, i) => {
        // Each line rests at its own height, lifted where it crosses the word.
        const restY = i * LINE_GAP;
        const inBox = mask && restY >= box.top && restY <= box.bottom;
        const my = inBox ? Math.min(mask.h - 1, Math.floor(((restY - box.top) / (box.bottom - box.top)) * mask.h)) : 0;
        for (const p of line) {
          let lift = 0;
          if (inBox && p.baseX >= box.left && p.baseX <= box.right) {
            const mx = Math.min(mask.w - 1, Math.floor(((p.baseX - box.left) / (box.right - box.left)) * mask.w));
            lift = (mask.data[(my * mask.w + mx) * 4] / 255) * LIFT;
          }
          p.baseY = restY - lift;
          if (!keep) p.y = p.baseY;
        }
      });
    };

    const layout = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // The word's box: across most of the width, about a quarter as tall, centred in the open space under `below`.
      const anchor = below ? document.querySelector(below)?.getBoundingClientRect() : null;
      const openTop = Math.max(height * 0.3, anchor ? anchor.bottom - rect.top + 32 : 0);
      const openBottom = Math.max(openTop + 140, height * 0.95);
      const boxH = Math.min(openBottom - openTop, Math.max(140, width * 0.26));
      const top = openTop + (openBottom - openTop - boxH) / 2;
      box = { left: width * 0.05, top, right: width * 0.95, bottom: top + boxH };
      onWordBoxRef.current?.({ left: box.left, top: box.top, width: box.right - box.left, height: boxH });

      lines = [];
      const count = Math.ceil(height / LINE_GAP) + 1;
      const cols = Math.ceil(width / POINT_GAP) + 1;
      for (let i = 0; i < count; i++) {
        const line: Point[] = [];
        for (let j = 0; j < cols; j++) {
          const x = j * POINT_GAP;
          line.push({ x, y: i * LINE_GAP, baseX: x, baseY: i * LINE_GAP });
        }
        lines.push(line);
      }
      shape(wordRef.current, false);
      readTheme();
      draw();
    };

    /** Push points away from the pointer and pull every point back to its place; true while anything moves. */
    const update = () => {
      let moving = false;
      for (const line of lines) {
        for (const p of line) {
          const startX = p.x;
          const startY = p.y;
          if (pointer) {
            const dx = p.x - pointer.x;
            const dy = p.y - pointer.y;
            const distance = Math.hypot(dx, dy);
            if (distance < PUSH_RADIUS && distance > 0.01) {
              const force = ((PUSH_RADIUS - distance) / PUSH_RADIUS) * PUSH_SPEED;
              p.x += (dx / distance) * force;
              p.y += (dy / distance) * force;
            }
          }
          p.x += (p.baseX - p.x) * SPRING;
          p.y += (p.baseY - p.y) * SPRING;
          // A resting pointer and the spring balance out: only a real change counts as moving.
          if (Math.abs(p.x - startX) > 0.02 || Math.abs(p.y - startY) > 0.02) moving = true;
        }
      }
      return moving;
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      for (const line of lines) {
        ctx.moveTo(line[0].x, line[0].y);
        // Smooth through the midpoints, so the lines bend instead of kinking.
        for (let i = 1; i < line.length; i++) {
          const prev = line[i - 1];
          const cur = line[i];
          ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + cur.x) / 2, (prev.y + cur.y) / 2);
        }
      }
      ctx.stroke();
    };

    const loop = () => {
      frame = 0;
      const moving = update();
      draw();
      // Keep going only while lines are moving; the next pointer move wakes it again.
      if (moving && !document.hidden) frame = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (!frame && !motionReduced()) frame = requestAnimationFrame(loop);
    };

    // A new word: the lines flow into it (or switch at once with Reduce motion).
    setWordRef.current = (next: string) => {
      const reduced = motionReduced();
      shape(next, !reduced);
      if (reduced) draw();
      else kick();
    };

    layout();
    const sizes = new ResizeObserver(layout);
    sizes.observe(canvas);
    const settings = new MutationObserver(() => {
      readTheme();
      draw();
    });
    settings.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // Fonts and data change the layout (the word box sits under the cards): look again once settled.
    const relayout = window.setTimeout(layout, 600);

    // Pointer events cover mouse, pen and touch alike.
    const onMove = (event: PointerEvent) => {
      if (motionReduced()) return;
      const rect = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      kick();
    };
    // Once the pointer leaves, it stops pushing and everything springs back.
    const onLeave = () => {
      pointer = null;
      kick();
    };
    window.addEventListener('pointermove', onMove);
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);

    return () => {
      setWordRef.current = null;
      cancelAnimationFrame(frame);
      window.clearTimeout(relayout);
      sizes.disconnect();
      settings.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
    };
  }, [below]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
