import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Label, LabelInput, Project, ProjectInput } from '../api/types';
import { COLORS } from '../lib/colors';
import { motionReduced } from '../lib/motion';

/** Matches the modal-out animation in styles.css. */
const MODAL_CLOSE_MS = 140;

export function Modal({
  children,
  onClose,
  title,
  wide,
  className,
}: {
  children: ReactNode;
  onClose: () => void;
  title?: string;
  wide?: boolean;
  /** Extra class on the dialog box, e.g. a layout variant. */
  className?: string;
}) {
  // Escape, the backdrop and the X play a short exit before the parent removes the dialog.
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const latestOnClose = useRef(onClose);
  latestOnClose.current = onClose;
  const closingRef = useRef(false);
  const requestClose = () => {
    if (closingRef.current) return;
    if (motionReduced()) {
      latestOnClose.current();
      return;
    }
    closingRef.current = true;
    setClosing(true);
    closeTimer.current = window.setTimeout(() => latestOnClose.current(), MODAL_CLOSE_MS);
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // requestClose only reads refs, so subscribing once is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`modal-overlay ${closing ? 'is-closing' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div className={`modal ${wide ? 'modal-wide' : ''} ${className ?? ''}`} role="dialog" aria-modal="true" aria-label={title}>
        {title && (
          <div className="modal-title">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" onClick={requestClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function ColorGrid({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return (
    <div className="color-grid" role="radiogroup" aria-label="Color">
      {COLORS.map((c) => (
        <button
          key={c.name}
          type="button"
          role="radio"
          aria-checked={c.name === value}
          aria-label={c.label}
          title={c.label}
          className={`color-swatch ${c.name === value ? 'is-selected' : ''}`}
          style={{ background: c.hex }}
          onClick={() => onChange(c.name)}
        />
      ))}
    </div>
  );
}

export function ProjectDialog({
  project,
  onSave,
  onClose,
}: {
  project?: Project;
  onSave: (input: ProjectInput) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(project?.name ?? '');
  const [color, setColor] = useState(project?.color ?? 'charcoal');
  const [favorite, setFavorite] = useState(project?.isFavorite ?? false);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), color, isFavorite: favorite });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={project ? 'Edit project' : 'Add project'} onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} />
        </label>
        <div className="field">
          <span>Color</span>
          <ColorGrid value={color} onChange={setColor} />
        </div>
        <label className="field-inline">
          <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
          <span>Add to favorites</span>
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || saving}>
            {project ? 'Save' : 'Add'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function LabelDialog({
  label,
  onSave,
  onClose,
}: {
  label?: Label;
  onSave: (input: LabelInput) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(label?.name ?? '');
  const [color, setColor] = useState(label?.color ?? 'charcoal');
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim().replace(/\s+/g, '_');
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onSave({ name: trimmed, color });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={label ? 'Edit label' : 'Add label'} onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} />
          <small className="muted">Spaces become underscores so the label works with @ in quick add.</small>
        </label>
        <div className="field">
          <span>Color</span>
          <ColorGrid value={color} onChange={setColor} />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || saving}>
            {label ? 'Save' : 'Add'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
}

export function ConfirmDialog({
  options,
  onResolve,
}: {
  options: ConfirmOptions;
  onResolve: (confirmed: boolean) => void;
}) {
  return (
    <Modal title={options.title} onClose={() => onResolve(false)}>
      <p className="dialog-message">{options.message}</p>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => onResolve(false)} autoFocus>
          Cancel
        </button>
        <button type="button" className="btn btn-danger" onClick={() => onResolve(true)}>
          {options.confirmLabel ?? 'Delete'}
        </button>
      </div>
    </Modal>
  );
}
