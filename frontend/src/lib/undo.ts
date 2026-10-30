import { dismissToastGroup, showToast } from './toast';

/**
 * One-step undo (Ctrl+Z by default): every task change records how to reverse itself here, replacing the
 * previous entry, so only the most recent action can be undone. Undoing empties the slot.
 */
export interface UndoEntry {
  /** What was done, for the toast: "rescheduled “Buy milk”". */
  label: string;
  run: () => Promise<void>;
}

let current: UndoEntry | null = null;
/** Entries already undone: an old toast's Undo button must not reverse the same thing twice. */
const used = new WeakSet<UndoEntry>();
let grouping = 0;

/** Remembers how to reverse the action that just happened (ignored inside a grouped action, see asOneUndo). */
export function recordUndo(entry: UndoEntry): UndoEntry {
  if (grouping === 0) current = entry;
  return entry;
}

/**
 * A change that cannot be reversed (e.g. deleting a completed task) still counts as the last action, so Ctrl+Z
 * does not reach past it to an older one.
 */
export function recordIrreversible(label: string, reason: string) {
  recordUndo({
    label,
    run: async () => {
      throw new Error(reason);
    },
  });
}

/** Runs an undo without recording the changes it makes, so undoing never becomes the next thing to undo. */
async function runQuietly(entry: UndoEntry) {
  if (used.has(entry)) return;
  used.add(entry);
  grouping += 1;
  try {
    await entry.run();
  } finally {
    grouping -= 1;
  }
}

/** Undo button on a toast: runs that entry, and clears the slot if it was still the last action. */
export function runUndo(entry: UndoEntry): Promise<void> {
  if (current === entry) current = null;
  return runQuietly(entry);
}

/** Ctrl+Z: reverse the last action, if any. */
export async function undoLast(): Promise<void> {
  const entry = current;
  current = null;
  if (!entry) {
    showToast('Nothing to undo.', 'info', { group: 'undo' });
    return;
  }
  // The "Task completed · Undo" toast is for the same action; it has done its job.
  dismissToastGroup('task-completed');
  try {
    await runQuietly(entry);
    showToast(`Undone: ${entry.label}.`, 'info', { group: 'undo' });
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Could not undo that.', 'error', { group: 'undo' });
  }
}

/**
 * Several changes made as one action (e.g. "Plan my day", "Continue tomorrow"): the individual changes inside
 * `work` record nothing, and the whole action is undone at once with `undo`.
 */
export async function asOneUndo<T>(
  label: string,
  work: () => Promise<T>,
  undo: (result: T) => Promise<void>,
): Promise<{ result: T; entry: UndoEntry }> {
  grouping += 1;
  let result: T;
  try {
    result = await work();
  } finally {
    grouping -= 1;
  }
  const entry = recordUndo({ label, run: () => undo(result) });
  return { result, entry };
}
