import { CheckCircle2, X } from 'lucide-react';
import { dismissToast, useToasts } from '../lib/toast';
import { UpdateBanner } from './UpdateBanner';

/** Transient messages, plus the desktop "Restart to update" banner, which shares the same overlay layer. */
export function Toasts() {
  const toasts = useToasts();
  return (
    <>
      <UpdateBanner />
      {toasts.length > 0 && <ToastList toasts={toasts} />}
    </>
  );
}

function ToastList({ toasts }: { toasts: ReturnType<typeof useToasts> }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          {t.kind === 'success' && <CheckCircle2 size={16} className="toast-icon" aria-hidden="true" />}
          <span className="toast-message">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                dismissToast(t.id);
                t.action?.run();
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="icon-btn" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
