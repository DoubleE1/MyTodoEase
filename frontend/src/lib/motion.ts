import autoAnimate, { type AutoAnimationPlugin } from '@formkit/auto-animate';
import { useCallback, useEffect, useState } from 'react';

/**
 * The app's motion system: one set of timings (mirrored by the --dur-* / --ease-* CSS variables), a
 * "Reduce motion" preference (the OS setting or the in-app switch), and the list animation used wherever
 * tasks appear, disappear or move.
 */

export const DURATION = { fast: 120, base: 180, slow: 260 } as const;
export const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
export const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';

const STORAGE_KEY = 'todoease.reduceMotion';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Puts the in-app choice on <html> so CSS can switch animations off; call once at startup. */
export function applyStoredMotionPreference() {
  document.documentElement.dataset.reduceMotion = readStored() ? 'true' : 'false';
}

/** True when animations should be skipped: the OS asks for less motion, or the user switched it off here. */
export function motionReduced(): boolean {
  if (document.documentElement.dataset.reduceMotion === 'true') return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The in-app "Reduce motion" switch (Settings > Appearance). */
export function useReduceMotionSetting() {
  const [reduce, setReduce] = useState(readStored);
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = reduce ? 'true' : 'false';
    try {
      localStorage.setItem(STORAGE_KEY, reduce ? 'on' : 'off');
    } catch {
      // Storage unavailable: the choice lasts for this session only.
    }
  }, [reduce]);
  return [reduce, setReduce] as const;
}

/**
 * List animations pause while something is being dragged (and briefly after the drop), so a sortable row
 * that already sits where it was dropped is not animated a second time when the list re-renders.
 */
let pausedUntil = 0;
let dragging = false;

export function setDragging(active: boolean) {
  dragging = active;
  if (!active) pausedUntil = performance.now() + 400;
}

const listPaused = () => dragging || performance.now() < pausedUntil || motionReduced();

/** Rows fade and drop in, slide out to the side, and the rest glide into their new places. */
const listAnimation: AutoAnimationPlugin = (el, action, oldCoords, newCoords) => {
  if (listPaused()) return new KeyframeEffect(el, [], { duration: 0 });
  if (action === 'add') {
    return new KeyframeEffect(
      el,
      [
        { opacity: 0, transform: 'translateY(-6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 200, easing: EASE_OUT },
    );
  }
  if (action === 'remove') {
    return new KeyframeEffect(
      el,
      [
        { opacity: 1, transform: 'translateX(0)' },
        { opacity: 0, transform: 'translateX(12px)' },
      ],
      { duration: 160, easing: EASE_IN },
    );
  }
  const dx = (oldCoords?.left ?? 0) - (newCoords?.left ?? 0);
  const dy = (oldCoords?.top ?? 0) - (newCoords?.top ?? 0);
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return new KeyframeEffect(el, [], { duration: 0 });
  return new KeyframeEffect(
    el,
    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
    { duration: 220, easing: EASE_OUT },
  );
};

/**
 * Ref callback that animates a list's children as they are added, removed or reordered. Combine with
 * another ref through mergeRefs when the element needs one too (e.g. a drop target).
 */
export function useListAnimation<T extends HTMLElement>() {
  return useCallback((el: T | null) => {
    if (el && !el.dataset.animated) {
      el.dataset.animated = 'true';
      autoAnimate(el, listAnimation);
    }
  }, []);
}

export function mergeRefs<T>(...refs: ((el: T | null) => void)[]) {
  return (el: T | null) => refs.forEach((r) => r(el));
}
