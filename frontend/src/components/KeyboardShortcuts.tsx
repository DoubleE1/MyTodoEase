import { RotateCcw, Search } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import {
  ALT_KEY,
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  MOD_KEY,
  formatHotkey,
  hotkeyFromEvent,
  hotkeyParts,
  resetHotkeys,
  sameHotkey,
  setHotkey,
  useHotkeys,
  type HotkeyAction,
} from '../lib/hotkeys';
import { Modal } from './Dialogs';

/**
 * Every keyboard shortcut in the app, searchable and grouped. The "General" shortcuts can be rebound in place:
 * click the keys, press new ones (Esc cancels, Backspace turns it off). The rest are fixed and listed for
 * reference. Shown as its own dialog (Ctrl+/ by default) and as Settings > Shortcuts.
 */

/** A fixed shortcut: each inner array is one combination; several combinations read as "or". */
interface FixedShortcut {
  label: string;
  keys: string[][];
}

const FIXED_GROUPS: { title: string; items: FixedShortcut[] }[] = [
  {
    title: 'Search',
    items: [
      { label: 'Open the highlighted result', keys: [['↵']] },
      { label: 'Move through results', keys: [['↑'], ['↓']] },
      { label: 'Next / previous result type', keys: [['Tab'], ['Shift', 'Tab']] },
      { label: 'Close', keys: [['Esc']] },
    ],
  },
  {
    title: 'Tasks',
    items: [
      { label: 'Open the focused task', keys: [['↵']] },
      { label: 'Save a new task (title field)', keys: [['↵']] },
      { label: 'Save from the description', keys: [[MOD_KEY, '↵']] },
      { label: 'Cancel editing', keys: [['Esc']] },
    ],
  },
  {
    title: 'Description',
    items: [
      { label: 'Bold', keys: [[MOD_KEY, 'B']] },
      { label: 'Italic', keys: [[MOD_KEY, 'I']] },
      { label: 'Insert link', keys: [[MOD_KEY, 'K']] },
      { label: 'Add table row or column', keys: [[MOD_KEY, ALT_KEY, '←↑→↓']] },
      { label: 'Move table row or column', keys: [[MOD_KEY, ALT_KEY, 'Shift', '←↑→↓']] },
    ],
  },
  {
    title: 'Notes board',
    items: [
      { label: 'Move the focused note', keys: [['←↑→↓']] },
      { label: 'Move it further', keys: [['Shift', '←↑→↓']] },
      { label: 'Resize the focused note', keys: [[MOD_KEY, '←↑→↓']] },
      { label: 'Zoom', keys: [['Scroll'], [MOD_KEY, 'Scroll']] },
      { label: 'Pan', keys: [['Shift', 'Scroll']] },
    ],
  },
  {
    title: 'Dialogs and menus',
    items: [{ label: 'Close', keys: [['Esc']] }],
  },
];

