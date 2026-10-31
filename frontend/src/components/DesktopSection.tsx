import { RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { acceleratorFromEvent, acceleratorParts, GLOBAL_HOTKEY_DEFAULTS, useDesktopPrefs, type GlobalHotkeyAction } from '../lib/globalHotkeys';
import { SettingRow, SwitchRow } from './SettingRows';
import { t } from '../i18n';

const ACTIONS: { action: GlobalHotkeyAction; label: string; hint: string }[] = [
  { action: 'newTask', label: t('New task'), hint: t('Opens a small add-task box over whatever app you are in.') },
  { action: 'newNote', label: t('New sticky note'), hint: t('Opens a new sticky note in its own window.') },
];

/**
 * Settings > Desktop app: start with Windows, keep running in the tray, and the global shortcuts that work in
 * every app (like Ditto's Ctrl+`). The shell owns these settings; the page reads and changes them over IPC.
 */
export function DesktopSection() {
  const { prefs, update } = useDesktopPrefs();
  const [recording, setRecording] = useState<GlobalHotkeyAction | null>(null);
  const [message, setMessage] = useState<{ action: GlobalHotkeyAction; text: string } | null>(null);

  useEffect(() => {
    if (!recording || !prefs) return;
    // Capture phase: the recorder takes the key before the dialog (Escape) or any app shortcut sees it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && !event.ctrlKey && !event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecording(null);
        return;
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && !event.ctrlKey && !event.altKey) {
        void update({ hotkeys: { [recording]: null } });
        setMessage(null);
        setRecording(null);
        return;
      }
      const result = acceleratorFromEvent(event);
      if (!result) return;
      if (typeof result !== 'string') {
        setMessage({ action: recording, text: result.error });
        return;
      }
      const clash = ACTIONS.find((a) => a.action !== recording && prefs.hotkeys[a.action] === result);
      if (clash) {
        setMessage({ action: recording, text: t('Already used for “{name}”.', { name: clash.label }) });
        return;
      }
      void update({ hotkeys: { [recording]: result } });
      setMessage(null);
      setRecording(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, prefs, update]);

  if (!prefs) return null;

  return (
    <section className="settings-section">
      <h3>{t('Desktop app')}</h3>
      <div className="settings-group">
        <SwitchRow
          id="start-with-windows"
          title={t('Start with Windows')}
          description={
            !prefs.startWithWindowsAvailable
              ? t('Available in the installed app.')
              : prefs.startupBlockedByWindows
                ? t('Turned off in Windows Settings > Apps > Startup. Turn it on there.')
                : t('Opens TodoEase in the background when you sign in, so the shortcuts below work straight away.')
          }
          on={prefs.startWithWindows}
          disabled={!prefs.startWithWindowsAvailable}
          onChange={(on) => void update({ startWithWindows: on })}
        />
        <SwitchRow
          id="keep-in-tray"
          title={t('Keep running in the background')}
          description={t('Closing the window keeps TodoEase in the notification area by the clock. Right-click its icon to quit.')}
          on={prefs.keepInTray}
          onChange={(on) => void update({ keepInTray: on })}
        />
      </div>

      <h3>{t('Shortcuts in any app')}</h3>
      <p className="settings-help">
        {prefs.keepInTray
          ? t('These work while TodoEase is open or in the background. Click the keys to change them; Backspace turns one off.')
          : t('These work while TodoEase is open. Turn on “Keep running in the background” to use them after closing the window.')}
      </p>
      <div className="settings-group">
        {ACTIONS.map(({ action, label, hint }) => {
          const value = prefs.hotkeys[action];
          const isRecording = recording === action;
          const error = message?.action === action ? message.text : prefs.hotkeyErrors[action] ? t('Another app is using this shortcut. Pick another.') : null;
          const changed = value !== GLOBAL_HOTKEY_DEFAULTS[action];
          return (
            <SettingRow
              key={action}
              title={label}
              labelId={`global-${action}`}
              description={<span className={error ? 'kb-error' : undefined}>{error ?? hint}</span>}
            >
              <div className="global-hotkey-control">
                {changed && (
                  <button
                    type="button"
                    className="icon-btn kb-reset"
                    data-tooltip={t('Reset to {keys}', { keys: acceleratorParts(GLOBAL_HOTKEY_DEFAULTS[action]).join('+') })}
                    aria-label={t('Reset to {keys}', { keys: acceleratorParts(GLOBAL_HOTKEY_DEFAULTS[action]).join('+') })}
                    onClick={() => {
                      setMessage(null);
                      void update({ hotkeys: { [action]: GLOBAL_HOTKEY_DEFAULTS[action] } });
                    }}
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className={`kb-edit ${isRecording ? 'is-recording' : ''}`}
                  data-recording-hotkey={isRecording ? '' : undefined}
                  aria-labelledby={`global-${action}`}
                  onClick={() => {
                    setMessage(null);
                    setRecording(isRecording ? null : action);
                  }}
                  onBlur={() => isRecording && setRecording(null)}
                >
                  <span aria-live="polite">
                    {isRecording ? (
                      t('Press keys…')
                    ) : value ? (
                      <span className="kb-keys">
                        <span className="kb-combo">
                          {acceleratorParts(value).map((part) => (
                            <kbd key={part}>{part}</kbd>
                          ))}
                        </span>
                      </span>
                    ) : (
                      <span className="muted">{t('Off')}</span>
                    )}
                  </span>
                </button>
              </div>
            </SettingRow>
          );
        })}
      </div>
    </section>
  );
}
