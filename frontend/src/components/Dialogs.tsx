import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Label, LabelInput, Project, ProjectInput } from '../api/types';
import { COLORS } from '../lib/colors';

export function Modal({
  children,
  onClose,
  title,
  wide,
}: {
  children: ReactNode;
  onClose: () => void;
  title?: string;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        {title && (
          <div className="modal-title">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
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