function Keys({ combos }: { combos: string[][] }) {
  return (
    <span className="kb-keys">
      {combos.map((combo, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="kb-or">or</span>}
          <span className="kb-combo">
            {combo.map((part) => (
              <kbd key={part}>{part}</kbd>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

const matches = (query: string, ...texts: string[]) => {
  const q = query.trim().toLowerCase();
  return !q || texts.some((t) => t.toLowerCase().includes(q));
};

export function ShortcutsPanel({ autoFocus = false }: { autoFocus?: boolean }) {
  const hotkeys = useHotkeys();
  const [query, setQuery] = useState('');
  const [recording, setRecording] = useState<HotkeyAction | null>(null);
  const [message, setMessage] = useState<{ action: HotkeyAction; text: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) searchRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!recording) return;
    // Capture phase on window runs before every other key handler (dialog Escape, app shortcuts), and
    // stopping it there keeps the key from reaching them.
    const onKeyDown = (event: KeyboardEvent) => {
      // Tab still moves focus (and the blur ends recording), so keyboard users never get stuck.
      if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecording(null);
        return;
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        setHotkey(recording, null);
        setMessage(null);
        setRecording(null);
        return;
      }
      const result = hotkeyFromEvent(event);
      if (!result) return;
      if ('error' in result) {
        setMessage({ action: recording, text: result.error });
        return;
      }
      const clash = HOTKEY_ACTIONS.find((a) => a.action !== recording && sameHotkey(hotkeys[a.action], result));
      if (clash) {
        setMessage({ action: recording, text: `${formatHotkey(result)} is already used for “${clash.label}”.` });
        return;
      }
      setHotkey(recording, result);
      setMessage(null);
      setRecording(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, hotkeys]);

  const customized = HOTKEY_ACTIONS.some((a) => !sameHotkey(hotkeys[a.action], DEFAULT_HOTKEYS[a.action]));
  const general = HOTKEY_ACTIONS.filter((a) =>
    matches(query, 'general', a.label, a.hint, formatHotkey(hotkeys[a.action])),
  );
  const fixed = FIXED_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((item) => matches(query, g.title, item.label, item.keys.flat().join(' '))),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="kb-panel">
      <label className="kb-search">
        <Search size={15} aria-hidden="true" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search shortcuts"
          aria-label="Search shortcuts"
        />
      </label>

      {general.length > 0 && (
        <section className="kb-group" aria-labelledby="kb-general">
          <div className="kb-group-head">
            <h4 id="kb-general">General</h4>
            <span className="muted small">Click the keys to change them</span>
            {customized && (
              <button type="button" className="link-btn" onClick={resetHotkeys}>
                Reset all
              </button>
            )}
          </div>
          {general.map(({ action, label, hint }) => {
            const isRecording = recording === action;
            const hotkey = hotkeys[action];
            const changed = !sameHotkey(hotkey, DEFAULT_HOTKEYS[action]);
            const note = message?.action === action ? message.text : null;
            return (
              <div key={action} className="kb-row">
                <span className="kb-label" id={`kb-${action}`}>
                  <span>{label}</span>
                  <span className={`small ${note ? 'kb-error' : 'muted'}`}>{note ?? hint}</span>
                </span>
                {changed && (
                  <button
                    type="button"
                    className="icon-btn kb-reset"
                    data-tooltip={`Reset to ${formatHotkey(DEFAULT_HOTKEYS[action])}`}
                    aria-label={`Reset ${label} to ${formatHotkey(DEFAULT_HOTKEYS[action])}`}
                    onClick={() => setHotkey(action, DEFAULT_HOTKEYS[action])}
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className={`kb-edit ${isRecording ? 'is-recording' : ''}`}
                  data-recording-hotkey={isRecording ? '' : undefined}
                  aria-labelledby={`kb-${action}`}
                  aria-describedby={`kb-${action}-value`}
                  onClick={() => {
                    setMessage(null);
                    setRecording(isRecording ? null : action);
                  }}
                  onBlur={() => isRecording && setRecording(null)}
                >
                  <span id={`kb-${action}-value`} aria-live="polite">
                    {isRecording ? (
                      'Press keys…'
                    ) : hotkey ? (
                      <Keys combos={[hotkeyParts(hotkey)]} />
                    ) : (
                      <span className="muted">Off</span>
                    )}
                  </span>
                </button>
              </div>
            );
          })}
        </section>
      )}

      {fixed.map((group) => (
        <section key={group.title} className="kb-group" aria-label={group.title}>
          <div className="kb-group-head">
            <h4>{group.title}</h4>
          </div>
          {group.items.map((item) => (
            <div key={item.label} className="kb-row">
              <span className="kb-label">{item.label}</span>
              <Keys combos={item.keys} />
            </div>
          ))}
        </section>
      ))}

      {general.length === 0 && fixed.length === 0 && (
        <p className="muted kb-empty">No shortcuts match “{query.trim()}”.</p>
      )}
    </div>
  );
}

export function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} className="modal-shortcuts">
      <ShortcutsPanel autoFocus />
    </Modal>
  );
}
