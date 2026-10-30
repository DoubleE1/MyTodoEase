import { useEffect, useState } from 'react';

export type ToastKind = 'info' | 'error' | 'success';
export interface ToastAction {
  label: string;
  run: () => void;
}
export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
  /** Toasts with the same group replace each other (e.g. one "Task completed" at a time). */
  group?: string;
}

export interface ToastOptions {
  action?: ToastAction;
  group?: string;
  /** How long it stays, in ms; defaults to 3 s (6 s for errors). */
  duration?: number;
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();
const timers = new Map<number, number>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

export function showToast(message: string, kind: ToastKind = 'info', options: ToastOptions = {}) {
  const toast: Toast = { id: nextId++, message, kind, action: options.action, group: options.group };
  const replaced = options.group ? toasts.filter((t) => t.group === options.group) : [];
  for (const old of replaced) window.clearTimeout(timers.get(old.id));
  toasts = [...toasts.filter((t) => !replaced.includes(t)), toast];
  emit();
  const duration = options.duration ?? (kind === 'error' ? 6000 : 3000);
  timers.set(toast.id, window.setTimeout(() => dismissToast(toast.id), duration));
  return toast.id;
}

export function dismissToast(id: number) {
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Removes every toast of a group, e.g. a completion toast whose Undo was done another way. */
export function dismissToastGroup(group: string) {
  for (const toast of toasts.filter((t) => t.group === group)) dismissToast(toast.id);
}

export function useToasts(): Toast[] {
  const [state, setState] = useState(toasts);
  useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}
