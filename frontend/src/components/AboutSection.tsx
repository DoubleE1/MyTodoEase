import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { IS_WEB_APP } from '../api/backend';
import { describeUpdateState, useUpdateState } from '../lib/updates';

const RELEASES_URL = 'https://github.com/dbo-e/TodoEase/releases';

/** Settings > About: the running version and, in the desktop app, the automatic-update status and a manual check. */
export function AboutSection() {
  const { supported, state, check, install } = useUpdateState();
  const [restarting, setRestarting] = useState(false);
  const version = state?.currentVersion ?? __APP_VERSION__;
  const busy = state?.status === 'checking' || state?.status === 'downloading';

  const restart = async () => {
    setRestarting(true);
    const started = await install();
    if (!started) setRestarting(false);
  };

  return (
    <section className="settings-section">
      <h3>About</h3>
      <p className="settings-help">
        TodoEase {version}
        {IS_WEB_APP ? ' (web app)' : ''}
        {' · '}
        <a href={RELEASES_URL} target="_blank" rel="noreferrer">
          Release notes
        </a>
      </p>

      {supported && state ? (
        <div className={`settings-callout ${state.status === 'ready' ? '' : 'settings-callout-quiet'}`}>
          <div>
            <strong className="settings-callout-title">Updates</strong>
            <p role="status" className={state.status === 'error' ? 'settings-error' : undefined}>
              {describeUpdateState(state)}
            </p>
          </div>
          {state.status === 'ready' ? (
            <button type="button" className="btn btn-primary" onClick={() => void restart()} disabled={restarting}>
              <RefreshCw size={14} />
              <span>{restarting ? 'Restarting…' : 'Restart to update'}</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={() => void check()}
              disabled={busy || state.status === 'unavailable'}
            >
              <RefreshCw size={14} className={busy ? 'is-spinning' : undefined} />
              <span>{busy ? 'Checking…' : 'Check for updates'}</span>
            </button>
          )}
        </div>
      ) : (
        <p className="settings-help">
          {IS_WEB_APP
            ? 'The web app is always the latest version; reload the page if it has been open for a long time.'
            : 'The Windows app updates itself: it checks for a new version when it starts and asks you to restart once one is downloaded.'}
        </p>
      )}
    </section>
  );
}
