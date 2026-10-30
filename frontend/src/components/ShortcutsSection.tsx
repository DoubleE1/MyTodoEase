import { RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  formatHotkey,
  hotkeyFromEvent,
  hotkeyParts,
  resetHotkeys,
  sameHotkey,
  setHotkey,
  useHotkeys,
  type Hotkey,
  type HotkeyAction,
} from '../lib/hotkeys';

function Keys({ hotkey }: { hotkey: Hotkey | null }) {
  if (!hotkey) return <span className="muted">None</span>;
  return (
    <span className="shortcut-keys">
      {hotkeyParts(hotkey).map((part) => (
        <kbd key={part}>{part}</kbd>
      ))}
    </span>
  );
}

/**
 * Settings > Shortcuts: rebind the app's keyboard shortcuts. Click a shortcut, press the new keys; Esc cancels,
 * Backspace turns the shortcut off. A combination already used by another action is refused with a message.
 */
export function ShortcutsSection() {
  const hotkeys = useHotkeys();
  const [recording, setRecording] = useState<HotkeyAction | null>(null);
  const [message, setMessage] = useState<{ action: HotkeyAction; text: string } | null>(null);

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

  return (
    <section className="settings-section">
      <h3>Shortcuts</h3>
      <p className="settings-help">
        Click a shortcut, then press the keys you want. Esc cancels; Backspace turns it off. Single-key shortcuts
        (like Q) do nothing while you are typing in a field.
      </p>
      <div className="shortcut-list">
        {HOTKEY_ACTIONS.map(({ action, label, hint }) => {
          const isRecording = recording === action;
          const changed = !sameHotkey(hotkeys[action], DEFAULT_HOTKEYS[action]);
          return (
            <div key={action} className="shortcut-row">
              <span className="settings-switch-text" id={`shortcut-${action}`}>
                <span>{label}</span>
                <span className="muted small">{message?.action === action ? message.text : hint}</span>
              </span>
              <button
                type="button"
                className={`shortcut-btn ${isRecording ? 'is-recording' : ''}`}
                data-recording-hotkey={isRecording ? '' : undefined}
                aria-labelledby={`shortcut-${action}`}
                aria-describedby={`shortcut-${action}-value`}
                onClick={() => {
                  setMessage(null);
                  setRecording(isRecording ? null : action);
                }}
                onBlur={() => isRecording && setRecording(null)}
              >
                <span id={`shortcut-${action}-value`} aria-live="polite">
                  {isRecording ? 'Press keys…' : <Keys hotkey={hotkeys[action]} />}
                </span>
              </button>
              <button
                type="button"
                className="icon-btn"
                data-tooltip={`Reset to ${formatHotkey(DEFAULT_HOTKEYS[action])}`}
                aria-label={`Reset ${label} to ${formatHotkey(DEFAULT_HOTKEYS[action])}`}
                disabled={!changed}
                style={{ visibility: changed ? 'visible' : 'hidden' }}
                onClick={() => setHotkey(action, DEFAULT_HOTKEYS[action])}
              >
                <RotateCcw size={14} />
              </button>
            </div>
          );
        })}
      </div>
      {customized && (
        <button type="button" className="link-btn" onClick={resetHotkeys}>
          Reset all to defaults
        </button>
      )}
    </section>
  );
}
