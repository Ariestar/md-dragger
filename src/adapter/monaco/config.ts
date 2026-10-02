import type { editor } from 'monaco-editor';
import type { Config, DefaultUxConfig, ResolvedConfig } from '../../runtime';

export const HANDLE_CLASS = 'md-dragger-handle';
export const DRAG_SOURCE_LINE_CLASS = 'md-dragger-drag-source';
export const DROP_SEAM_CLASS = 'md-dragger-drop-seam';
export const INVALID_CLASS = 'is-invalid';

export type ListIndentWidthPx = number | ((editor: editor.ICodeEditor) => number);

export type MdDraggerMonacoOptions = {
    /** Tab size and list indent unit (in characters/spaces). */
    config: Config;
    /** Rendered pixel width of one list indentation step. */
    listIndentWidthPx: ListIndentWidthPx;
    /** UX / gesture configuration. */
    ux?: DefaultUxConfig | ((editor: editor.ICodeEditor) => DefaultUxConfig);
    /** Enable/disable predicate. */
    enabled?: (editor: editor.ICodeEditor) => boolean;
};

export function resolveConfig(config: Config): ResolvedConfig {
    const raw = typeof config === 'function' ? config() : config;
    if (!(raw.tabSize > 0)) {
        throw new Error(`mdDraggerMonaco: config.tabSize must be positive, got ${String(raw.tabSize)}`);
    }
    if (!(raw.listIndentUnit > 0)) {
        throw new Error(`mdDraggerMonaco: config.listIndentUnit must be positive, got ${String(raw.listIndentUnit)}`);
    }
    return raw;
}

export function resolveListIndentUnit(options: Pick<MdDraggerMonacoOptions, 'config'>): number {
    return resolveConfig(options.config).listIndentUnit;
}

export function resolveListIndentWidthPx(
    options: Pick<MdDraggerMonacoOptions, 'listIndentWidthPx'>,
    editor: editor.ICodeEditor,
): number {
    const width =
        typeof options.listIndentWidthPx === 'function' ? options.listIndentWidthPx(editor) : options.listIndentWidthPx;
    if (!(width > 0)) {
        throw new Error(`mdDraggerMonaco: listIndentWidthPx must be positive, got ${String(width)}`);
    }
    return width;
}
