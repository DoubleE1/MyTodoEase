import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { LabelInput, ProjectInput, SectionInput, Task, TaskInput } from './types';
import { showToast } from '../lib/toast';

export const queryKeys = {
  projects: ['projects'] as const,
  sections: ['sections'] as const,
  labels: ['labels'] as const,
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
export const useActiveTasks = () => useQuery({ queryKey: queryKeys.tasks, queryFn: api.tasks.listActive });
export const useCompletedTasks = (enabled: boolean) =>
  useQuery({ queryKey: queryKeys.completed, queryFn: () => api.tasks.listCompleted(), enabled });
export const useCompletions = (from: string, to: string) =>
  useQuery({ queryKey: [...queryKeys.completions, from, to], queryFn: () => api.stats.completions(from, to) });

const onError = (error: unknown) => {
  showToast(error instanceof Error ? error.message : 'Something went wrong.', 'error');
};

export function useTaskMutations() {
  const qc = useQueryClient();
  const invalidateTasks = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.tasks });
    void qc.invalidateQueries({ queryKey: queryKeys.completed });
    void qc.invalidateQueries({ queryKey: queryKeys.completions });
  };

  const create = useMutation({
    mutationFn: (input: TaskInput) => api.tasks.create(input),
    onSuccess: invalidateTasks,
    onError,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: TaskInput }) => api.tasks.update(id, input),
    onSuccess: invalidateTasks,
    onError,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.tasks.remove(id),
    onSuccess: invalidateTasks,
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
    onSettled: invalidateTasks,
  });

  const reopen = useMutation({
    mutationFn: (id: string) => api.tasks.reopen(id),
    onSuccess: invalidateTasks,
    onError,
  });

  const reorder = useMutation({
    mutationFn: api.tasks.reorder,
    onSuccess: invalidateTasks,
    onError,
  });

  return { create, update, remove, complete, reopen, reorder };
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
