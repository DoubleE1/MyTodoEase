import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { IS_WEB_APP } from './api/backend';
import { AuthGate } from './components/SignIn';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {IS_WEB_APP ? (
        <AuthGate>
          <App />
        </AuthGate>
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </StrictMode>,
);
