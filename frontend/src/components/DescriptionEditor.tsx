import { Markdown } from '@tiptap/markdown';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Image } from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Bold,
  Columns3,
  ChevronDown,
  Code,
  Ellipsis,
  Heading,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Rows3,
  SquareCode,
  Strikethrough,
  Table,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Popover } from './Popover';
import { handleTableShortcut, TableControls } from './TableControls';

/**
 * The task description editor in the task detail. By default it is a rich-text editor: bold looks bold and a list
 * looks like a list while typing, and Markdown shortcuts (`- `, `1. `, `**bold**`, `# `) also work. It reads and
 * writes Markdown, so the stored text is unchanged in shape for the web app, the AI assistant tools and older
 * descriptions. People who prefer typing the symbols can switch to a plain Markdown box; the toolbar works in both.
 */

type Mode = 'rich' | 'markdown';
const MODE_KEY = 'todoease.descriptionMode';

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'markdown' ? 'markdown' : 'rich';
  } catch {
    return 'rich';
  }
}

function saveMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Private window or blocked storage: the choice just is not remembered.
  }
}

/** Formatting commands, implemented once for the rich editor and once for the Markdown text box. */
type Command =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'codeBlock'
  | 'quote'
  | 'divider'
  | 'table'
  // Only offered while the cursor is inside a table (rich mode).
  | 'rowBefore'
  | 'rowAfter'
  | 'colBefore'
  | 'colAfter'
  | 'deleteRow'
  | 'deleteCol'
  | 'deleteTable';

const TABLE_TEMPLATE = '| Column | Column |\n| --- | --- |\n|  |  |\n';

function runRich(editor: Editor, command: Command) {
  const chain = editor.chain().focus();
  switch (command) {
    case 'paragraph':
      return chain.setParagraph().run();
    case 'h1':
      return chain.toggleHeading({ level: 1 }).run();
    case 'h2':
      return chain.toggleHeading({ level: 2 }).run();
    case 'h3':
      return chain.toggleHeading({ level: 3 }).run();
    case 'bullet':
      return chain.toggleBulletList().run();
    case 'ordered':
      return chain.toggleOrderedList().run();
    case 'task':
      return chain.toggleTaskList().run();
    case 'bold':
      return chain.toggleBold().run();
    case 'italic':
      return chain.toggleItalic().run();
    case 'strike':
      return chain.toggleStrike().run();
    case 'code':
      return chain.toggleCode().run();
    case 'codeBlock':
      return chain.toggleCodeBlock().run();
    case 'quote':
      return chain.toggleBlockquote().run();
    case 'divider':
      return chain.setHorizontalRule().run();
    case 'table':
      return chain.insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    case 'rowBefore':
      return chain.addRowBefore().run();
    case 'rowAfter':
      return chain.addRowAfter().run();
    case 'colBefore':
      return chain.addColumnBefore().run();
    case 'colAfter':
      return chain.addColumnAfter().run();
    case 'deleteRow':
      return chain.deleteRow().run();
    case 'deleteCol':
      return chain.deleteColumn().run();
    case 'deleteTable':
      return chain.deleteTable().run();
  }
}

