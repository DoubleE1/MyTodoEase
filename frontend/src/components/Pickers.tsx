import { Calendar, Check, Flag, Hash, Inbox, Plus, Repeat, Tag, X } from 'lucide-react';
import { format } from 'date-fns';
import { useState } from 'react';
import type { Label, Priority, Project, Recurrence, Section } from '../api/types';
import { colorHex, PRIORITY_META } from '../lib/colors';
import { describeDue, nextWeekStr, parseDateStr, todayStr, tomorrowStr, weekendStr } from '../lib/dates';
import { Popover } from './Popover';

export interface DueValue {
  dueDate: string | null;
  dueTime: string | null;
  recurrence: Recurrence;
}

const RECURRENCE_OPTIONS: { value: Recurrence; label: string }[] = [
  { value: 'none', label: 'No repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
];

const weekdayShort = (dateStr: string): string => {
  const date = parseDateStr(dateStr);
  return date ? format(date, 'EEE') : '';
};

export function DuePicker({ value, onChange }: { value: DueValue; onChange: (value: DueValue) => void }) {
  const due = value.dueDate ? describeDue(value.dueDate, value.dueTime) : null;
  const quick = [
    { label: 'Today', date: todayStr() },
    { label: 'Tomorrow', date: tomorrowStr() },
    { label: 'This weekend', date: weekendStr() },
    { label: 'Next week', date: nextWeekStr() },
  ];
  const set = (patch: Partial<DueValue>) => onChange({ ...value, ...patch });

  return (
    <Popover
      trigger={({ onClick, open }) => (
        <button
          type="button"
          className={`chip ${due ? `tone-${due.tone}` : ''} ${open ? 'is-open' : ''}`}
          onClick={onClick}
        >
          <Calendar size={14} />
          <span>{due ? due.text : 'Date'}</span>
          {value.recurrence !== 'none' && <Repeat size={12} />}
        </button>
      )}
    >
      {(close) => (
        <div className="picker">
          <div className="picker-section">
            {quick.map((q) => (
              <button
                key={q.label}
                type="button"
                className="picker-row"
                onClick={() => {
                  set({ dueDate: q.date });
                  close();
                }}
              >
                <span className="row-label">{q.label}</span>
                <span className="muted">{weekdayShort(q.date)}</span>
              </button>
            ))}
            {value.dueDate && (
              <button
                type="button"
                className="picker-row danger"
                onClick={() => {
                  onChange({ dueDate: null, dueTime: null, recurrence: 'none' });
                  close();
                }}
              >
                <X size={14} />
                <span className="row-label">No date</span>
              </button>
            )}
          </div>
          <div className="picker-section picker-fields">
            <label>
              <span>Date</span>
              <input
                type="date"
                value={value.dueDate ?? ''}
                onChange={(e) =>
                  e.target.value
                    ? set({ dueDate: e.target.value })
                    : onChange({ dueDate: null, dueTime: null, recurrence: 'none' })
                }
              />
            </label>
            <label>
              <span>Time</span>
              <input
                type="time"
                value={value.dueTime ?? ''}
                disabled={!value.dueDate}
                onChange={(e) => set({ dueTime: e.target.value || null })}
              />
            </label>
            <label>
              <span>Repeat</span>
              <select
                value={value.recurrence}
                disabled={!value.dueDate}
                onChange={(e) => set({ recurrence: e.target.value as Recurrence })}
              >
                {RECURRENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
    </Popover>
  );
}

export function PriorityPicker({ value, onChange }: { value: Priority; onChange: (priority: Priority) => void }) {
  const meta = PRIORITY_META[value];
  const flag = (p: Priority, size = 14) => (
    <Flag size={size} color={PRIORITY_META[p].hex} fill={p < 4 ? PRIORITY_META[p].hex : 'none'} />
  );
  return (
    <Popover
      trigger={({ onClick, open }) => (
        <button type="button" className={`chip ${open ? 'is-open' : ''}`} onClick={onClick} title={meta.label}>
          {flag(value)}
          <span>{value < 4 ? `P${value}` : 'Priority'}</span>
        </button>
      )}
    >
      {(close) => (
        <div className="picker">
          {([1, 2, 3, 4] as Priority[]).map((p) => (
            <button
              key={p}
              type="button"
              className="picker-row"
              onClick={() => {
                onChange(p);
                close();
              }}
            >
              {flag(p)}
              <span className="row-label">{PRIORITY_META[p].label}</span>
              {p === value && <Check size={14} className="row-check" />}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

export function LabelPicker({
  labels,
  selected,
  onChange,
  onCreate,
}: {
  labels: Label[];
  selected: string[];
  onChange: (ids: string[]) => void;
  onCreate?: (name: string) => Promise<Label>;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = labels.filter((l) => l.name.toLowerCase().includes(q));
  const canCreate = !!onCreate && q.length > 0 && !labels.some((l) => l.name.toLowerCase() === q);
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <Popover
      trigger={({ onClick, open }) => (
        <button type="button" className={`chip ${open ? 'is-open' : ''}`} onClick={onClick}>
          <Tag size={14} />
          <span>{selected.length ? `${selected.length} label${selected.length > 1 ? 's' : ''}` : 'Labels'}</span>
        </button>
      )}
    >
      {() => (
        <div className="picker">
          <input
            className="picker-search"
            placeholder="Type a label"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="picker-list">
            {filtered.map((l) => (
              <button key={l.id} type="button" className="picker-row" onClick={() => toggle(l.id)}>
                <span className="dot" style={{ background: colorHex(l.color) }} />
                <span className="row-label">{l.name}</span>
                {selected.includes(l.id) && <Check size={14} className="row-check" />}
              </button>
            ))}
            {canCreate && (
              <button
                type="button"
                className="picker-row"
                onClick={async () => {
                  const label = await onCreate!(query.trim());
                  onChange([...selected, label.id]);
                  setQuery('');
                }}
              >
                <Plus size={14} />
                <span className="row-label">Create “{query.trim()}”</span>
              </button>
            )}
            {filtered.length === 0 && !canCreate && <div className="picker-empty muted">No labels yet</div>}
          </div>
        </div>
      )}
    </Popover>
  );
}

export function ProjectIcon({ project, size = 14 }: { project: Project | undefined; size?: number }) {
  if (!project) return <Hash size={size} />;
  if (project.isInbox) return <Inbox size={size} />;
  return <span className="dot" style={{ background: colorHex(project.color), width: size - 4, height: size - 4 }} />;
}

export function ProjectPicker({
  projects,
  sections,
  projectId,
  sectionId,
  onChange,
}: {
  projects: Project[];
  sections: Section[];
  projectId: string;
  sectionId: string | null;
  onChange: (projectId: string, sectionId: string | null) => void;
}) {
  const project = projects.find((p) => p.id === projectId);
  const section = sections.find((s) => s.id === sectionId);
  return (
    <Popover
      trigger={({ onClick, open }) => (
        <button type="button" className={`chip ${open ? 'is-open' : ''}`} onClick={onClick}>
          <ProjectIcon project={project} />
          <span>
            {project?.name ?? 'Project'}
            {section ? ` / ${section.name}` : ''}
          </span>
        </button>
      )}
    >
      {(close) => (
        <div className="picker picker-scroll">
          {projects.map((p) => (
            <div key={p.id}>
              <button
                type="button"
                className={`picker-row ${p.id === projectId && !sectionId ? 'is-selected' : ''}`}
                onClick={() => {
                  onChange(p.id, null);
                  close();
                }}
              >
                <ProjectIcon project={p} />
                <span className="row-label">{p.name}</span>
              </button>
              {sections
                .filter((s) => s.projectId === p.id)
                .map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`picker-row picker-sub ${s.id === sectionId ? 'is-selected' : ''}`}
                    onClick={() => {
                      onChange(p.id, s.id);
                      close();
                    }}
                  >
                    <Hash size={12} />
                    <span className="row-label">{s.name}</span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}
