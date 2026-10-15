import { format, parseISO } from 'date-fns';
import { Check, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTaskMutations } from '../api/hooks';
import type { Label, Project, Section, Task, TaskInput } from '../api/types';
import { PRIORITY_META } from '../lib/colors';
import { sortByOrder } from '../lib/views';
import { Modal } from './Dialogs';
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
  const [editing, setEditing] = useState(false);
  const [addingSubtask, setAddingSubtask] = useState(false);

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
        <button
          type="button"
          className="icon-btn"
          title="Delete task"
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
                <p className={task.description ? 'detail-description' : 'detail-description muted'}>
                  {task.description || 'Add a description'}
                </p>
              </div>
            )}
          </div>

          {!task.parentId && (
            <>
              <h3 className="detail-subheading">Sub-tasks</h3>
              <ul className="task-list">
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
              </ul>
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