/** Apply a command to a Markdown textarea's selection; returns the new text and selection. */
function runMarkdown(text: string, start: number, end: number, command: Command): { text: string; start: number; end: number } {
  const selected = text.slice(start, end);
  const wrap = (before: string, after = before, fallback = 'text') => {
    const inner = selected || fallback;
    const next = text.slice(0, start) + before + inner + after + text.slice(end);
    return { text: next, start: start + before.length, end: start + before.length + inner.length };
  };
  // Line commands act on every line the selection touches.
  const lines = (transform: (line: string, index: number) => string) => {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const nextBreak = text.indexOf('\n', end);
    const lineEnd = nextBreak === -1 ? text.length : nextBreak;
    const block = text.slice(lineStart, lineEnd).split('\n').map(transform).join('\n');
    return { text: text.slice(0, lineStart) + block + text.slice(lineEnd), start: lineStart, end: lineStart + block.length };
  };
  const stripPrefix = (line: string) => line.replace(/^(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, '');
  const insertBlock = (block: string) => {
    const before = start > 0 && text[start - 1] !== '\n' ? '\n\n' : '';
    const next = text.slice(0, start) + before + block + text.slice(end);
    const caret = start + before.length + block.length;
    return { text: next, start: caret, end: caret };
  };
  switch (command) {
    case 'paragraph':
      return lines(stripPrefix);
    case 'h1':
      return lines((l) => `# ${stripPrefix(l)}`);
    case 'h2':
      return lines((l) => `## ${stripPrefix(l)}`);
    case 'h3':
      return lines((l) => `### ${stripPrefix(l)}`);
    case 'bullet':
      return lines((l) => `- ${stripPrefix(l)}`);
    case 'ordered':
      return lines((l, i) => `${i + 1}. ${stripPrefix(l)}`);
    case 'task':
      return lines((l) => `- [ ] ${stripPrefix(l)}`);
    case 'quote':
      return lines((l) => `> ${stripPrefix(l)}`);
    case 'bold':
      return wrap('**');
    case 'italic':
      return wrap('_');
    case 'strike':
      return wrap('~~');
    case 'code':
      return wrap('`', '`', 'code');
    case 'codeBlock':
      return wrap('```\n', '\n```', 'code');
    case 'divider':
      return insertBlock('---\n');
    case 'table':
      return insertBlock(TABLE_TEMPLATE);
    default:
      // Table editing commands exist only in rich mode; in the Markdown box the table is plain text.
      return { text, start, end };
  }
}

interface DescriptionEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  /** Ctrl/Cmd+Enter. */
  onSubmit: () => void;
  /** Escape. */
  onCancel: () => void;
  /** Where the toolbar is drawn (the editor footer, beside Cancel and Save). */
  toolbarHost: HTMLElement | null;
}

