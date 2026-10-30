import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queueCalendarPush } from './calendarAccess';
import { api, getDataMode } from './client';
import type { LabelInput, Note, NoteInput, ProjectInput, ReorderItem, SectionInput, Task, TaskInput } from './types';
import { showToast } from '../lib/toast';
import { asOneUndo, recordIrreversible, recordUndo, runUndo } from '../lib/undo';

export const queryKeys = {
  projects: ['projects'] as const,
  sections: ['sections'] as const,
  labels: ['labels'] as const,
  notes: ['notes'] as const,
  tasks: ['tasks', 'active'] as const,
  completed: ['tasks', 'completed'] as const,
  completions: ['completions'] as const,
  calendarSync: ['calendar', 'sync'] as const,
  calendarList: ['calendar', 'list'] as const,
  calendarEvents: ['calendar', 'events'] as const,
};

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

export const useCalendarSync = () =>
  useQuery({ queryKey: queryKeys.calendarSync, queryFn: api.calendar.syncStatus, staleTime: 30_000 });

/** Google events for a local date range; only fetched once calendar access has been granted. */
export const useCalendarEvents = (from: string, to: string, enabled = true) => {
  const sync = useCalendarSync();
  return useQuery({
    queryKey: [...queryKeys.calendarEvents, from, to],
    queryFn: () => api.calendar.events(from, to),
    enabled: enabled && sync.data?.scopeGranted === true,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
};

export const useProjects = () => useQuery({ queryKey: queryKeys.projects, queryFn: api.projects.list });
export const useSections = () => useQuery({ queryKey: queryKeys.sections, queryFn: api.sections.list });
export const useLabels = () => useQuery({ queryKey: queryKeys.labels, queryFn: api.labels.list });
export const useNotes = (enabled = true) => useQuery({ queryKey: queryKeys.notes, queryFn: api.notes.list, enabled });

/**
 * Notes save while the user types, so updates are applied to the cache right away (no flicker, no lost
 * keystrokes) and only invalidated on failure.
 */
export function useNoteMutations() {
  const qc = useQueryClient();
  // Desktop: popped-out note windows and the mini list refetch when any window changes a note.
  const announce = () => window.mytodoease?.notesChanged?.();
  const patchCache = (id: string, input: NoteInput) =>
    qc.setQueryData<Note[]>(queryKeys.notes, (old) => old?.map((n) => (n.id === id ? { ...n, ...input } : n)));
  const refetch = () => void qc.invalidateQueries({ queryKey: queryKeys.notes });
  return {
    create: useMutation({
      mutationFn: (input: NoteInput) => api.notes.create(input),
      onSuccess: (note) => {
        qc.setQueryData<Note[]>(queryKeys.notes, (old) => (old ? [note, ...old.filter((n) => n.id !== note.id)] : [note]));
        announce();
      },
      onError,
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: NoteInput }) => api.notes.update(id, input),
      onMutate: ({ id, input }) => patchCache(id, input),
      onSuccess: announce,
      onError: (error) => {
        refetch();
        onError(error);
      },
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.notes.remove(id),
      onMutate: (id) => qc.setQueryData<Note[]>(queryKeys.notes, (old) => old?.filter((n) => n.id !== id)),
      onSuccess: announce,
      onError: (error) => {
        refetch();
        onError(error);
      },
    }),
    reorder: useMutation({
      mutationFn: (items: { id: string; order: number }[]) => api.notes.reorder(items),
      onMutate: (items) => {
        const orders = new Map(items.map((i) => [i.id, i.order]));
        qc.setQueryData<Note[]>(queryKeys.notes, (old) =>
          old?.map((n) => (orders.has(n.id) ? { ...n, order: orders.get(n.id)! } : n)).sort((a, b) => a.order - b.order),
        );
      },
      onError: (error) => {
        refetch();
        onError(error);
      },
    }),
  };
}
export const useActiveTasks = () => useQuery({ queryKey: queryKeys.tasks, queryFn: api.tasks.listActive });
export const useCompletedTasks = (enabled: boolean) =>
  useQuery({ queryKey: queryKeys.completed, queryFn: () => api.tasks.listCompleted(), enabled });
