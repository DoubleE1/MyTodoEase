import { addDays, format, parseISO } from 'date-fns';
import { CalendarPlus, Check, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, useTaskMutations } from '../api/hooks';
import type { Label, Project, Section, Task, TaskInput } from '../api/types';
import { PRIORITY_META } from '../lib/colors';
import { toDateStr, todayStr } from '../lib/dates';
import { showToast } from '../lib/toast';
import { sortByOrder } from '../lib/views';
import { Modal } from './Dialogs';
import { AnimatedList } from './AnimatedList';
import { MarkdownText } from './MarkdownText';
import { DuePicker, LabelPicker, PriorityPicker, ProjectIcon, ProjectPicker } from './Pickers';
import { TaskEditor, taskToInput } from './TaskEditor';
import { TaskItem } from './TaskItem';

interface TaskDetailProps {
  taskId: string;
  tasks: Task[];
  completedTasks: Task[];
  projects: Project[];
  sections: Section[];
  labels: Label[];
  onClose: () => void;
  onOpenTask: (id: string) => void;
  onDeleteTask: (task: Task) => void;
  onCreateLabel: (name: string) => Promise<Label>;
}

/**
 * The task the detail dialog shows right now, or null when it is closed. Kept outside the component: the dialog
 * remounts when its task briefly disappears (e.g. while being completed), and a later Undo must still know.
 */
let shownTaskId: string | null = null;