export default function DescriptionEditor({ value, onChange, onSubmit, onCancel, toolbarHost }: DescriptionEditorProps) {
  const [mode, setMode] = useState<Mode>(readMode);
  const [markdown, setMarkdown] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Latest callbacks for the editor's key handler, which is created once.
  const handlers = useRef({ onSubmit, onCancel });
  handlers.current = { onSubmit, onCancel };
  const [linkOpen, setLinkOpen] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  // The editor tidies Markdown as it loads (spacing, table padding). Compare against that tidied starting point
  // so a description that was not actually changed is handed back exactly as the user wrote it.
  const original = useRef(value);
  const baseline = useRef<string | null>(null);
  const toStored = (current: string) => (baseline.current !== null && current.trim() === baseline.current ? original.current : current);

  const editor = useEditor({
    extensions: [
      // Underline has no Markdown form, so it is left out rather than silently lost on save.
      StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Image,
      Placeholder.configure({ placeholder: 'Add details: notes, steps, links…' }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
    ],
    content: value,
    contentType: 'markdown',
    autofocus: mode === 'rich' ? 'end' : false,
    editorProps: {
      attributes: { class: 'md rich-desc-content', 'aria-label': 'Description' },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          handlers.current.onSubmit();
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          handlers.current.onCancel();
          return true;
        }
        if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          setLinkOpen(true);
          return true;
        }
        if (editorRef.current && handleTableShortcut(editorRef.current, event)) return true;
        return false;
      },
    },
    onCreate: ({ editor: e }) => {
      baseline.current = e.getMarkdown().trim();
    },
    onUpdate: ({ editor: e }) => {
      const next = toStored(e.isEmpty ? '' : e.getMarkdown());
      setMarkdown(next);
      onChange(next);
    },
  });

  editorRef.current = editor;

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e?.isActive('heading', { level: 1 }) ?? false,
      h2: e?.isActive('heading', { level: 2 }) ?? false,
      h3: e?.isActive('heading', { level: 3 }) ?? false,
      bullet: e?.isActive('bulletList') ?? false,
      ordered: e?.isActive('orderedList') ?? false,
      task: e?.isActive('taskList') ?? false,
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      strike: e?.isActive('strike') ?? false,
      link: e?.isActive('link') ?? false,
      code: e?.isActive('code') ?? false,
      codeBlock: e?.isActive('codeBlock') ?? false,
      quote: e?.isActive('blockquote') ?? false,
      table: e?.isActive('table') ?? false,
    }),
  });

  // The Markdown box grows with its text, like the rich editor.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [markdown, mode]);

  useEffect(() => {
    if (mode === 'markdown') textareaRef.current?.focus();
  }, [mode]);

  const switchMode = () => {
    if (!editor) return;
    if (mode === 'rich') {
      setMarkdown(toStored(editor.isEmpty ? '' : editor.getMarkdown()));
      setMode('markdown');
      saveMode('markdown');
    } else {
      editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
      setMode('rich');
      saveMode('rich');
      editor.commands.focus('end');
    }
  };

  const setText = (next: string) => {
    setMarkdown(next);
    onChange(next);
  };

  const run = (command: Command) => {
    if (mode === 'rich') {
      if (editor) runRich(editor, command);
      return;
    }
    const el = textareaRef.current;
    if (!el) return;
    const result = runMarkdown(markdown, el.selectionStart, el.selectionEnd, command);
    setText(result.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(result.start, result.end);
    });
  };

  const applyLink = (url: string) => {
    const href = url.trim();
    if (mode === 'rich') {
      if (!editor) return;
      const chain = editor.chain().focus().extendMarkRange('link');
      if (!href) {
        chain.unsetLink().run();
      } else if (editor.state.selection.empty && !editor.isActive('link')) {
        chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
      } else {
        chain.setLink({ href }).run();
      }
      return;
    }
    const el = textareaRef.current;
    if (!el || !href) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const label = markdown.slice(start, end) || href;
    const inserted = `[${label}](${href})`;
    setText(markdown.slice(0, start) + inserted + markdown.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + inserted.length, start + inserted.length);
    });
  };

  const rich = mode === 'rich';
  const on = (key: keyof NonNullable<typeof active>) => rich && (active?.[key] ?? false);
  const headingOn = on('h1') || on('h2') || on('h3');
  const listOn = on('bullet') || on('ordered') || on('task');

  const toolbar = (
    <div className="desc-toolbar" role="toolbar" aria-label="Formatting">
      <Menu
        label="Text style"
        icon={Heading}
        pressed={headingOn}
        items={[
          { label: 'Normal text', command: 'paragraph' },
          { label: 'Heading 1', command: 'h1', className: 'desc-menu-h1', active: on('h1') },
          { label: 'Heading 2', command: 'h2', className: 'desc-menu-h2', active: on('h2') },
          { label: 'Heading 3', command: 'h3', className: 'desc-menu-h3', active: on('h3') },
        ]}
        onRun={run}
      />
      <Menu
        label="Lists"
        icon={on('ordered') ? ListOrdered : on('task') ? ListChecks : List}
        pressed={listOn}
        items={[
          { label: 'Bulleted list', command: 'bullet', icon: List, active: on('bullet') },
          { label: 'Numbered list', command: 'ordered', icon: ListOrdered, active: on('ordered') },
          { label: 'Checklist', command: 'task', icon: ListChecks, active: on('task') },
        ]}
        onRun={run}
      />
      <ToolButton label="Bold (Ctrl+B)" icon={Bold} pressed={on('bold')} onClick={() => run('bold')} />
      <ToolButton label="Italic (Ctrl+I)" icon={Italic} pressed={on('italic')} onClick={() => run('italic')} />
      <ToolButton label="Strikethrough" icon={Strikethrough} pressed={on('strike')} onClick={() => run('strike')} />
      <LinkButton
        pressed={on('link')}
        open={linkOpen}
        onOpenChange={setLinkOpen}
        initialUrl={rich && editor ? ((editor.getAttributes('link').href as string | undefined) ?? '') : ''}
        onApply={applyLink}
      />
      <Menu
        label="More formatting"
        icon={Ellipsis}
        hideChevron
        pressed={on('code') || on('codeBlock') || on('quote')}
        items={[
          { label: 'Inline code', command: 'code', icon: Code, active: on('code') },
          { label: 'Code block', command: 'codeBlock', icon: SquareCode, active: on('codeBlock') },
          { label: 'Quote', command: 'quote', icon: Quote, active: on('quote') },
          { label: 'Divider', command: 'divider', icon: Minus },
          { label: 'Table', command: 'table', icon: Table },
        ]}
        onRun={run}
      />
      {on('table') && (
        <Menu
          label="Table"
          icon={Table}
          pressed
          items={[
            { label: 'Add row above', command: 'rowBefore', icon: ArrowUpToLine },
            { label: 'Add row below', command: 'rowAfter', icon: ArrowDownToLine },
            { label: 'Add column left', command: 'colBefore', icon: ArrowLeftToLine },
            { label: 'Add column right', command: 'colAfter', icon: ArrowRightToLine },
            { label: 'Delete row', command: 'deleteRow', icon: Rows3, className: 'is-danger' },
            { label: 'Delete column', command: 'deleteCol', icon: Columns3, className: 'is-danger' },
            { label: 'Delete table', command: 'deleteTable', icon: Trash2, className: 'is-danger' },
          ]}
          onRun={run}
        />
      )}
      <span className="desc-toolbar-sep" aria-hidden="true" />
      <button
        type="button"
        className={`desc-mode-btn ${rich ? '' : 'is-pressed'}`}
        aria-pressed={!rich}
        data-tooltip={rich ? 'Switch to Markdown (type the symbols yourself)' : 'Switch to rich text'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={switchMode}
      >
        M↓
      </button>
    </div>
  );

  return (
    <>
      {rich ? (
        <>
          <EditorContent editor={editor} className="rich-desc" />
          {editor && <TableControls editor={editor} />}
        </>
      ) : (
        <textarea
          ref={textareaRef}
          className="editor-description is-roomy is-markdown"
          placeholder="Markdown: **bold**, _italic_, - list, 1. list, - [ ] checklist, [link](https://…), `code`"
          value={markdown}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              onSubmit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            } else if (event.key.toLowerCase() === 'b' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              run('bold');
            } else if (event.key.toLowerCase() === 'i' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              run('italic');
            } else if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              setLinkOpen(true);
            }
          }}
          aria-label="Description (Markdown)"
        />
      )}
      {toolbarHost ? createPortal(toolbar, toolbarHost) : null}
    </>
  );
}

