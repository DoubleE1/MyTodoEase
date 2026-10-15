import logoUrl from '../assets/logo.svg';

/**
 * MyTodoEase mark: a deep-space tile with a neon rim and three list rows drawn as glowing
 * four-point stars with comet trails. The artwork lives in src/assets/logo.svg (single source);
 * public/logo.svg (favicon) and desktop/build/icon.* (installer) are generated from it.
 */
export function Logo({ size = 20, title = 'MyTodoEase' }: { size?: number; title?: string }) {
  return <img src={logoUrl} width={size} height={size} alt={title} className="logo" draggable={false} />;
}

/** Logo plus the name, with "Ease" in the brand gradient. */
export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="wordmark">
      <Logo size={size} />
      <span className="wordmark-text">
        MyTodo<strong>Ease</strong>
      </span>
    </span>
  );
}