export function TaskDetail({
  taskId,
  tasks,
  completedTasks,
  projects,
  sections,
  labels,
  onClose,
  onOpenTask,
  onDeleteTask,
  onCreateLabel,
}: TaskDetailProps) {
  const task = tasks.find((t) => t.id === taskId) ?? completedTasks.find((t) => t.id === taskId);
  const taskMut = useTaskMutations();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [continuing, setContinuing] = useState(false);
  useEffect(() => {
    shownTaskId = taskId;
    return () => {
      if (shownTaskId === taskId) shownTaskId = null;
    };
  }, [taskId]);
  // A ticked checklist box shows at once; the saved text replaces this as soon as it arrives.
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  useEffect(() => setDescriptionDraft(null), [task?.description]);

  // Close when the task disappears (deleted elsewhere, or completed and gone from the active list).
  useEffect(() => {
    if (!task) onClose();
  }, [task, onClose]);

  useEffect(() => {
    setEditing(false);
    setAddingSubtask(false);
  }, [taskId]);

  if (!task) return null;

  const project = projects.find((p) => p.id === task.projectId);
  const parent = task.parentId ? tasks.find((t) => t.id === task.parentId) : undefined;
  const subtasks = sortByOrder(tasks.filter((t) => t.parentId === task.id));
  const priority = PRIORITY_META[task.priority];

  const patch = (changes: Partial<TaskInput>) =>
    taskMut.update.mutate({ id: task.id, input: { ...taskToInput(task), ...changes } });

  const toggleComplete = () => {
    if (task.isCompleted) taskMut.reopen.mutate(task.id);
    else taskMut.complete.mutate(task.id);
  };

  // "Continue tomorrow": today's part is marked done (its block stays on the calendar, greyed) and the
  // same task is scheduled for the next day at the same time and length. Open sub-tasks move to the new
  // copy; finished ones stay with today's. Repeating tasks already roll forward on their own.
  const canContinue = !task.isCompleted && task.dueDate !== null && task.recurrence === 'none';
  const continueTomorrow = async () => {
    if (!task.dueDate || continuing) return;
    setContinuing(true);
    try {
      const today = todayStr();
      const from = task.dueDate > today ? task.dueDate : today;
      const nextDate = toDateStr(addDays(parseISO(from), 1));
      const { order: _order, ...input } = taskToInput(task);
      const copy = await taskMut.create.mutateAsync({ ...input, dueDate: nextDate });
      const moved = subtasks.filter((s) => !s.isCompleted);
      for (const sub of moved) {
        await taskMut.update.mutateAsync({
          id: sub.id,
          input: { ...taskToInput(sub), parentId: copy.id, projectId: copy.projectId, sectionId: copy.sectionId },
        });
      }
      await taskMut.complete.mutateAsync(task.id);

      // Undo puts everything back: sub-tasks return to today's task first (deleting the copy would delete
      // them with it), then today's task is reopened and tomorrow's copy deleted.
      const undo = async () => {
        try {
          for (const sub of moved) await taskMut.update.mutateAsync({ id: sub.id, input: taskToInput(sub) });
          await taskMut.reopen.mutateAsync(task.id);
          // Wait until the open list has today's task again: the dialog closes itself on a task it cannot find.
          await queryClient.refetchQueries({ queryKey: queryKeys.tasks });
          // Still looking at tomorrow's copy: switch to today's task before the copy goes, or the dialog would
          // close itself when its task disappears.
          if (shownTaskId === copy.id) onOpenTask(task.id);
          await taskMut.remove.mutateAsync(copy.id);
          showToast('Undone: the task is back on its original day.', 'info', { group: 'task-completed' });
        } catch {
          // The mutation hooks already showed the error.
        }
      };
      // Same group as the "Task completed" toast, so this one (with the full undo) replaces it.
      showToast(`Continues on ${format(parseISO(nextDate), 'EEE d MMM')}. Today's part is marked done.`, 'success', {
        group: 'task-completed',
        duration: 6000,
        action: { label: 'Undo', run: () => void undo() },
      });
      onOpenTask(copy.id);
    } catch {
      // The mutation hooks already showed the error; whatever was created stays visible to fix by hand.
    } finally {
      setContinuing(false);
    }
  };

  return (
    <Modal onClose={onClose} wide>
      <div className="detail-header">
        <span className="breadcrumb">
          <ProjectIcon project={project} />
          <span>{project?.name ?? 'Project'}</span>
          {parent && (
            <>
              <ChevronRight size={14} />
              <button type="button" className="link-btn" onClick={() => onOpenTask(parent.id)}>
                {parent.content}
              </button>
            </>
          )}
        </span>
        <span className="spacer" />
        {canContinue && (
          <button
            type="button"
            className="btn detail-continue"
            data-tooltip="Mark today's part done and schedule the same task for the next day"
            onClick={() => void continueTomorrow()}
            disabled={continuing}
          >
            <CalendarPlus size={14} />
            <span>{continuing ? 'Moving…' : 'Continue tomorrow'}</span>
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          data-tooltip="Delete task"
          aria-label="Delete task"
          onClick={() => onDeleteTask(task)}
        >
          <Trash2 size={16} />
        </button>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <div className="detail-body">
        <div className="detail-main">
          <div className="detail-title-row">
            <button
              type="button"
              className={`task-check ${task.isCompleted ? 'is-checked' : ''}`}
              style={{ borderColor: priority.hex, color: priority.hex }}
              onClick={toggleComplete}
              aria-label={task.isCompleted ? 'Reopen task' : 'Complete task'}
            >
              <Check size={12} strokeWidth={3} className="task-check-icon" />
            </button>
            {editing ? (
              <TaskEditor
                mode="edit"
                task={task}
                textOnly
                projects={projects}
                sections={sections}
                labels={labels}
                onSubmit={async (input) => {
                  await taskMut.update.mutateAsync({ id: task.id, input });
                  setEditing(false);
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <div
                className={`detail-text ${task.isCompleted ? 'is-completed' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setEditing(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setEditing(true);
                }}
              >
                <h2>{task.content}</h2>
                {task.description ? (
                  <MarkdownText
                    text={descriptionDraft ?? task.description}
                    className="detail-description"
                    onChange={(next) => {
                      setDescriptionDraft(next);
                      taskMut.update.mutate(
                        { id: task.id, input: { ...taskToInput(task), description: next } },
                        { onError: () => setDescriptionDraft(null) },
                      );
                    }}
                  />
                ) : (
                  <p className="detail-description muted">Add a description</p>
                )}
              </div>
            )}
          </div>

          {!task.parentId && (
            <>
              <h3 className="detail-subheading">Sub-tasks</h3>
              <AnimatedList className="task-list">
                {subtasks.map((sub) => (
                  <TaskItem
                    key={sub.id}
                    task={sub}
                    labels={labels}
                    onToggle={() => taskMut.complete.mutate(sub.id)}
                    onOpen={() => onOpenTask(sub.id)}
                    onDelete={() => onDeleteTask(sub)}
                  />
                ))}
              </AnimatedList>
              {addingSubtask ? (
                <TaskEditor
                  mode="create"
                  defaults={{ projectId: task.projectId, sectionId: task.sectionId, parentId: task.id }}
                  projects={projects}
                  sections={sections}
                  labels={labels}
                  onCreateLabel={onCreateLabel}
                  keepOpenAfterSubmit
                  onSubmit={(input) => taskMut.create.mutateAsync(input)}
                  onCancel={() => setAddingSubtask(false)}
                  placeholder="Sub-task name"
                />
              ) : (
                <button type="button" className="add-task-btn" onClick={() => setAddingSubtask(true)}>
                  <Plus size={16} />
                  <span>Add sub-task</span>
                </button>
              )}
            </>
          )}
        </div>

        <aside className="detail-side">
          <div className="field">
            <span>Project</span>
            <ProjectPicker
              projects={projects}
              sections={sections}
              projectId={task.projectId}
              sectionId={task.sectionId}
              onChange={(projectId, sectionId) => patch({ projectId, sectionId })}
            />
          </div>
          <div className="field">
            <span>Due date</span>
            <DuePicker
              value={{ dueDate: task.dueDate, dueTime: task.dueTime, recurrence: task.recurrence }}
              onChange={(v) => patch(v)}
            />
          </div>
          <div className="field">
            <span>Priority</span>
            <PriorityPicker value={task.priority} onChange={(p) => patch({ priority: p })} />
          </div>
          <div className="field">
            <span>Labels</span>
            <LabelPicker
              labels={labels}
              selected={task.labelIds}
              onChange={(ids) => patch({ labelIds: ids })}
              onCreate={onCreateLabel}
            />
          </div>
          <p className="muted small">
            Created {format(parseISO(task.createdAt), 'd MMM yyyy')}
            {task.completedAt && <> · Completed {format(parseISO(task.completedAt), 'd MMM yyyy')}</>}
          </p>
        </aside>
      </div>
    </Modal>
  );
}
