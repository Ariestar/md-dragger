import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HANDLE_CLASS } from 'md-dragger/adapter/codemirror';
import { CONVERT_OPTIONS, convertBlockAt, deleteBlockAt } from './block-actions';

// Host-only: click handle → block type menu. Uses domain planConvert / planDelete.

const MENU_CLASS = 'md-block-menu';
const MENU_ITEM_CLASS = 'md-block-menu-item';
const MENU_SEP_CLASS = 'md-block-menu-sep';
const MENU_DANGER_CLASS = 'md-block-menu-item-danger';

let openMenu: HTMLElement | null = null;
let openView: EditorView | null = null;
let openLine = 0;

function closeMenu(): void {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
  openView = null;
  openLine = 0;
  window.removeEventListener('pointerdown', onOutside, true);
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', closeMenu, true);
  window.removeEventListener('scroll', closeMenu, true);
}

function onOutside(event: Event): void {
  const t = event.target;
  if (!(t instanceof Node)) return;
  if (openMenu?.contains(t)) return;
  if (t instanceof Element && t.closest(`.${HANDLE_CLASS}`)) return;
  closeMenu();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeMenu();
}

function lineFromHandle(view: EditorView, handle: Element): number | null {
  const gutterEl = handle.closest('.cm-gutterElement');
  if (!(gutterEl instanceof HTMLElement)) return null;
  const rect = gutterEl.getBoundingClientRect();
  const y = rect.top + rect.height / 2;
  const contentRect = view.contentDOM.getBoundingClientRect();
  const x = Math.min(contentRect.right - 2, Math.max(contentRect.left + 2, contentRect.left + 8));
  const pos = view.posAtCoords({ x, y }, false);
  if (typeof pos !== 'number') return null;
  return view.state.doc.lineAt(pos).number;
}

function addItem(
  menu: HTMLElement,
  label: string,
  onPick: () => void,
  className = MENU_ITEM_CLASS,
): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const view = openView;
    closeMenu();
    if (view) onPick();
  });
  menu.appendChild(btn);
}

function openAt(view: EditorView, handle: HTMLElement, lineNumber: number): void {
  closeMenu();

  const menu = document.createElement('div');
  menu.className = MENU_CLASS;
  menu.setAttribute('role', 'menu');

  for (const option of CONVERT_OPTIONS) {
    addItem(menu, option.label, () => {
      convertBlockAt(view, lineNumber, option.to);
    });
  }

  const sep = document.createElement('div');
  sep.className = MENU_SEP_CLASS;
  menu.appendChild(sep);

  addItem(menu, 'Delete block', () => {
    deleteBlockAt(view, lineNumber);
  }, `${MENU_ITEM_CLASS} ${MENU_DANGER_CLASS}`);

  document.body.appendChild(menu);
  openMenu = menu;
  openView = view;
  openLine = lineNumber;

  const rect = handle.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = rect.right + 6;
  let top = rect.top;
  if (left + mw > window.innerWidth - 8) left = Math.max(8, rect.left - mw - 6);
  if (top + mh > window.innerHeight - 8) top = Math.max(8, window.innerHeight - mh - 8);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;

  window.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeMenu, true);
  window.addEventListener('scroll', closeMenu, true);
}

/**
 * Click on drag handle opens convert menu.
 * Drag still owns press_cancelled via DefaultUx; this is a separate click path.
 */
export function handleBlockMenu(): Extension {
  return EditorView.domEventHandlers({
    click(event, view) {
      const target = event.target;
      if (!(target instanceof Element)) return false;
      const handle = target.closest(`.${HANDLE_CLASS}`);
      if (!handle || !(handle instanceof HTMLElement)) return false;
      if (!view.dom.contains(handle)) return false;

      // Ignore if this was the end of a drag (pointer moved a lot) — optional:
      // simple click only.
      event.preventDefault();
      event.stopPropagation();

      const line = lineFromHandle(view, handle);
      if (line === null) return true;

      if (openMenu && openView === view && openLine === line) {
        closeMenu();
        return true;
      }
      openAt(view, handle, line);
      return true;
    },
  });
}
