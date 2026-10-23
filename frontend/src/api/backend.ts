/**
 * Which data backend this build talks to. The desktop app and `npm run dev` use the local ASP.NET API;
 * the hosted web app (`vite build --mode web`, which loads frontend/.env.web) uses Firebase.
 */
export type Backend = 'rest' | 'firebase';

export const BACKEND: Backend = import.meta.env.VITE_BACKEND === 'firebase' ? 'firebase' : 'rest';

/** True in the hosted web app: data lives in Firestore under the signed-in Google account. */
export const IS_WEB_APP = BACKEND === 'firebase';
