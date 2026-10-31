import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { SessionGate } from './components/SessionGate';
import { applyStoredMotionPreference } from './lib/motion';
import { applyLanguage } from './i18n';
import './styles.css';

applyStoredMotionPreference();
applyLanguage();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

// The hosted site's public privacy policy is a static page (frontend/public/privacy.html, served at /privacy by a
// Hosting rewrite), so Google's verification can read it without running scripts; it is not part of this bundle.
// Desktop: a sticky note popped out into its own window loads this page with #note=<id>.
const NoteWindow = lazy(() => import('./components/NoteWindow').then((m) => ({ default: m.NoteWindow })));
const noteWindowId = /^#note=([\w-]+)$/.exec(window.location.hash)?.[1];
// Desktop: the "New task" global shortcut's popup loads this page with #quick-add.
const QuickAddWindow = lazy(() => import('./components/QuickAddWindow').then((m) => ({ default: m.QuickAddWindow })));
const isQuickAddWindow = window.location.hash === '#quick-add';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionGate>
        {noteWindowId ? (
          <Suspense fallback={null}>
            <NoteWindow noteId={noteWindowId} />
          </Suspense>
        ) : isQuickAddWindow ? (
          <Suspense fallback={null}>
            <QuickAddWindow />
          </Suspense>
        ) : (
          <App />
        )}
      </SessionGate>
    </QueryClientProvider>
  </StrictMode>,
);