function ToolButton({ label, icon: Icon, pressed, onClick }: { label: string; icon: LucideIcon; pressed?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`desc-tool ${pressed ? 'is-pressed' : ''}`}
      data-tooltip={label}
      aria-label={label}
      aria-pressed={pressed}
      // Keep the caret and selection in the text while clicking the toolbar.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon size={15} />
    </button>
  );
}

interface MenuItem {
  label: string;
  command: Command;
  icon?: LucideIcon;
  active?: boolean;
  className?: string;
}

function Menu({
  label,
  icon: Icon,
  pressed,
  items,
  onRun,
  hideChevron,
}: {
  label: string;
  icon: LucideIcon;
  pressed?: boolean;
  items: MenuItem[];
  onRun: (command: Command) => void;
  hideChevron?: boolean;
}) {
  return (
    <Popover
      trigger={({ onClick, open }) => (
        <button
          type="button"
          className={`desc-tool desc-tool-menu ${pressed ? 'is-pressed' : ''}`}
          data-tooltip={label}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
        >
          <Icon size={15} />
          {!hideChevron && <ChevronDown size={12} />}
        </button>
      )}
    >
      {(close) => (
        <div className="desc-menu" role="menu" aria-label={label}>
          {items.map((item) => (
            <button
              key={item.command}
              type="button"
              role="menuitem"
              className={`desc-menu-item ${item.active ? 'is-active' : ''} ${item.className ?? ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onRun(item.command);
                close();
              }}
            >
              {item.icon && <item.icon size={14} />}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

/** Link button with a small URL box; also opened by Ctrl+K. */
function LinkButton({
  pressed,
  open,
  onOpenChange,
  initialUrl,
  onApply,
}: {
  pressed: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialUrl: string;
  onApply: (url: string) => void;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  return (
    <span ref={anchorRef} className="desc-link-anchor">
      <ToolButton label="Link (Ctrl+K)" icon={Link2} pressed={pressed} onClick={() => onOpenChange(!open)} />
      {open && (
        <LinkBox
          anchor={anchorRef.current}
          initialUrl={initialUrl}
          onClose={() => onOpenChange(false)}
          onApply={(url) => {
            onApply(url);
            onOpenChange(false);
          }}
        />
      )}
    </span>
  );
}

function LinkBox({
  anchor,
  initialUrl,
  onApply,
  onClose,
}: {
  anchor: HTMLElement | null;
  initialUrl: string;
  onApply: (url: string) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const boxRef = useRef<HTMLFormElement>(null);
  const rect = anchor?.getBoundingClientRect();

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!boxRef.current?.contains(target) && !anchor?.contains(target)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [anchor, onClose]);

  if (!rect) return null;
  const box: ReactNode = (
    <form
      ref={boxRef}
      className="desc-link-box"
      style={{ position: 'fixed', left: Math.max(8, rect.left - 120), top: rect.top - 52 }}
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onApply(url);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <input
        autoFocus
        type="url"
        placeholder="Paste a link, e.g. https://…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-label="Link address"
      />
      <button type="submit" className="btn btn-primary">
        {initialUrl && !url.trim() ? 'Remove' : 'Apply'}
      </button>
    </form>
  );
  return createPortal(box, document.body);
}
