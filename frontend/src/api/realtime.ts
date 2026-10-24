/**
 * Live updates while signed in: Firestore listeners push each collection straight into the query cache, so a
 * change made on another device (or tab) shows up without a refresh. In the desktop app the task listener also
 * reports changed task ids to the local API, whose Google Calendar mirror then pushes them right away.
 */
import type { QueryClient } from '@tanstack/react-query';
import { onSnapshot } from 'firebase/firestore';
import { sortActiveTasks, sortCompletedTasks, sortLabels, sortProjects, sortSections, userCollection } from './firestoreClient';
import { queryKeys } from './hooks';
import type { Label, Project, Section, Task } from './types';

export function subscribeRealtime(queryClient: QueryClient, onTaskChanges?: (taskIds: string[]) => void): () => void {
  let firstTasksSnapshot = true;
  const stops = [
    onSnapshot(userCollection('projects'), (snap) => {
      const items = snap.docs.map((d) => d.data() as Project);
      if (items.length > 0) queryClient.setQueryData(queryKeys.projects, sortProjects(items));
    }),
    onSnapshot(userCollection('sections'), (snap) =>
      queryClient.setQueryData(queryKeys.sections, sortSections(snap.docs.map((d) => d.data() as Section))),
    ),
    onSnapshot(userCollection('labels'), (snap) =>
      queryClient.setQueryData(queryKeys.labels, sortLabels(snap.docs.map((d) => d.data() as Label))),
    ),
    onSnapshot(userCollection('tasks'), (snap) => {
      const items = snap.docs.map((d) => d.data() as Task);
      queryClient.setQueryData(queryKeys.tasks, sortActiveTasks(items));
      queryClient.setQueryData(queryKeys.completed, sortCompletedTasks(items));
      void queryClient.invalidateQueries({ queryKey: queryKeys.completions });
      // The first snapshot lists everything; the API reconciles fully on its own when a session starts.
      if (firstTasksSnapshot) {
        firstTasksSnapshot = false;
      } else if (onTaskChanges) {
        const changed = snap.docChanges().map((c) => c.doc.id);
        if (changed.length > 0) onTaskChanges(changed);
      }
    }),
  ];
  return () => stops.forEach((stop) => stop());
}
