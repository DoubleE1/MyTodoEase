import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { IS_WEB_APP } from './api/backend';
import { SessionGate } from './components/SessionGate';
import { applyStoredMotionPreference } from './lib/motion';
import './styles.css';

applyStoredMotionPreference();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

// The hosted site has one public page besides the app: the privacy policy linked from Google's consent screen.
// Desktop: a sticky note popped out into its own window loads this page with #note=<id>.
const NoteWindow = lazy(() => import('./components/NoteWindow').then((m) => ({ default: m.NoteWindow })));
const noteWindowId = /^#note=([\w-]+)$/.exec(window.location.hash)?.[1];

const PrivacyPage = lazy(() => import('./components/PrivacyPage').then((m) => ({ default: m.PrivacyPage })));
const publicPage =
  IS_WEB_APP && window.location.pathname.replace(/\/+$/, '') === '/privacy' ? (
    <Suspense fallback={null}>
      <PrivacyPage />
    </Suspense>
  ) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {publicPage ?? (
      <QueryClientProvider client={queryClient}>
        <SessionGate>
          {noteWindowId ? (
            <Suspense fallback={null}>
              <NoteWindow noteId={noteWindowId} />
            </Suspense>
          ) : (
            <App />
          )}
        </SessionGate>
      </QueryClientProvider>
    )}
  </StrictMode>,
);
