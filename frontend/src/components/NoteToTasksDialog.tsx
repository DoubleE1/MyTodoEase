import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTaskMutations } from '../api/hooks';
import type { Label, Note, Priority, Project, Recurrence, Section } from '../api/types';
import { noteToTasks, type TaskSuggestion } from '../lib/noteToTasks';
import { showToast } from '../lib/toast';
import { Modal } from './Dialogs';
import { DuePicker, PriorityPicker, ProjectPicker } from './Pickers';

interface Row {
  key: string;
  selected: boolean;
  title: string;
  description: string;
  dueDate: string | null;
  dueTime: string | null;
  recurrence: Recurrence;
  priority: Priority;
  projectId: string;
  sectionId: string | null;
  labelIds: string[];
  newLabelNames: string[];
  source: string;
}

let blankKey = 0;

/**
 * Review step between a note and real tasks: the suggestions from the note are listed with their dates,
 * priorities and projects, every field can be changed, rows can be unticked, removed or added, and nothing is
 * created until the user presses Create.
 */
export function NoteToTasksDialog({
  note,
  projects,
  sections,
  labels,
  onCreateLabel,
  onClose,
  onDone,
}: {
  note: Note;
  projects: Project[];
  sections: Section[];
  labels: Label[];
  onCreateLabel: (name: string) => Promise<Label>;
  onClose: () => void;
  /** Called with the ids of the created tasks and whether to archive the note. */
  onDone: (taskIds: string[], archive: boolean) => void;
}) {
  const taskMut = useTaskMutations();
  const inboxId = projects.find((p) => p.isInbox)?.id ?? projects[0]?.id ?? '';
  const toRow = (s: TaskSuggestion): Row => ({
    key: s.key,
    selected: s.selected,
    title: s.title,
    description: s.description,
    dueDate: s.dueDate ?? null,
    dueTime: s.dueTime ?? null,
    recurrence: s.recurrence ?? 'none',
    priority: s.priority ?? 4,
    projectId: s.projectId ?? inboxId,
    sectionId: null,
    labelIds: s.labelIds,
    newLabelNames: s.newLabelNames,
    source: s.source,
  });
  const initial = useMemo(() => noteToTasks(note.text, { projects, labels }).map(toRow), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [rows, setRows] = useState<Row[]>(initial);
  const [archive, setArchive] = useState(true);
  const [creating, setCreating] = useState(false);

  const chosen = rows.filter((r) => r.selected && r.title.trim());
  const patch = (key: string, changes: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...changes } : r)));

  const create = async () => {
    if (chosen.length === 0 || creating) return;
    setCreating(true);
    const created: string[] = [];
    try {
      // Labels written as @name in the note that do not exist yet are created once.
      const labelIdsByName = new Map<string, string>();
      for (const name of new Set(chosen.flatMap((r) => r.newLabelNames.map((n) => n.toLowerCase())))) {
        const original = chosen.flatMap((r) => r.newLabelNames).find((n) => n.toLowerCase() === name)!;
        labelIdsByName.set(name, (await onCreateLabel(original)).id);
      }
      for (const row of chosen) {
        const task = await taskMut.create.mutateAsync({
          content: row.title.trim(),
          description: row.description,
          projectId: row.projectId,
          sectionId: row.sectionId,
          priority: row.priority,
          dueDate: row.dueDate,
          dueTime: row.dueDate ? row.dueTime : null,
          recurrence: row.dueDate ? row.recurrence : 'none',
          labelIds: [...new Set([...row.labelIds, ...row.newLabelNames.map((n) => labelIdsByName.get(n.toLowerCase())!)])],
        });
        created.push(task.id);
      }
      showToast(`Created ${created.length} task${created.length === 1 ? '' : 's'} from the note${archive ? '; note archived' : ''}.`);
      onDone(created, archive);
    } catch {
      // The task hook already showed the error. Keep what was created linked to the note.
      if (created.length > 0) onDone(created, false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal title="Turn note into tasks" onClose={onClose} wide className="modal-note-tasks">
      <form
        className="note-tasks"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void create();
          }
        }}
      >
        <p className="muted small note-tasks-intro">
          {rows.length === 0
            ? 'Nothing in this note looks like a task yet. Add one below.'
            : 'Check the suggestions. Edit any title, date, priority or project, untick what you do not want, then create.'}
        </p>

        <ul className="note-tasks-list">
          {rows.map((row) => (
            <li key={row.key} className={`note-task-row ${row.selected ? '' : 'is-off'}`}>
              <input
                type="checkbox"
                className="note-task-check"
                checked={row.selected}
                aria-label={`Create "${row.title || 'untitled'}"`}
                onChange={(e) => patch(row.key, { selected: e.target.checked })}
              />
              <div className="note-task-main">
                <input
                  className="note-task-title"
                  value={row.title}
                  placeholder="Task name"
                  aria-label="Task name"
                  title={row.source ? `From: ${row.source}` : undefined}
                  onChange={(e) => patch(row.key, { title: e.target.value, selected: e.target.value.trim() ? row.selected || !row.title : false })}
                />
                {row.description && <div className="note-task-desc muted small">{row.description.replace(/\n/g, ' · ')}</div>}
                <div className="note-task-chips">
                  <DuePicker
                    value={{ dueDate: row.dueDate, dueTime: row.dueTime, recurrence: row.recurrence }}
                    onChange={(v) => patch(row.key, { dueDate: v.dueDate, dueTime: v.dueTime, recurrence: v.recurrence })}
                  />
                  <PriorityPicker value={row.priority} onChange={(priority) => patch(row.key, { priority })} />
                  <ProjectPicker
                    projects={projects}
                    sections={sections}
                    projectId={row.projectId}
                    sectionId={row.sectionId}
                    onChange={(projectId, sectionId) => patch(row.key, { projectId, sectionId })}
                  />
                  {[...row.labelIds.map((id) => labels.find((l) => l.id === id)?.name).filter(Boolean), ...row.newLabelNames].map((name) => (
                    <span key={name} className="chip chip-static">
                      @{name}
                    </span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="icon-btn note-task-remove"
                aria-label="Remove this suggestion"
                title="Remove"
                onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="add-task-btn"
          onClick={() =>
            setRows((all) => [
              ...all,
              {
                key: `new${blankKey++}`,
                selected: true,
                title: '',
                description: '',
                dueDate: null,
                dueTime: null,
                recurrence: 'none',
                priority: 4,
                projectId: inboxId,
                sectionId: null,
                labelIds: [],
                newLabelNames: [],
                source: '',
              },
            ])
          }
        >
          <Plus size={14} />
          <span>Add another task</span>
        </button>

        <footer className="note-tasks-footer">
          <label className="settings-toggle note-tasks-archive">
            <input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} />
            <span>Archive the note afterwards</span>
          </label>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={chosen.length === 0 || creating}>
            {creating ? 'Creating…' : `Create ${chosen.length} task${chosen.length === 1 ? '' : 's'}`}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
