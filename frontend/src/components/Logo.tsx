import logoUrl from '../assets/logo.png';

/**
 * MyTodoEase mark: the provided artwork (deep-space tile with neon rim and three glowing star
 * rows), cropped to the tile with transparent rounded corners. src/assets/logo.png is the in-app
 * copy; public/logo.png (favicon) and desktop/build/icon.* (window and installer) come from the
 * same crop.
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
