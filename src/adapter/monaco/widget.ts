import type { editor } from 'monaco-editor';
import type { DropPosition, LineRange } from '../../domain';
import { DRAG_SOURCE_LINE_CLASS, DROP_SEAM_CLASS, INVALID_CLASS, type MdDraggerMonacoOptions } from './config';
import { type DropSeam, dropSeam } from './geometry';

/**
 * Monaco IOverlayWidget for rendering the pixel-accurate horizontal drop seam.
 */
export class DropSeamWidget implements editor.IOverlayWidget {
    public static readonly ID = 'md-dragger.drop-seam-widget';
    private readonly domNode: HTMLElement;

    constructor(ownerDoc: Document) {
        this.domNode = ownerDoc.createElement('div');
        this.domNode.className = DROP_SEAM_CLASS;
        this.domNode.style.display = 'none';
        this.domNode.style.position = 'absolute';
        this.domNode.style.height = '2px';
        this.domNode.style.borderRadius = '2px';
        this.domNode.style.pointerEvents = 'none';
        this.domNode.style.zIndex = '1000';
    }

    getId(): string {
        return DropSeamWidget.ID;
    }

    getDomNode(): HTMLElement {
        return this.domNode;
    }

    getPosition(): editor.IOverlayWidgetPosition | null {
        return null;
    }

    update(
        editor: editor.ICodeEditor,
        position: DropPosition | null,
        invalid: boolean,
        options: MdDraggerMonacoOptions,
    ): void {
        if (!position) {
            this.domNode.style.display = 'none';
            return;
        }

        const domNode = editor.getDomNode();
        const seam: DropSeam | null = dropSeam(editor, position, options);
        if (!seam || !domNode) {
            this.domNode.style.display = 'none';
            return;
        }

        this.domNode.style.display = 'block';
        // Monaco mounts overlays in an editor-relative container.
        const rect = domNode.getBoundingClientRect();
        this.domNode.style.left = `${seam.left - rect.left}px`;
        this.domNode.style.top = `${seam.y - rect.top}px`;
        this.domNode.style.width = `${Math.max(10, seam.right - seam.left)}px`;

        if (invalid) {
            this.domNode.classList.add(INVALID_CLASS);
        } else {
            this.domNode.classList.remove(INVALID_CLASS);
        }
    }
}

/**
 * Manages source block highlight decorations in Monaco Editor.
 */
export class DragHighlightManager {
    private readonly decorations: editor.IEditorDecorationsCollection;

    constructor(codeEditor: editor.ICodeEditor) {
        this.decorations = codeEditor.createDecorationsCollection();
    }

    update(ranges: LineRange[]): void {
        this.decorations.set(
            ranges.map(({ startLine, endLine }) => ({
                range: {
                    startLineNumber: startLine,
                    startColumn: 1,
                    endLineNumber: endLine,
                    endColumn: 1,
                },
                options: {
                    isWholeLine: true,
                    className: DRAG_SOURCE_LINE_CLASS,
                },
            })),
        );
    }

    clear(): void {
        this.decorations.clear();
    }
}
