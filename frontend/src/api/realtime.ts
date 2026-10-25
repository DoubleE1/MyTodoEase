/**
 * Live updates while signed in: Firestore listeners push each collection straight into the query cache, so a
 * change made on another device (or tab) shows up without a refresh. The Google Calendar documents a sync
 * writes (status, the user's calendars, pulled events) arrive the same way, which is how "Sync now" pressed on
 * one device updates Settings and the calendar on every other one.
 */
import type { QueryClient } from '@tanstack/react-query';
import { doc, onSnapshot } from 'firebase/firestore';
import { calendarStatusFrom } from './calendarSync';
import { sortActiveTasks, sortCompletedTasks, sortLabels, sortProjects, sortSections, userCollection, userDoc } from './firestoreClient';
import { queryKeys } from './hooks';
import type { GoogleCalendarInfo, Label, Project, Section, Task } from './types';

export function subscribeRealtime(queryClient: QueryClient): () => void {
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
    }),
    onSnapshot(doc(userDoc(), 'calendarSync', 'status'), (snap) => {
      queryClient.setQueryData(queryKeys.calendarSync, calendarStatusFrom(snap.exists() ? snap.data() : undefined));
    }),
    onSnapshot(doc(userDoc(), 'calendarSync', 'calendars'), (snap) => {
      const items = snap.exists() ? ((snap.data().items as GoogleCalendarInfo[] | undefined) ?? []) : [];
      queryClient.setQueryData(queryKeys.calendarList, items);
    }),
    onSnapshot(userCollection('calendarEvents'), () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents });
    }),
  ];
  return () => stops.forEach((stop) => stop());
}
