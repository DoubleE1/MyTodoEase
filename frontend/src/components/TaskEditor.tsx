import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Label, Priority, Project, Recurrence, Section, Task, TaskInput } from '../api/types';
import { parseQuickAdd } from '../lib/quickAdd';
import { recordEvent } from '../lib/achievements';
import { DuePicker, LabelPicker, PriorityPicker, ProjectPicker } from './Pickers';

// The rich-text description editor (TipTap) is large; it loads on demand the first time any task editor opens.
const DescriptionEditor = lazy(() => import('./DescriptionEditor'));

export interface TaskEditorProps {
  mode: 'create' | 'edit';
  task?: Task;
  /** Pre-filled values for a new task (project, section, due date, parent...). */
  defaults?: Partial<TaskInput>;
  projects: Project[];
  sections: Section[];
  labels: Label[];
  onSubmit: (input: TaskInput) => Promise<unknown>;
  onCancel: () => void;
  onCreateLabel?: (name: string) => Promise<Label>;
  /** After adding, clear and stay open for the next task (list views). */
  keepOpenAfterSubmit?: boolean;
  /** Only edit text; the task's other fields are kept as they are (used in the detail panel). */
  textOnly?: boolean;
  placeholder?: string;
}

export function taskToInput(task: Task): TaskInput {
  return {
    content: task.content,
    description: task.description,
    projectId: task.projectId,
    sectionId: task.sectionId,
    parentId: task.parentId,
    labelIds: [...task.labelIds],
    priority: task.priority,
    dueDate: task.dueDate,
    // Unchanged unless the caller sets it ('' clears); the editor itself does not edit the start.
    startDate: null,
    dueTime: task.dueTime,
    durationMinutes: task.durationMinutes,
    recurrence: task.recurrence,
    order: task.order,
  };
}

interface Fields {
  projectId: string;
  sectionId: string | null;
  labelIds: string[];
  priority: Priority;
  dueDate: string | null;
  dueTime: string | null;
  recurrence: Recurrence;
}

