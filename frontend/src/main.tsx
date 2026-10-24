import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { IS_WEB_APP } from './api/backend';
import { PrivacyPage } from './components/PrivacyPage';
import { SessionGate } from './components/SessionGate';
import './styles.css';

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
const publicPage = IS_WEB_APP && window.location.pathname.replace(/\/+$/, '') === '/privacy' ? <PrivacyPage /> : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {publicPage ?? (
      <QueryClientProvider client={queryClient}>
        <SessionGate>
          <App />
        </SessionGate>
      </QueryClientProvider>
    )}
  </StrictMode>,
);
