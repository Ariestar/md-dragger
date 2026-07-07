import type { Config } from '../../runtime';

export const HANDLE_CLASS = 'md-dragger-cm-handle';
export const EDITOR_CLASS = 'md-dragger-cm-editor';
export const LIST_INTENT_THRESHOLD_PX = 24;

export type MdDraggerCodeMirrorOptions = {
  config?: Config;
};

export function resolveConfig(config: Config | undefined) {
  return typeof config === 'function' ? config() : config;
}

export function resolveTabSize(options: MdDraggerCodeMirrorOptions): number {
  return resolveConfig(options.config)?.tabSize ?? 4;
}
