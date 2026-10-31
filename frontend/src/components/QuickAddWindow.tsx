import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLabelMutations, useLabels, useProjects, useSections, useTaskMutations } from '../api/hooks';
import { useTheme } from '../lib/theme';
import { TaskEditor } from './TaskEditor';
import { TooltipLayer } from './TooltipLayer';
import { t } from '../i18n';

/** Window height while a picker is open, so the date picker fits below the box. */
const PICKER_ROOM = 460;

/**
 * Desktop: the "New task" global shortcut's popup (a small frameless window loaded with #quick-add). Type a
 * task with the usual quick-add words ("call mum tomorrow 3pm #Home"), Enter adds it to the Inbox, Esc or
 * clicking elsewhere puts the window away. The shell keeps the window between uses; each showing starts afresh.
 */
export function QuickAddWindow() {
  useTheme();
  const queryClient = useQueryClient();
  const projects = useProjects();
  const sections = useSections();
  const labels = useLabels();
  const taskMut = useTaskMutations();
  const labelMut = useLabelMutations();
  const [round, setRound] = useState(0);
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    document.title = t('New task');
    return window.mytodoease?.onQuickAddShown?.(() => {
      setAdded(null);
      setRound((n) => n + 1);
      // Projects or labels may have changed in the main window since the last time.
      void queryClient.invalidateQueries();
    });
  }, [queryClient]);

  // The window is as tall as the box, and taller while a picker (date, priority, labels) is open below it.
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let last = 0;
    const fit = () => {
      const pickerOpen = !!document.querySelector('.popover');
      const wanted = Math.ceil(Math.max(root.offsetHeight, pickerOpen ? PICKER_ROOM : 0));
      if (wanted === last) return;
      last = wanted;
      void window.mytodoease?.resizeQuickAdd?.(wanted);
    };
    fit();
    const sizes = new ResizeObserver(fit);
    sizes.observe(root);
    // Pickers open in a portal on <body>.
    const pickers = new MutationObserver(fit);
    pickers.observe(document.body, { childList: true });
    return () => {
      sizes.disconnect();
      pickers.disconnect();
    };
  }, []);

  const close = () => void window.mytodoease?.closeQuickAdd?.();
  const inbox = projects.data?.find((p) => p.isInbox);

  return (
    <div ref={rootRef} className="quick-add-window">
      <header className="quick-add-head">
        <strong>{t('New task')}</strong>
        <span className="muted small">{t('Enter to add · Esc to close')}</span>
      </header>
      {added ? (
        <p className="quick-add-done" role="status">
          <Check size={16} />
          <span>{t('Added “{name}”.', { name: added })}</span>
        </p>
      ) : inbox ? (
        <TaskEditor
          key={round}
          mode="create"
          defaults={{ projectId: inbox.id }}
          projects={projects.data ?? []}
          sections={sections.data ?? []}
          labels={labels.data ?? []}
          onCreateLabel={(name) => labelMut.create.mutateAsync({ name })}
          onSubmit={async (input) => {
            await taskMut.create.mutateAsync(input);
            window.mytodoease?.tasksChanged?.();
            setAdded(input.content);
            window.setTimeout(close, 700);
          }}
          onCancel={close}
          placeholder={t('e.g. Call mum tomorrow 3pm #Home')}
        />
      ) : (
        <p className="muted quick-add-loading">{t('Loading…')}</p>
      )}
      <TooltipLayer />
    </div>
  );
}
