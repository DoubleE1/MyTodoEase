import { useQueryClient } from '@tanstack/react-query';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { IS_WEB_APP } from '../api/backend';
import { desktopCloud, setDataMode } from '../api/client';
import { shareSessionWithApi } from '../api/cloudSession';
import { subscribeRealtime } from '../api/realtime';
import { firebase } from '../firebase/app';
import { SignInScreen } from './SignIn';

const CloudUserContext = createContext<User | null>(null);

/** The signed-in Firebase user, or null in local mode. */
export const useCloudUser = () => useContext(CloudUserContext);

/**
 * Entry gate for both builds. It waits for Firebase to restore a persisted session, then:
 * - web app: requires a user (sign-in page otherwise) and keeps the live Firestore listeners running;
 * - desktop: runs in local mode (LiteDB through the API) with no user, and switches the data layer to Firestore
 *   when one signs in, sharing the session with the local API so MCP and Calendar sync follow.
 * The app tree is re-keyed per user so no view state or cached rows leak from one account (or mode) to another.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    try {
      return onAuthStateChanged(firebase().auth, setUser);
    } catch (error) {
      // No Firebase config in this build: the desktop still works on its local data.
      console.warn('Cloud sync is unavailable:', error);
      setUser(null);
      return undefined;
    }
  }, []);

  const uid = user?.uid;
  const sessionKey = uid ?? 'local';

  // Switch the data layer and drop cached rows *before* the new tree renders and fetches.
  setDataMode(uid ? 'cloud' : 'local');
  const previousKey = useRef(sessionKey);
  if (previousKey.current !== sessionKey) {
    previousKey.current = sessionKey;
    queryClient.clear();
  }

  useEffect(() => {
    if (!uid || !user) return;
    const notify = IS_WEB_APP ? undefined : (ids: string[]) => void desktopCloud.notifyTaskChanges(ids).catch(() => undefined);
    const stop = subscribeRealtime(queryClient, notify);
    void shareSessionWithApi(user);
    return stop;
    // `user` identity changes on token refresh; only the uid matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, queryClient]);

  if (user === undefined) {
    return (
      <div className="signin-screen">
        <div className="loading">Loading…</div>
      </div>
    );
  }
  if (IS_WEB_APP && !user) return <SignInScreen />;
  return (
    <CloudUserContext.Provider value={user} key={sessionKey}>
      {children}
    </CloudUserContext.Provider>
  );
}
