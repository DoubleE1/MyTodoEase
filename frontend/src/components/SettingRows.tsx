import type { ReactNode } from 'react';

/**
 * One setting: title and description on the left, its control on the right (or underneath when `stacked`,
 * for wide controls like the colour swatches). Rows sit in a `.settings-group` card, divided by lines.
 */
export function SettingRow({
  title,
  description,
  children,
  stacked = false,
  extra,
  labelId,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  stacked?: boolean;
  /** Small trailing content under the description, e.g. a reset link. */
  extra?: ReactNode;
  /** Id for the title so a switch can point aria-labelledby at it. */
  labelId?: string;
  /** Shown before the text (an avatar, a calendar's colour). */
  icon?: ReactNode;
}) {
  return (
    <div className={`setting-row ${stacked ? 'is-stacked' : ''}`}>
      {icon && <span className="setting-icon">{icon}</span>}
      <div className="setting-text">
        <span className="setting-title" id={labelId}>
          {title}
        </span>
        {description && (
          <span className="setting-desc" id={labelId ? `${labelId}-desc` : undefined}>
            {description}
          </span>
        )}
        {extra}
      </div>
      {children && <div className="setting-control">{children}</div>}
    </div>
  );
}

/** A setting that is on or off, with a switch on the right. */
export function SwitchRow({
  id,
  title,
  description,
  on,
  onChange,
  disabled = false,
  icon,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <SettingRow title={title} description={description} labelId={id} icon={icon}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={id}
        aria-describedby={description ? `${id}-desc` : undefined}
        className={`switch ${on ? 'is-on' : ''}`}
        disabled={disabled}
        onClick={() => onChange(!on)}
      >
        <span className="switch-thumb" />
      </button>
    </SettingRow>
  );
}