export const useCompletions = (from: string, to: string) =>
  useQuery({ queryKey: [...queryKeys.completions, from, to], queryFn: () => api.stats.completions(from, to) });

const onError = (error: unknown) => {
  showToast(error instanceof Error ? error.message : 'Something went wrong.', 'error');
};

/** A task as a full write request (the API replaces every field on update). */
function inputOf(task: Task): TaskInput {
  return {
    content: task.content,
    description: task.description,
    projectId: task.projectId,
    sectionId: task.sectionId,
    parentId: task.parentId,
    labelIds: task.labelIds,
    priority: task.priority,
    dueDate: task.dueDate,
    // '' clears: putting back a one-day task must remove a start the change added.
    startDate: task.startDate ?? '',
    dueTime: task.dueTime,
    durationMinutes: task.durationMinutes,
    recurrence: task.recurrence,
    order: task.order,
  };
}

/** The cached task with an update applied, so the screen changes before the server answers. */
function withInput(task: Task, input: TaskInput): Task {
  const dueDate = input.dueDate ?? null;
  const startDate = input.startDate == null ? task.startDate : input.startDate || null;
  return {
    ...task,
    content: input.content,
    description: input.description ?? task.description,
    projectId: input.projectId,
    sectionId: input.sectionId ?? null,
    parentId: input.parentId ?? null,
    labelIds: input.labelIds ?? task.labelIds,
    priority: input.priority ?? task.priority,
    dueDate,
    startDate: dueDate && startDate && startDate < dueDate ? startDate : null,
    dueTime: dueDate ? (input.dueTime ?? null) : null,
    durationMinutes: input.durationMinutes ?? null,
    recurrence: dueDate ? (input.recurrence ?? task.recurrence) : 'none',
    order: input.order ?? task.order,
  };
}

const quoted = (task: Task) => `“${task.content.length > 40 ? `${task.content.slice(0, 40)}…` : task.content}”`;

/** How an update reads in the undo toast. */
function describeUpdate(before: Task, input: TaskInput): string {
  const dateChanged =
    (input.dueDate ?? null) !== before.dueDate ||
    (input.dueTime ?? null) !== before.dueTime ||
    (input.startDate != null && (input.startDate || null) !== (before.startDate ?? null));
  if (dateChanged) return `rescheduled ${quoted(before)}`;
  if (input.content !== before.content) return `renamed ${quoted(before)}`;
  if ((input.priority ?? before.priority) !== before.priority) return `changed the priority of ${quoted(before)}`;
  if (input.projectId !== before.projectId || (input.sectionId ?? null) !== before.sectionId) return `moved ${quoted(before)}`;
  return `edited ${quoted(before)}`;
}

