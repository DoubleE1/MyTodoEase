import { Maximize2, Minimize2, PanelRight, PanelRightClose, Pin, PinOff } from 'lucide-react';
import { Logo } from './Logo';
import { t } from '../i18n';

interface TitleBarProps {
  compact: boolean;
  alwaysOnTop: boolean;
  /** Mini window reserved on the right screen edge so other windows stop at it. */
  docked: boolean;
  canDock: boolean;
  onTogglePin: () => void;
  onToggleCompact: () => void;
  onToggleDock: () => void;
}

/**
 * Custom title bar for the Electron window (Window Controls Overlay).
 * The OS still draws minimize / maximize / close at the right; this bar fills the space
 * to their left, is draggable, and hosts the Pin and Mini buttons next to them.
 */
export function TitleBar({
  compact,
  alwaysOnTop,
  docked,
  canDock,
  onTogglePin,
  onToggleCompact,
  onToggleDock,
}: TitleBarProps) {
  return (
    <div className={`titlebar ${docked ? 'is-docked' : ''}`}>
      <span className="titlebar-brand">
        <Logo size={16} />
        <span>
          Todo<strong>Ease</strong>
        </span>
      </span>
      <span className="spacer" />
      {compact && canDock && (
        <button
          type="button"
          className={`titlebar-btn ${docked ? 'is-active' : ''}`}
          onClick={onToggleDock}
          data-tooltip={
            docked
              ? t('Undock from the right edge')
              : 'Dock to the right edge: other windows stop at it when maximized'
          }
          aria-label={docked ? t('Undock from the right edge') : t('Dock to the right edge')}
          aria-pressed={docked}
        >
          {docked ? <PanelRightClose size={14} /> : <PanelRight size={14} />}
        </button>
      )}
      <button
        type="button"
        className={`titlebar-btn ${alwaysOnTop ? 'is-active' : ''}`}
        onClick={onTogglePin}
        data-tooltip={alwaysOnTop ? t('Unpin from top') : t('Keep this window on top of others')}
        aria-label={alwaysOnTop ? t('Unpin from top') : t('Pin on top')}
        aria-pressed={alwaysOnTop}
      >
        {alwaysOnTop ? <PinOff size={14} /> : <Pin size={14} />}
      </button>
      <button
        type="button"
        className={`titlebar-btn ${compact ? 'is-active' : ''}`}
        onClick={onToggleCompact}
        data-tooltip={compact ? t('Back to full window') : t('Mini mode: a small window with only today’s tasks')}
        aria-label={compact ? t('Back to full window') : t('Switch to mini mode')}
        aria-pressed={compact}
      >
        {compact ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
      </button>
    </div>
  );
}
