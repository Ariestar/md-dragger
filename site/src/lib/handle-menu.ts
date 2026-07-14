import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { HANDLE_CLASS } from 'md-dragger/adapter/codemirror';
import { CONVERT_OPTIONS, convertBlockAt, deleteBlockAt } from './block-actions';

// Host-only: click handle → block type menu.
//
// Root cause of "no menu": DefaultUx setPointerCapture(view.dom) on press, so
// pointerup is retargeted to view.dom — event.target is no longer the handle.
// We must remember the handle from pointerdown.

const MENU_CLASS = 'md-block-menu';
const MENU_ITEM_CLASS = 'md-block-menu-item';
const MENU_SEP_CLASS = 'md-block-menu-sep';
const MENU_DANGER_CLASS = 'md-block-menu-item-danger';
const CLICK_SLOP_PX = 6;

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
    closeMenu();
    onPick();
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

export function handleBlockMenu(): Extension {
  return ViewPlugin.fromClass(class {
    private press: {
      x: number;
      y: number;
      id: number;
      handle: HTMLElement;
    } | null = null;

    private readonly onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const handle = handleFromTarget(event.target);
      if (!handle || !this.view.dom.contains(handle)) {
        this.press = null;
        return;
      }
      // Remember handle here: after setPointerCapture(view.dom), pointerup.target is view.dom.
      this.press = {
        x: event.clientX,
        y: event.clientY,
        id: event.pointerId,
        handle,
      };
    };

    private readonly onPointerUp = (event: PointerEvent) => {
      const start = this.press;
      this.press = null;
      if (!start || start.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PX) return;
      if (!this.view.dom.contains(start.handle)) return;

      event.preventDefault();
      event.stopPropagation();

      const line = lineFromHandle(this.view, start.handle);
      if (line === null) return;

      if (openMenu && openView === this.view && openLine === line) {
        closeMenu();
        return;
      }
      openAt(this.view, start.handle, line);
    };

    constructor(private readonly view: EditorView) {
      view.dom.addEventListener('pointerdown', this.onPointerDown, true);
      // window capture: still fires after setPointerCapture retargets to view.dom
      window.addEventListener('pointerup', this.onPointerUp, true);
    }

    destroy(): void {
      this.view.dom.removeEventListener('pointerdown', this.onPointerDown, true);
      window.removeEventListener('pointerup', this.onPointerUp, true);
      if (openView === this.view) closeMenu();
    }
  });
}

function handleFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const handle = target.closest(`.${HANDLE_CLASS}`);
  return handle instanceof HTMLElement ? handle : null;
}
