import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import {
  CellSelection,
  deleteCellSelection,
  isInTable,
  moveTableColumn,
  moveTableRow,
  selectedRect,
  type TableRect,
} from '@tiptap/pm/tables';
import { useEditorState, type Editor } from '@tiptap/react';
import {
  ArrowDownNarrowWide,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpNarrowWide,
  ArrowUpToLine,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Eraser,
  GripHorizontal,
  GripVertical,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';

/**
 * Notion-style handles for the table under the cursor: a grip above the current column and one left of the
 * current row, each opening a menu (add, move, sort, clear, delete). Markdown tables always have exactly one
 * header row, so the header row can be added below but not moved, deleted or sorted into the body.
 */

type Axis = 'column' | 'row';

interface Target {
  axis: Axis;
  index: number;
}

interface Action {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => boolean;
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';
const ALT = isMac ? '⌥' : 'Alt';

function rectOrNull(state: EditorState): TableRect | null {
  if (!isInTable(state)) return null;
  try {
    return selectedRect(state);
  } catch {
    return null;
  }
}

/** Position (in the document) of the cell at row/col of the table the selection is in. */
function cellPos(rect: TableRect, row: number, col: number): number {
  return rect.tableStart + rect.map.positionAt(row, col, rect.table);
}

function dispatchOn(editor: Editor) {
  return (tr: Transaction) => editor.view.dispatch(tr);
}

function selectAxis(editor: Editor, axis: Axis, index: number) {
  const rect = rectOrNull(editor.state);
  if (!rect) return;
  const pos = axis === 'column' ? cellPos(rect, 0, index) : cellPos(rect, index, 0);
  const $cell = editor.state.doc.resolve(pos);
  const selection = axis === 'column' ? CellSelection.colSelection($cell) : CellSelection.rowSelection($cell);
  editor.view.dispatch(editor.state.tr.setSelection(selection));
}

/** Put the caret in the given cell (used before add/delete commands, which act on the selection). */
function caretInCell(editor: Editor, row: number, col: number) {
  const rect = rectOrNull(editor.state);
  if (!rect) return;
  const pos = cellPos(rect, row, col);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos + 1))));
}

const numericValue = (text: string): number | null => {
  const cleaned = text.replace(/[\s,$€£¥%]/g, '');
  if (cleaned === '' || !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(cleaned)) return null;
  return Number(cleaned);
};

/** Sort the body rows (never the header) by one column; numbers sort as numbers, empty cells last. */
function sortByColumn(editor: Editor, col: number, direction: 1 | -1): boolean {
  const rect = rectOrNull(editor.state);
  if (!rect) return false;
  const table = rect.table;
  const rows: PMNode[] = [];
  table.forEach((row) => rows.push(row));
  if (rows.length < 3) return true;
  const [header, ...body] = rows;
  const keyOf = (row: PMNode) => (col < row.childCount ? row.child(col).textContent.trim() : '');
  const allNumeric = body.every((row) => keyOf(row) === '' || numericValue(keyOf(row)) !== null);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const sorted = [...body].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka === '' || kb === '') return ka === kb ? 0 : ka === '' ? 1 : -1;
    const diff = allNumeric ? numericValue(ka)! - numericValue(kb)! : collator.compare(ka, kb);
    return diff * direction;
  });
  const next = table.type.create(table.attrs, [header, ...sorted]);
  const tablePos = rect.tableStart - 1;
  const tr = editor.state.tr.replaceWith(tablePos, tablePos + table.nodeSize, next);
  const newRect = { ...rect, table: next };
  const $cell = tr.doc.resolve(rect.tableStart + newRect.map.positionAt(0, col, next));
  tr.setSelection(CellSelection.colSelection($cell));
  editor.view.dispatch(tr);
  return true;
}