export function TaskEditor({
  mode,
  task,
  defaults,
  projects,
  sections,
  labels,
  onSubmit,
  onCancel,
  onCreateLabel,
  keepOpenAfterSubmit,
  textOnly,
  placeholder,
}: TaskEditorProps) {
  const inboxId = projects.find((p) => p.isInbox)?.id ?? projects[0]?.id ?? '';
  const base: TaskInput = task
    ? taskToInput(task)
    : { content: '', description: '', projectId: inboxId, ...defaults };

  const [content, setContent] = useState(base.content);
  const [description, setDescription] = useState(base.description ?? '');
  const [toolbarHost, setToolbarHost] = useState<HTMLSpanElement | null>(null);
  // The Markdown editor keeps its own content once open; bumping this starts it afresh (after a rapid-entry add).
  const [descriptionKey, setDescriptionKey] = useState(0);
  const [fields, setFields] = useState<Fields>({
    projectId: base.projectId,
    sectionId: base.sectionId ?? null,
    labelIds: base.labelIds ?? [],
    priority: base.priority ?? 4,
    dueDate: base.dueDate ?? null,
    dueTime: base.dueTime ?? null,
    recurrence: base.recurrence ?? 'none',
  });
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Quick-add parsing only applies when creating; editing keeps typed text literal.
  const parsed = useMemo(
    () => (mode === 'create' ? parseQuickAdd(content, { projects, labels }) : null),
    [content, mode, projects, labels],
  );

  // What the pickers show: explicit picks, overridden by anything recognised in the typed text.
  const effective: Fields = {
    projectId: parsed?.projectId ?? fields.projectId,
    sectionId: parsed?.projectId && parsed.projectId !== fields.projectId ? null : fields.sectionId,
    priority: parsed?.priority ?? fields.priority,
    dueDate: parsed?.dueDate ?? fields.dueDate,
    dueTime: parsed?.dueTime ?? fields.dueTime,
    recurrence: parsed?.recurrence ?? fields.recurrence,
    labelIds: parsed ? Array.from(new Set([...fields.labelIds, ...parsed.labelIds])) : fields.labelIds,
  };
  const finalContent = parsed ? parsed.content : content.trim();
  const rapidEntry = mode === 'create' && !!keepOpenAfterSubmit;
  // In rapid-entry mode the editor never locks: the next task can be typed while the previous one saves.
  const canSubmit = finalContent.length > 0 && (rapidEntry || !submitting);

  const submit = async () => {
    if (!canSubmit) return;
    const snapshot = { content, description };
    const input = {
      content: finalContent,
      description: description.trim(),
      projectId: effective.projectId,
      sectionId: effective.sectionId,
      parentId: base.parentId ?? null,
      priority: effective.priority,
      dueDate: effective.dueDate,
      dueTime: effective.dueDate ? effective.dueTime : null,
      durationMinutes: base.durationMinutes ?? null,
      recurrence: effective.dueDate ? effective.recurrence : 'none',
      order: task?.order,
    } as const;
    const pendingLabels = parsed?.newLabelNames ?? [];
    let labelIds = effective.labelIds;

    if (rapidEntry) {
      // Clear immediately so anything typed during the request is not wiped afterwards.
      setContent('');
      setDescription('');
      setDescriptionKey((k) => k + 1);
      inputRef.current?.focus();
    } else {
      setSubmitting(true);
    }

    try {
      if (onCreateLabel) {
        for (const name of pendingLabels) {
          const label = await onCreateLabel(name);
          labelIds = [...labelIds, label.id];
        }
      }
      await onSubmit({ ...input, labelIds });
      // "Quick draw" achievement: the task name carried a date, priority, #project or @label.
      if (parsed && (parsed.dueDate || parsed.priority || parsed.projectId || parsed.labelIds.length || pendingLabels.length)) {
        recordEvent('quickAddWords');
      }
    } catch {
      // The mutation hook already shows a toast; give the text back so nothing is lost.
      if (rapidEntry) {
        setContent((current) => current || snapshot.content);
        setDescription((current) => current || snapshot.description);
        setDescriptionKey((k) => k + 1);
      }
    } finally {
      if (!rapidEntry) setSubmitting(false);
    }
  };

  const onContentKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };


  return (
    <form
      className="task-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <input
        ref={inputRef}
        className="editor-content"
        placeholder={placeholder ?? (mode === 'create' ? 'Task name, e.g. "Pay rent tomorrow p1 #Home @finance"' : 'Task name')}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={onContentKeyDown}
        aria-label="Task name"
      />
      {/* The same Markdown editor everywhere (quick add, inline add, task detail); its toolbar sits in the footer. */}
      <Suspense fallback={<div className={`rich-desc rich-desc-loading ${textOnly ? '' : 'is-compact'}`} aria-hidden="true" />}>
        <DescriptionEditor
          key={descriptionKey}
          value={description}
          onChange={setDescription}
          onSubmit={() => void submit()}
          onCancel={onCancel}
          toolbarHost={toolbarHost}
          autoFocus={!!textOnly}
          compact={!textOnly}
        />
      </Suspense>

      {!textOnly && (
        <div className="editor-chips">
          <DuePicker
            value={{ dueDate: effective.dueDate, dueTime: effective.dueTime, recurrence: effective.recurrence }}
            onChange={(v) => setFields((f) => ({ ...f, ...v }))}
          />
          <PriorityPicker value={effective.priority} onChange={(p) => setFields((f) => ({ ...f, priority: p }))} />
          <LabelPicker
            labels={labels}
            selected={effective.labelIds}
            onChange={(ids) => setFields((f) => ({ ...f, labelIds: ids }))}
            onCreate={onCreateLabel}
          />
          {parsed?.newLabelNames.map((name) => (
            <span key={name} className="chip chip-static">
              @{name} (new)
            </span>
          ))}
        </div>
      )}

      <div className="editor-footer">
        {!textOnly && (
          <ProjectPicker
            projects={projects}
            sections={sections}
            projectId={effective.projectId}
            sectionId={effective.sectionId}
            onChange={(projectId, sectionId) => setFields((f) => ({ ...f, projectId, sectionId }))}
          />
        )}
        <span ref={setToolbarHost} className="editor-toolbar-host" />
        <div className="editor-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {mode === 'create' ? 'Add task' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  );
}
