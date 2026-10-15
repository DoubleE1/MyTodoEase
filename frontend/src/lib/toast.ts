import { useEffect, useState } from 'react';

export type ToastKind = 'info' | 'error';
export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

export function showToast(message: string, kind: ToastKind = 'info') {
  const toast = { id: nextId++, message, kind };
  toasts = [...toasts, toast];
  emit();
  window.setTimeout(() => dismissToast(toast.id), kind === 'error' ? 6000 : 3000);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
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