function columnActions(editor: Editor, col: number, width: number): Action[] {
  const d = dispatchOn(editor);
  const run = (fn: () => boolean) => () => {
    const ok = fn();
    editor.commands.focus();
    return ok;
  };
  return [
    { id: 'sort-asc', label: t('Sort increasing'), icon: ArrowUpNarrowWide, run: run(() => sortByColumn(editor, col, 1)) },
    { id: 'sort-desc', label: t('Sort decreasing'), icon: ArrowDownNarrowWide, run: run(() => sortByColumn(editor, col, -1)) },
    {
      id: 'add-left',
      label: t('Add column left'),
      icon: ArrowLeftToLine,
      shortcut: `${MOD}+${ALT}+←`,
      run: run(() => (caretInCell(editor, 0, col), editor.chain().addColumnBefore().run())),
    },
    {
      id: 'add-right',
      label: t('Add column right'),
      icon: ArrowRightToLine,
      shortcut: `${MOD}+${ALT}+→`,
      run: run(() => (caretInCell(editor, 0, col), editor.chain().addColumnAfter().run())),
    },
    {
      id: 'move-left',
      label: t('Move column left'),
      icon: ChevronLeft,
      shortcut: `${MOD}+${ALT}+Shift+←`,
      disabled: col === 0,
      run: run(() => moveTableColumn({ from: col, to: col - 1, select: true })(editor.state, d)),
    },
    {
      id: 'move-right',
      label: t('Move column right'),
      icon: ChevronRight,
      shortcut: `${MOD}+${ALT}+Shift+→`,
      disabled: col >= width - 1,
      run: run(() => moveTableColumn({ from: col, to: col + 1, select: true })(editor.state, d)),
    },
    {
      id: 'clear',
      label: t('Clear cells'),
      icon: Eraser,
      run: run(() => (selectAxis(editor, 'column', col), deleteCellSelection(editor.state, d))),
    },
    {
      id: 'delete',
      label: width === 1 ? 'Delete table' : 'Delete column',
      icon: Trash2,
      danger: true,
      run: run(() =>
        width === 1
          ? editor.chain().deleteTable().run()
          : (caretInCell(editor, 0, col), editor.chain().deleteColumn().run()),
      ),
    },
  ];
}

function rowActions(editor: Editor, row: number, height: number): Action[] {
  const d = dispatchOn(editor);
  const run = (fn: () => boolean) => () => {
    const ok = fn();
    editor.commands.focus();
    return ok;
  };
  const isHeader = row === 0;
  return [
    {
      id: 'add-above',
      label: t('Add row above'),
      icon: ArrowUpToLine,
      shortcut: `${MOD}+${ALT}+↑`,
      disabled: isHeader,
      run: run(() => (caretInCell(editor, row, 0), editor.chain().addRowBefore().run())),
    },
    {
      id: 'add-below',
      label: t('Add row below'),
      icon: ArrowDownToLine,
      shortcut: `${MOD}+${ALT}+↓`,
      run: run(() => (caretInCell(editor, row, 0), editor.chain().addRowAfter().run())),
    },
    {
      id: 'move-up',
      label: t('Move row up'),
      icon: ChevronUp,
      shortcut: `${MOD}+${ALT}+Shift+↑`,
      disabled: row <= 1,
      run: run(() => moveTableRow({ from: row, to: row - 1, select: true })(editor.state, d)),
    },
    {
      id: 'move-down',
      label: t('Move row down'),
      icon: ChevronDown,
      shortcut: `${MOD}+${ALT}+Shift+↓`,
      disabled: isHeader || row >= height - 1,
      run: run(() => moveTableRow({ from: row, to: row + 1, select: true })(editor.state, d)),
    },
    {
      id: 'clear',
      label: t('Clear cells'),
      icon: Eraser,
      run: run(() => (selectAxis(editor, 'row', row), deleteCellSelection(editor.state, d))),
    },
    {
      id: 'delete',
      label: isHeader ? 'Delete table' : 'Delete row',
      icon: Trash2,
      danger: true,
      run: run(() =>
        isHeader ? editor.chain().deleteTable().run() : (caretInCell(editor, row, 0), editor.chain().deleteRow().run()),
      ),
    },
  ];
}

