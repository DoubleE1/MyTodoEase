import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * App-wide keyboard shortcuts, rebindable in Settings > Shortcuts and remembered on this device.
 * `mod` means Ctrl on Windows/Linux and Cmd on a Mac. A shortcut can also be switched off (null).
 */
export type HotkeyAction = 'search' | 'quickAdd' | 'undo' | 'shortcuts' | 'settings' | 'toggleSidebar';

export interface Hotkey {
  /** `KeyboardEvent.key`, lower-cased (letters) or as typed (punctuation). */
  key: string;
  mod: boolean;
  alt: boolean;
  shift: boolean;
}

export const HOTKEY_ACTIONS: { action: HotkeyAction; label: string; hint: string }[] = [
  { action: 'search', label: 'Search', hint: 'Open search to find tasks, projects, labels and notes, or run an action.' },
  { action: 'quickAdd', label: 'Add task', hint: 'Open quick add from anywhere.' },
  {
    action: 'undo',
    label: 'Undo last action',
    hint: 'Reverses the last change to a task (one step). In a text field it undoes typing instead.',
  },
  { action: 'shortcuts', label: 'Keyboard shortcuts', hint: 'Show this list.' },
  { action: 'settings', label: 'Open Settings', hint: 'Works even while you are typing.' },
  { action: 'toggleSidebar', label: 'Collapse sidebar', hint: 'Switch the sidebar between full and icons only.' },
];

export const DEFAULT_HOTKEYS: Record<HotkeyAction, Hotkey | null> = {
  search: { key: 'k', mod: true, alt: false, shift: false },
  quickAdd: { key: 'q', mod: false, alt: false, shift: false },
  undo: { key: 'z', mod: true, alt: false, shift: false },
  shortcuts: { key: '/', mod: true, alt: false, shift: false },
  settings: { key: ',', mod: true, alt: false, shift: false },
  toggleSidebar: { key: 'm', mod: false, alt: false, shift: false },
};

const STORAGE_KEY = 'todoease.hotkeys';
const listeners = new Set<() => void>();
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function read(): Record<HotkeyAction, Hotkey | null> {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Record<HotkeyAction, Hotkey | null>>;
    return { ...DEFAULT_HOTKEYS, ...stored };
  } catch {
    return { ...DEFAULT_HOTKEYS };
  }
}

let current = read();

function save(next: Record<HotkeyAction, Hotkey | null>) {
  current = next;
  // Only the changed actions are stored, so new defaults in later versions still reach everyone else.
  const changed = Object.fromEntries(
    (Object.keys(next) as HotkeyAction[])
      .filter((a) => !sameHotkey(next[a], DEFAULT_HOTKEYS[a]))
      .map((a) => [a, next[a]]),
  );
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changed));
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
  listeners.forEach((l) => l());
}

export function setHotkey(action: HotkeyAction, hotkey: Hotkey | null) {
  save({ ...current, [action]: hotkey });
}

export function resetHotkeys() {
  save({ ...DEFAULT_HOTKEYS });
}

export function useHotkeys(): Record<HotkeyAction, Hotkey | null> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

export function sameHotkey(a: Hotkey | null, b: Hotkey | null): boolean {
  if (!a || !b) return a === b;
  return a.key === b.key && a.mod === b.mod && a.alt === b.alt && a.shift === b.shift;
}

const KEY_NAMES: Record<string, string> = { ' ': 'Space', ',': ',', '.': '.', '/': '/', arrowup: '↑', arrowdown: '↓' };

/** The platform's name for the Ctrl/Cmd modifier, for fixed shortcuts listed next to the rebindable ones. */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';
export const ALT_KEY = IS_MAC ? '⌥' : 'Alt';

/** Display parts, e.g. ['Ctrl', 'K'], for <kbd> chips and tooltips. */
export function hotkeyParts(hotkey: Hotkey): string[] {
  const parts: string[] = [];
  if (hotkey.mod) parts.push(IS_MAC ? '⌘' : 'Ctrl');
  if (hotkey.alt) parts.push(IS_MAC ? '⌥' : 'Alt');
  if (hotkey.shift) parts.push(IS_MAC ? '⇧' : 'Shift');
  parts.push(KEY_NAMES[hotkey.key] ?? (hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key));
  return parts;
}

export function formatHotkey(hotkey: Hotkey | null): string {
  return hotkey ? hotkeyParts(hotkey).join(IS_MAC ? '' : '+') : '';
}

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'CapsLock', 'OS']);
// Editing shortcuts every text field relies on; binding one would break copy, paste and undo.
const RESERVED_MOD_KEYS = new Set(['a', 'c', 'v', 'x', 'z', 'y']);

/**
 * Reads a shortcut from a key press in the recorder. Returns an error message for combinations that cannot be
 * used, or null while only modifiers are held.
 */
export function hotkeyFromEvent(event: KeyboardEvent, allowReserved = false): Hotkey | { error: string } | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const key = event.key.toLowerCase();
  const hotkey: Hotkey = { key, mod: event.ctrlKey || event.metaKey, alt: event.altKey, shift: event.shiftKey };
  if (hotkey.mod && !hotkey.alt && RESERVED_MOD_KEYS.has(key) && !allowReserved) {
    return { error: `${formatHotkey(hotkey)} is used for editing text. Pick another.` };
  }
  // Without Ctrl/Alt a shortcut fires on a bare key press, so it has to be a single printable key.
  if (!hotkey.mod && !hotkey.alt && event.key.length !== 1) {
    return { error: 'Use a single key (like Q) or add Ctrl or Alt.' };
  }
  if (!hotkey.mod && !hotkey.alt && key === ' ') return { error: 'Space is used to tick tasks. Pick another.' };
  return hotkey;
}

export function matchesHotkey(event: KeyboardEvent, hotkey: Hotkey | null): boolean {
  if (!hotkey) return false;
  return (
    event.key.toLowerCase() === hotkey.key &&
    (event.ctrlKey || event.metaKey) === hotkey.mod &&
    event.altKey === hotkey.alt &&
    event.shiftKey === hotkey.shift
  );
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/**
 * Runs `handler` when the action's shortcut is pressed. Bare-key shortcuts (like Q) are ignored while typing;
 * Ctrl/Alt shortcuts work anywhere unless a focused editor already handled the key.
 */
export function useHotkey(action: HotkeyAction, handler: () => void, enabled = true) {
  const hotkey = useHotkeys()[action];
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!enabled || !hotkey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || !matchesHotkey(event, hotkey)) return;
      // Bare keys would type into fields; Undo there must stay the field's own undo.
      if ((!hotkey.mod && !hotkey.alt) || action === 'undo') {
        if (isTyping(event.target)) return;
      }
      // The shortcut recorder in Settings is open: let it take the key.
      if (document.querySelector('[data-recording-hotkey]')) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hotkey, enabled, action]);
}
