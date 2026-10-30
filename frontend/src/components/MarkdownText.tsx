import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { toggleTaskOnLine } from '../lib/markdownTasks';
import { t } from '../i18n';

/**
 * Task descriptions as Markdown (GitHub flavour: lists, task lists, tables, strikethrough, autolinks). A single
 * line break stays a line break (as in GitHub comments), so notes typed line by line keep their shape.
 * Raw HTML in the text is shown as text, never rendered, and react-markdown drops unsafe link protocols
 * such as javascript:. Links open in a new tab (the desktop shell sends them to the system browser).
 * With `onChange`, checklist boxes can be ticked in place: the matching `[ ]` / `[x]` in the text flips.
 */
const baseComponents: Components = {
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
  // Without onChange the checklist boxes are display only.
  input: ({ node: _node, ...props }) => <input {...props} disabled />,
};

export function MarkdownText({
  text,
  className,
  onChange,
}: {
  text: string;
  className?: string;
  /** Called with the updated text when a checklist box is ticked or unticked. */
  onChange?: (next: string) => void;
}) {
  const components: Components = onChange
    ? {
        ...baseComponents,
        // The list item knows its source line; the checkbox inside it reports through the item.
        li: ({ node, children, className: itemClass }) => {
          const line = node?.position?.start.line;
          const isTask = typeof itemClass === 'string' && itemClass.includes('task-list-item');
          return (
            <li
              className={itemClass}
              onChange={
                isTask && line
                  ? (event) => {
                      const target = event.target as EventTarget;
                      if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
                      const next = toggleTaskOnLine(text, line);
                      if (next !== text) onChange(next);
                    }
                  : undefined
              }
            >
              {children}
            </li>
          );
        },
        input: ({ node: _node, disabled: _disabled, ...props }) =>
          props.type === 'checkbox' ? (
            <input
              {...props}
              className="md-check"
              aria-label={t('Tick checklist item')}
              // Ticking a box must not open the description editor around it.
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              // The list item handles the change and saves the new text, which re-renders this box.
              onChange={() => undefined}
            />
          ) : (
            <input {...props} disabled />
          ),
      }
    : baseComponents;

  return (
    <div className={`md ${className ?? ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
