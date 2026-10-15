import { format } from 'date-fns';
import { Maximize2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTaskMutations } from '../api/hooks';
import type { Label, Project, Section, Task } from '../api/types';
import { todayStr } from '../lib/dates';
import { isOverdue, sortForAgenda } from '../lib/views';
import { TaskEditor, taskToInput } from './TaskEditor';
import { TaskItem } from './TaskItem';

interface CompactViewProps {
  tasks: Task[];
  projects: Project[];
  sections: Section[];
  labels: Label[];
  /** Browser only: the desktop title bar has its own expand button. */
  showExpand: boolean;
  onExpand: () => void;
  onOpenTask: (id: string) => void;
  onDeleteTask: (task: Task) => void;
  onCreateLabel: (name: string) => Promise<Label>;
}

/** Mini window: only what is due today (plus overdue), with add/complete/edit/delete still available. */
export function CompactView({
  tasks,
  projects,
  sections,
  labels,
  showExpand,
  onExpand,
  onOpenTask,
  onDeleteTask,
  onCreateLabel,
}: CompactViewProps) {
  const taskMut = useTaskMutations();
  const [adding, setAdding] = useState(false);
  const today = todayStr();
  const inbox = projects.find((p) => p.isInbox);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const overdue = sortForAgenda(tasks.filter((t) => isOverdue(t, today)));
  const dueToday = sortForAgenda(tasks.filter((t) => t.dueDate === today));
  const remaining = overdue.length + dueToday.length;

  const rescheduleOverdue = async () => {
    await Promise.all(
      overdue.map((t) => taskMut.update.mutateAsync({ id: t.id, input: { ...taskToInput(t), dueDate: today } })),
    );
  };

  const renderTask = (task: Task) => (
    <TaskItem
      key={task.id}
      task={task}
      project={projectById.get(task.projectId)}
      labels={labels}
      showProject
      childCount={tasks.filter((t) => t.parentId === task.id).length}
      onToggle={() => taskMut.complete.mutate(task.id)}
      onOpen={() => onOpenTask(task.id)}
      onDelete={() => onDeleteTask(task)}
    />
  );

  return (
    <div className="compact">
      <header className="compact-header">
        <div className="compact-title">
          <h1>Today</h1>
          <span className="muted small">
            {format(new Date(), 'EEE d MMM')} · {remaining === 0 ? 'all done' : `${remaining} left`}
          </span>
        </div>
        {showExpand && (
          <div className="compact-actions">
            <button
              type="button"
              className="icon-btn"
              title="Back to full window"
              aria-label="Back to full window"
              onClick={onExpand}
            >
              <Maximize2 size={16} />
            </button>
          </div>
        )}
      </header>

      <div className="compact-body">
        {overdue.length > 0 && (
          <section className="task-group">
            <div className="group-header">
              <h2 className="overdue-title">Overdue</h2>
              <button type="button" className="link-btn" onClick={() => void rescheduleOverdue()}>
                Reschedule to today
              </button>
            </div>
            <ul className="task-list">{overdue.map(renderTask)}</ul>
          </section>
        )}

        <section className="task-group">
          {overdue.length > 0 && (
            <div className="group-header">
              <h2>Today</h2>
            </div>
          )}
          <ul className="task-list">{dueToday.map(renderTask)}</ul>
          {dueToday.length === 0 && !adding && (
            <p className="empty">{overdue.length > 0 ? 'Nothing else due today.' : 'Nothing due today.'}</p>
          )}
        </section>
      </div>

      <footer className="compact-footer">
        {adding && inbox ? (
          <TaskEditor
            mode="create"
            defaults={{ projectId: inbox.id, dueDate: today }}
            projects={projects}
            sections={sections}
            labels={labels}
            onCreateLabel={onCreateLabel}
            keepOpenAfterSubmit
            onSubmit={(input) => taskMut.create.mutateAsync(input)}
            onCancel={() => setAdding(false)}
            placeholder="Add a task for today"
          />
        ) : (
          <button type="button" className="add-task-btn" onClick={() => setAdding(true)}>
            <Plus size={16} />
            <span>Add task</span>
          </button>
        )}
      </footer>
    </div>
  );
}
