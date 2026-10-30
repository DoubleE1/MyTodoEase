import { lazy, Suspense } from 'react';

// The same rich-text editor as task descriptions (TipTap); large, so it loads on demand.
const DescriptionEditor = lazy(() => import('./DescriptionEditor'));

/**
 * A sticky note's text with the description editor's formatting (bold, italic, lists, links…). Stored as
 * Markdown, so plain-text notes read the same. `version` restarts the editor when the text changed elsewhere.
 */
export function NoteEditor({
  value,
  version = 0,
  onChange,
  onDone,
  onEscape,
  toolbarHost,
  autoFocus = false,
}: {
  value: string;
  version?: number;
  onChange: (markdown: string) => void;
  /** Ctrl/Cmd+Enter. */
  onDone: () => void;
  onEscape: () => void;
  /** Where the formatting toolbar is drawn (the note's bottom bar). */
  toolbarHost: HTMLElement | null;
  autoFocus?: boolean;
}) {
  return (
    <Suspense fallback={<div className="rich-desc is-note rich-desc-loading" aria-hidden="true" />}>
      <DescriptionEditor
        key={version}
        value={value}
        onChange={onChange}
        onSubmit={onDone}
        onCancel={onEscape}
        toolbarHost={toolbarHost}
        autoFocus={autoFocus}
        variant="note"
        placeholder="Write anything… e.g. a list of things to do"
        label="Note"
      />
    </Suspense>
  );
}
