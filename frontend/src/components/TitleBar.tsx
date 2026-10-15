import { Maximize2, Minimize2, Pin, PinOff } from 'lucide-react';
import { Logo } from './Logo';

interface TitleBarProps {
  compact: boolean;
  alwaysOnTop: boolean;
  onTogglePin: () => void;
  onToggleCompact: () => void;
}

/**
 * Custom title bar for the Electron window (Window Controls Overlay).
 * The OS still draws minimize / maximize / close at the right; this bar fills the space
 * to their left, is draggable, and hosts the Pin and Mini buttons next to them.
 */
export function TitleBar({ compact, alwaysOnTop, onTogglePin, onToggleCompact }: TitleBarProps) {
  return (
    <div className="titlebar">
      <span className="titlebar-brand">
        <Logo size={16} />
        <span>
          MyTodo<strong>Ease</strong>
          {compact ? ' · Today' : ''}
        </span>
      </span>
      <span className="spacer" />
      <button
        type="button"
        className={`titlebar-btn ${alwaysOnTop ? 'is-active' : ''}`}
        onClick={onTogglePin}
        title={alwaysOnTop ? 'Unpin from top' : 'Keep this window on top of others'}
        aria-label={alwaysOnTop ? 'Unpin from top' : 'Pin on top'}
        aria-pressed={alwaysOnTop}
      >
        {alwaysOnTop ? <PinOff size={14} /> : <Pin size={14} />}
      </button>
      <button
        type="button"
        className={`titlebar-btn ${compact ? 'is-active' : ''}`}
        onClick={onToggleCompact}
        title={compact ? 'Back to full window' : 'Mini mode: a small window with only today’s tasks'}
        aria-label={compact ? 'Back to full window' : 'Switch to mini mode'}
        aria-pressed={compact}
      >
        {compact ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
      </button>
    </div>
  );
}