export function useTaskMutations() {
  const qc = useQueryClient();
  const invalidateTasks = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.tasks });
    void qc.invalidateQueries({ queryKey: queryKeys.completed });
    void qc.invalidateQueries({ queryKey: queryKeys.completions });
  };
  // Cloud mode: the changed task goes to Google Calendar right away (local mode: the API does the same itself).
  const changed = (...ids: string[]) => {
    invalidateTasks();
    if (getDataMode() === 'cloud') queueCalendarPush(ids);
  };
  const cachedTask = (id: string) =>
    qc.getQueryData<Task[]>(queryKeys.tasks)?.find((t) => t.id === id) ??
    qc.getQueryData<Task[]>(queryKeys.completed)?.find((t) => t.id === id);

  const create = useMutation({
    mutationFn: (input: TaskInput) => api.tasks.create(input),
    onSuccess: (task) => {
      changed(task.id);
      recordUndo({
        label: `added ${quoted(task)}`,
        run: async () => {
          await api.tasks.remove(task.id);
          changed(task.id);
        },
      });
    },
    onError,
  });

  // Optimistic: the change shows at once (a dragged chip lands where it was dropped) and is rolled back on error.
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: TaskInput }) => api.tasks.update(id, input),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasks });
      const before = cachedTask(id);
      if (before) qc.setQueryData<Task[]>(queryKeys.tasks, (old) => old?.map((t) => (t.id === id ? withInput(t, input) : t)));
      return { before };
    },
    onError: (error) => {
      invalidateTasks();
      onError(error);
    },
    onSuccess: (task, { input }, context) => {
      changed(task.id);
      const before = context?.before;
      if (!before) return;
      recordUndo({
        label: describeUpdate(before, input),
        run: async () => {
          await api.tasks.update(before.id, inputOf(before));
          changed(before.id);
        },
      });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.tasks.remove(id),
    onMutate: (id) => {
      // Deleting removes the sub-tasks too; keep the open ones so Undo can rebuild the tree.
      const active = qc.getQueryData<Task[]>(queryKeys.tasks) ?? [];
      const tree: Task[] = [];
      const collect = (parentId: string) => {
        for (const child of active.filter((t) => t.parentId === parentId)) {
          tree.push(child);
          collect(child.id);
        }
      };
      const target = cachedTask(id);
      if (target) collect(target.id);
      return { target, tree };
    },
    onSuccess: (_result, id, context) => {
      changed(id);
      const target = context?.target;
      if (!target) return;
      if (target.isCompleted) {
        recordIrreversible(`deleted ${quoted(target)}`, 'Deleting a completed task cannot be undone.');
        return;
      }
      recordUndo({
        label: `deleted ${quoted(target)}`,
        // Recreated with the same details; new ids, and the parent goes first so sub-tasks can hang under it.
        run: async () => {
          const ids = new Map<string, string>();
          for (const task of [target, ...(context?.tree ?? [])]) {
            const parentId = task.parentId ? (ids.get(task.parentId) ?? task.parentId) : null;
            const created = await api.tasks.create({ ...inputOf(task), startDate: task.startDate ?? null, parentId });
            ids.set(task.id, created.id);
          }
          invalidateTasks();
        },
      });
    },
    onError,
  });

  // Completing is optimistic: the row disappears immediately and comes back if the server rejects it.
  const complete = useMutation({
    mutationFn: (id: string) => api.tasks.complete(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasks });
      const previous = qc.getQueryData<Task[]>(queryKeys.tasks);
      const target = previous?.find((t) => t.id === id);
      if (previous && target && target.recurrence === 'none') {
        qc.setQueryData<Task[]>(
          queryKeys.tasks,
          previous.filter((t) => t.id !== id && t.parentId !== id),
        );
      }
      return { previous };
    },
    onError: (error, _id, context) => {
      if (context?.previous) qc.setQueryData(queryKeys.tasks, context.previous);
      onError(error);
    },
    onSuccess: (task, id, context) => {
      changed(task.id);
      const before = context?.previous?.find((t) => t.id === id);
      if (!before) return;
      // The open subtasks that were closed along with it, so Undo can bring them back too.
      const closedChildren = (context?.previous ?? []).filter((t) => t.parentId === id && !t.isCompleted);
      const entry = recordUndo({ label: `completed ${quoted(before)}`, run: () => undoComplete(before, closedChildren) });
      showToast(before.recurrence === 'none' ? 'Task completed' : 'Done for now; moved to the next date', 'success', {
        group: 'task-completed',
        duration: 5000,
        action: { label: 'Undo', run: () => void runUndo(entry).catch(onError) },
      });
    },
    onSettled: invalidateTasks,
  });

  /** Undo a completion: reopen the task (the API also drops its completion record) and, for a repeating
   * task, put its due date back where it was. */
  const undoComplete = async (before: Task, closedChildren: Task[]) => {
    try {
      await api.tasks.reopen(before.id);
      await Promise.all(closedChildren.map((child) => api.tasks.reopen(child.id)));
      if (before.recurrence !== 'none') await api.tasks.update(before.id, inputOf(before));
      changed(before.id, ...closedChildren.map((c) => c.id));
    } catch (error) {
      invalidateTasks();
      throw error;
    }
  };

  const reopen = useMutation({
    mutationFn: (id: string) => api.tasks.reopen(id),
    onSuccess: (task) => {
      changed(task.id);
      recordUndo({
        label: `reopened ${quoted(task)}`,
        run: async () => {
          await api.tasks.complete(task.id);
          changed(task.id);
        },
      });
    },
    onError,
  });

  // Optimistic: the list stays where the user dropped it while the API catches up.
  const reorder = useMutation({
    mutationFn: api.tasks.reorder,
    onMutate: async (items: ReorderItem[]) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasks });
      const previous = qc.getQueryData<Task[]>(queryKeys.tasks) ?? [];
      const byId = new Map(items.map((i) => [i.id, i]));
      const before = previous.filter((t) => byId.has(t.id));
      qc.setQueryData<Task[]>(queryKeys.tasks, (old) =>
        old?.map((t) => {
          const item = byId.get(t.id);
          if (!item) return t;
          return {
            ...t,
            order: item.order,
            sectionId: item.sectionId == null ? t.sectionId : item.sectionId || null,
            parentId: item.parentId == null ? t.parentId : item.parentId || null,
          };
        }),
      );
      return { before };
    },
    onSuccess: (_result, _items, context) => {
      invalidateTasks();
      const before = context?.before ?? [];
      if (before.length === 0) return;
      recordUndo({
        label: before.length === 1 ? `moved ${quoted(before[0])}` : 'moved tasks',
        run: async () => {
          await api.tasks.reorder(
            before.map((t) => ({ id: t.id, order: t.order, sectionId: t.sectionId ?? '', parentId: t.parentId ?? '' })),
          );
          invalidateTasks();
        },
      });
    },
    onError: (error) => {
      invalidateTasks();
      onError(error);
    },
  });

  /**
   * Several updates made as one action (Plan my day, Reschedule overdue): saved one after another, undone
   * together in one step.
   */
  const updateMany = async (label: string, changes: { task: Task; input: TaskInput }[]) => {
    if (changes.length === 0) return;
    await asOneUndo(
      label,
      async () => {
        for (const { task, input } of changes) await update.mutateAsync({ id: task.id, input });
      },
      async () => {
        for (const { task } of changes) await api.tasks.update(task.id, inputOf(task));
        changed(...changes.map(({ task }) => task.id));
      },
    );
  };

  return { create, update, remove, complete, reopen, reorder, updateMany };
}