/**
 * Keyboard shortcuts while the caret is in a table: Mod+Alt+Arrow adds a column or row on that side,
 * Mod+Alt+Shift+Arrow moves the current column or row. Returns true when the key was handled.
 */
export function handleTableShortcut(editor: Editor, event: KeyboardEvent): boolean {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (!mod || !event.altKey || !event.key.startsWith('Arrow')) return false;
  const rect = rectOrNull(editor.state);
  if (!rect) return false;
  const col = rect.left;
  const row = rect.top;
  const d = dispatchOn(editor);
  let handled = false;
  if (event.shiftKey) {
    if (event.key === 'ArrowLeft' && col > 0) handled = moveTableColumn({ from: col, to: col - 1, select: false, pos: editor.state.selection.from })(editor.state, d);
    if (event.key === 'ArrowRight' && col < rect.map.width - 1) handled = moveTableColumn({ from: col, to: col + 1, select: false, pos: editor.state.selection.from })(editor.state, d);
    if (event.key === 'ArrowUp' && row > 1) handled = moveTableRow({ from: row, to: row - 1, select: false, pos: editor.state.selection.from })(editor.state, d);
    if (event.key === 'ArrowDown' && row >= 1 && row < rect.map.height - 1) handled = moveTableRow({ from: row, to: row + 1, select: false, pos: editor.state.selection.from })(editor.state, d);
  } else {
    if (event.key === 'ArrowLeft') handled = editor.chain().addColumnBefore().run();
    if (event.key === 'ArrowRight') handled = editor.chain().addColumnAfter().run();
    if (event.key === 'ArrowUp' && row > 0) handled = editor.chain().addRowBefore().run();
    if (event.key === 'ArrowDown') handled = editor.chain().addRowAfter().run();
  }
  if (handled || event.key.startsWith('Arrow')) event.preventDefault();
  return true;
}

interface GripPlace {
  column: { left: number; top: number; width: number } | null;
  row: { left: number; top: number; height: number } | null;
}

/** Menu below the column grip or beside the row grip, kept inside the window (it scrolls if the window is short). */
function menuStyle(menu: Target, place: GripPlace): React.CSSProperties | undefined {
  const width = 280;
  const margin = 8;
  const anchor =
    menu.axis === 'column' && place.column
      ? { left: place.column.left + place.column.width / 2 - 14, top: place.column.top + 14 }
      : place.row
        ? { left: place.row.left + 14, top: place.row.top }
        : null;
  if (!anchor) return undefined;
  const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin));
  const top = Math.max(margin, Math.min(anchor.top, window.innerHeight - 200));
  return { left, top, maxHeight: window.innerHeight - top - margin, overflowY: 'auto' };
}

