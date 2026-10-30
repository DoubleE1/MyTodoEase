import { Maximize2, Minimize2, PanelRight, PanelRightClose, Pin, PinOff } from 'lucide-react';
import { Logo } from './Logo';

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
              ? 'Undock from the right edge'
              : 'Dock to the right edge: other windows stop at it when maximized'
          }
          aria-label={docked ? 'Undock from the right edge' : 'Dock to the right edge'}
          aria-pressed={docked}
        >
          {docked ? <PanelRightClose size={14} /> : <PanelRight size={14} />}
        </button>
      )}
      <button
        type="button"
        className={`titlebar-btn ${alwaysOnTop ? 'is-active' : ''}`}
        onClick={onTogglePin}
        data-tooltip={alwaysOnTop ? 'Unpin from top' : 'Keep this window on top of others'}
        aria-label={alwaysOnTop ? 'Unpin from top' : 'Pin on top'}
        aria-pressed={alwaysOnTop}
      >
        {alwaysOnTop ? <PinOff size={14} /> : <Pin size={14} />}
      </button>
      <button
        type="button"
        className={`titlebar-btn ${compact ? 'is-active' : ''}`}
        onClick={onToggleCompact}
        data-tooltip={compact ? 'Back to full window' : 'Mini mode: a small window with only today’s tasks'}
        aria-label={compact ? 'Back to full window' : 'Switch to mini mode'}
        aria-pressed={compact}
      >
        {compact ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
      </button>
    </div>
  );
}