export function useProjectMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
    void qc.invalidateQueries({ queryKey: queryKeys.sections });
    void qc.invalidateQueries({ queryKey: queryKeys.tasks });
  };
  return {
    create: useMutation({ mutationFn: (input: ProjectInput) => api.projects.create(input), onSuccess: invalidate, onError }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: ProjectInput }) => api.projects.update(id, input),
      onSuccess: invalidate,
      onError,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.projects.remove(id), onSuccess: invalidate, onError }),
  };
}

export function useSectionMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.sections });
    void qc.invalidateQueries({ queryKey: queryKeys.tasks });
  };
  return {
    create: useMutation({ mutationFn: (input: SectionInput) => api.sections.create(input), onSuccess: invalidate, onError }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: SectionInput }) => api.sections.update(id, input),
      onSuccess: invalidate,
      onError,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.sections.remove(id), onSuccess: invalidate, onError }),
  };
}

export function useLabelMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.labels });
    void qc.invalidateQueries({ queryKey: queryKeys.tasks });
  };
  return {
    create: useMutation({ mutationFn: (input: LabelInput) => api.labels.create(input), onSuccess: invalidate, onError }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: LabelInput }) => api.labels.update(id, input),
      onSuccess: invalidate,
      onError,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.labels.remove(id), onSuccess: invalidate, onError }),
  };
}
