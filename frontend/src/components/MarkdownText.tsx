import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Task descriptions as Markdown (GitHub flavour: lists, task lists, tables, strikethrough, autolinks).
 * Raw HTML in the text is shown as text, never rendered, and react-markdown drops unsafe link protocols
 * such as javascript:. Links open in a new tab (the desktop shell sends them to the system browser).
 */
const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // The surrounding block opens the editor on click; following a link must not.
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </a>
  ),
  // Task-list checkboxes are display only; ticking them here would not save anything.
  input: (props) => <input {...props} disabled />,
};

export function MarkdownText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`md ${className ?? ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
