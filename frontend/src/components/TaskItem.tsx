import { Calendar, Check, CornerDownRight, Pencil, Repeat, Trash2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { CSSProperties, ReactNode, Ref } from 'react';
import type { Label, Project, Task } from '../api/types';
import { colorHex, PRIORITY_META } from '../lib/colors';
import { describeDue } from '../lib/dates';
import { ProjectIcon } from './Pickers';
import { markdownPreview } from '../lib/markdownPreview';

export interface TaskItemProps {
  task: Task;
  project?: Project;
  labels: Label[];
  showProject?: boolean;
  childCount?: number;
  completed?: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
  /** Nested subtask list, rendered under the row. */
  children?: ReactNode;
  /** Drag handle element, rendered at the left edge of the row (sortable lists only). */
  handle?: ReactNode;
  innerRef?: Ref<HTMLLIElement>;
  style?: CSSProperties;
  className?: string;
}

export function TaskItem({
  task,
  project,
  labels,
  showProject,
  childCount = 0,
  completed,
  onToggle,
  onOpen,
  onDelete,
  children,
  handle,
  innerRef,
  style,
  className,
}: TaskItemProps) {
  const due = task.dueDate ? describeDue(task.dueDate, task.dueTime) : null;
  const taskLabels = task.labelIds
    .map((id) => labels.find((l) => l.id === id))
    .filter((l): l is Label => l !== undefined);
  const priority = PRIORITY_META[task.priority];
  const hasMeta = due || taskLabels.length > 0 || childCount > 0 || (showProject && project) || completed;

  return (
    <li ref={innerRef} style={style} className={`task-item ${completed ? 'is-completed' : ''} ${className ?? ''}`}>
      <div className="task-row">
        {handle}
        <button
          type="button"
          className={`task-check ${completed ? 'is-checked' : ''}`}
          style={{
            borderColor: priority.hex,
            color: priority.hex,
            background: task.priority < 4 && !completed ? `${priority.hex}1a` : undefined,
          }}
          onClick={onToggle}
          aria-label={completed ? 'Reopen task' : 'Complete task'}
          title={completed ? 'Reopen' : 'Complete'}
        >
          <Check size={12} strokeWidth={3} className="task-check-icon" />
        </button>

        <div
          className="task-main"
          role="button"
          tabIndex={0}
          onClick={onOpen}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onOpen();
          }}
        >
          <div className="task-content">{task.content}</div>
          {task.description && <div className="task-desc">{markdownPreview(task.description)}</div>}
          {hasMeta && (
            <div className="task-meta">
              {childCount > 0 && (
                <span className="meta">
                  <CornerDownRight size={12} />
                  {childCount}
                </span>
              )}
              {due && (
                <span className={`meta due tone-${due.tone}`}>
                  <Calendar size={12} />
                  {due.text}
                  {task.recurrence !== 'none' && <Repeat size={11} />}
                </span>
              )}
              {taskLabels.map((l) => (
                <span key={l.id} className="meta label" style={{ color: colorHex(l.color) }}>
                  @{l.name}
                </span>
              ))}
              {completed && task.completedAt && (
                <span className="meta">Completed {format(parseISO(task.completedAt), 'd MMM, h:mm a')}</span>
              )}
              {showProject && project && (
                <span className="meta project">
                  {project.name}
                  <ProjectIcon project={project} size={12} />
                </span>
              )}
            </div>
          )}
        </div>

        <div className="task-actions">
          <button type="button" className="icon-btn" title="Edit" aria-label="Edit task" onClick={onOpen}>
            <Pencil size={15} />
          </button>
          <button type="button" className="icon-btn" title="Delete" aria-label="Delete task" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {children}
    </li>
  );
}
