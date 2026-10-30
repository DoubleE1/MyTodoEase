import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { ArrowRightLeft } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Task } from '../api/types';
import { Popover } from './Popover';
import { t } from '../i18n';

/** One column: a group from the list layout (section, day, priority, project…). */
export interface BoardColumn {
  key: string;
  title: string;
  icon?: ReactNode;
  tasks: Task[];
  /** Cards can be dropped here (and moved here with "Move to…"); false for Overdue, Later, labels. */
  accepts: boolean;
  /** Shown when the column has no cards. */
  emptyText?: string;
}

const COLUMN_PREFIX = 'board-col:';

/**
 * The board layout of a task page: one column per group, cards dragged between columns. Dropping a card in a
 * column sets that column's field (its section, day, priority or project); the page decides what that means.
 * Every card also has a "Move to…" menu, so the board works without a mouse.
 */
export function BoardView({
  columns,
  renderCard,
  renderAdd,
  onMove,
}: {
  columns: BoardColumn[];
  renderCard: (task: Task) => ReactNode;
  /** The column's own "Add task" button or editor; null when the column takes no new tasks. */
  renderAdd: (column: BoardColumn) => ReactNode;
  onMove: (task: Task, to: BoardColumn) => void;
}) {
  const [active, setActive] = useState<{ task: Task; from: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  const onDragEnd = (event: DragEndEvent) => {
    setActive(null);
    const data = event.active.data.current as { task: Task; from: string } | undefined;
    const overKey = event.over ? String(event.over.id).slice(COLUMN_PREFIX.length) : null;
    const to = columns.find((c) => c.key === overKey);
    if (!data || !to || to.key === data.from || !to.accepts) return;
    onMove(data.task, to);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setActive((e.active.data.current as { task: Task; from: string }) ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <div className="board" role="list" aria-label={t('Board')}>
        {columns.map((column) => (
          <Column
            key={column.key}
            column={column}
            columns={columns}
            renderCard={renderCard}
            renderAdd={renderAdd}
            onMove={onMove}
            dragging={active !== null}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? <div className="board-card is-overlay">{renderCard(active.task)}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  column,
  columns,
  renderCard,
  renderAdd,
  onMove,
  dragging,
}: {
  column: BoardColumn;
  columns: BoardColumn[];
  renderCard: (task: Task) => ReactNode;
  renderAdd: (column: BoardColumn) => ReactNode;
  onMove: (task: Task, to: BoardColumn) => void;
  dragging: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: COLUMN_PREFIX + column.key, disabled: !column.accepts });
  return (
    <section
      ref={setNodeRef}
      role="listitem"
      aria-label={`${column.title}, ${column.tasks.length === 1 ? t('1 task') : t('{n} tasks', { n: column.tasks.length })}`}
      className={`board-column ${isOver ? 'is-over' : ''} ${dragging && !column.accepts ? 'is-locked' : ''}`}
    >
      <header className="board-column-head">
        {column.icon}
        <h2>{column.title}</h2>
        <span className="muted small">{column.tasks.length || ''}</span>
      </header>
      <div className="board-cards">
        {column.tasks.map((task) => (
          <Card key={task.id} task={task} column={column} columns={columns} renderCard={renderCard} onMove={onMove} />
        ))}
        {column.tasks.length === 0 && <p className="board-empty muted small">{column.emptyText ?? 'Nothing here.'}</p>}
      </div>
      {renderAdd(column)}
    </section>
  );
}

function Card({
  task,
  column,
  columns,
  renderCard,
  onMove,
}: {
  task: Task;
  column: BoardColumn;
  columns: BoardColumn[];
  renderCard: (task: Task) => ReactNode;
  onMove: (task: Task, to: BoardColumn) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, data: { task, from: column.key } });
  const targets = columns.filter((c) => c.accepts && c.key !== column.key);
  return (
    <div
      ref={setNodeRef}
      className={`board-card ${isDragging ? 'is-dragging' : ''}`}
      {...listeners}
      {...attributes}
      // Space/Enter picks the card up only when the card itself is focused, not the task's own buttons inside it.
      onKeyDown={(e) => {
        if (e.target === e.currentTarget) listeners?.onKeyDown?.(e);
      }}
      aria-roledescription="Draggable task"
      aria-label={task.content}
    >
      {renderCard(task)}
      {targets.length > 0 && (
        <Popover
          align="right"
          trigger={({ onClick, open }) => (
            <button
              type="button"
              className={`icon-btn board-move ${open ? 'is-open' : ''}`}
              aria-label={t('Move {name} to another column', { name: task.content })}
              data-tooltip={t('Move to…')}
              aria-haspopup="menu"
              aria-expanded={open}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={onClick}
            >
              <ArrowRightLeft size={13} />
            </button>
          )}
        >
          {(close) => (
            <div className="picker picker-scroll" role="menu" aria-label={t('Move to')}>
              <div className="picker-heading" role="presentation">
                {t('Move to')}
              </div>
              {targets.map((target) => (
                <button
                  key={target.key}
                  type="button"
                  role="menuitem"
                  className="picker-row"
                  onClick={() => {
                    close();
                    onMove(task, target);
                  }}
                >
                  {target.icon}
                  <span className="row-label">{target.title}</span>
                </button>
              ))}
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}