export function TableControls({ editor }: { editor: Editor }) {
  const current = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const rect = e ? rectOrNull(e.state) : null;
      if (!rect) return null;
      // Primitive values only: the hook compares results deeply on every transaction.
      return { col: rect.left, row: rect.top, width: rect.map.width, height: rect.map.height, tableStart: rect.tableStart, size: e!.state.doc.content.size };
    },
  });
  const [menu, setMenu] = useState<Target | null>(null);
  const [place, setPlace] = useState<GripPlace>({ column: null, row: null });
  const [tick, setTick] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  // Keep the grips on the current column and row through scrolling and resizing.
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener('scroll', bump, true);
    window.addEventListener('resize', bump);
    return () => {
      window.removeEventListener('scroll', bump, true);
      window.removeEventListener('resize', bump);
    };
  }, []);

  useLayoutEffect(() => {
    if (!current) {
      setPlace({ column: null, row: null });
      return;
    }
    const rect = rectOrNull(editor.state);
    if (!rect) return;
    const top = editor.view.nodeDOM(cellPos(rect, 0, current.col)) as HTMLElement | null;
    const first = editor.view.nodeDOM(cellPos(rect, current.row, 0)) as HTMLElement | null;
    const bounds = editor.view.dom.getBoundingClientRect();
    const visible = (r: DOMRect) => (r.bottom > bounds.top && r.top < bounds.bottom && r.right > bounds.left && r.left < bounds.right);
    const colRect = top?.getBoundingClientRect();
    const rowRect = first?.getBoundingClientRect();
    setPlace({
      column: colRect && visible(colRect) && colRect.top >= bounds.top - 2 ? { left: colRect.left, top: colRect.top, width: colRect.width } : null,
      row: rowRect && visible(rowRect) ? { left: rowRect.left, top: rowRect.top, height: rowRect.height } : null,
    });
  }, [current, tick, editor]);

  // Close the menu on outside click or Escape, and when the caret leaves the table.
  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element;
      // A click on a grip toggles the menu itself; closing here would reopen it on the click that follows.
      if (!menuRef.current?.contains(target) && !target.closest?.('.table-grip')) setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setMenu(null);
        editor.commands.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [menu, editor]);

  useEffect(() => {
    if (!current) setMenu(null);
  }, [current]);

  if (!current) return null;

  const open = (target: Target) => {
    selectAxis(editor, target.axis, target.index);
    setMenu(target);
  };

  const actions = menu
    ? menu.axis === 'column'
      ? columnActions(editor, menu.index, current.width)
      : rowActions(editor, menu.index, current.height)
    : [];

  const grips = (
    <>
      {place.column && menu?.axis !== 'row' && (
        <button
          type="button"
          className={`table-grip table-grip-col ${menu?.axis === 'column' ? 'is-open' : ''}`}
          style={{ left: place.column.left + place.column.width / 2 - 14, top: place.column.top - 9 }}
          data-tooltip={t('Column options')}
          aria-label={`Column ${current.col + 1} options`}
          aria-haspopup="menu"
          aria-expanded={menu?.axis === 'column'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (menu?.axis === 'column' ? setMenu(null) : open({ axis: 'column', index: current.col }))}
        >
          <GripHorizontal size={14} />
        </button>
      )}
      {place.row && menu?.axis !== 'column' && (
        <button
          type="button"
          className={`table-grip table-grip-row ${menu?.axis === 'row' ? 'is-open' : ''}`}
          style={{ left: place.row.left - 9, top: place.row.top + place.row.height / 2 - 14 }}
          data-tooltip={t('Row options')}
          aria-label={`Row ${current.row + 1} options`}
          aria-haspopup="menu"
          aria-expanded={menu?.axis === 'row'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (menu?.axis === 'row' ? setMenu(null) : open({ axis: 'row', index: current.row }))}
        >
          <GripVertical size={14} />
        </button>
      )}
      {menu && (place.column || place.row) && (
        <div
          ref={menuRef}
          className="table-menu"
          role="menu"
          aria-label={menu.axis === 'column' ? 'Column options' : 'Row options'}
          style={menuStyle(menu, place)}
        >
          {actions.map((action, i) => {
            const groupStart = i > 0 && (action.danger || action.id === 'clear' || action.id === 'add-left' || action.id === 'move-left' || action.id === 'move-up');
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className={`table-menu-item ${action.danger ? 'is-danger' : ''} ${groupStart ? 'has-divider' : ''}`}
                disabled={action.disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setMenu(null);
                  action.run();
                }}
              >
                <action.icon size={14} />
                <span className="table-menu-label">{action.label}</span>
                {action.shortcut && <kbd>{action.shortcut}</kbd>}
              </button>
            );
          })}
        </div>
      )}
    </>
  );

  return createPortal(grips, document.body);
}
