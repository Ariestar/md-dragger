import { ink, plugin, pluginTypes, type Options } from 'ink-mde';
import type { Extension } from '@codemirror/state';
import { demoDraggerExtensions } from './editor-bootstrap';

// Website editor mount.
//
// katex: true turns on ink-mde's built-in math plugins (gated by options.katex).
// Passing plugins: [...] replaces the default array, so we mount with defaults
// first, then reconfigure to append our extensions as individual default
// plugins (one Extension each). A single plugin value that returns Extension[]
// can fail to install under ink-mde's compartment wiring — which made handles
// disappear while katex (separate plugins) still worked.
export type DemoEditorOptions = {
  doc: string;
  ink?: Options;
};

export async function mountDemoEditor(
  target: HTMLElement,
  options: DemoEditorOptions,
): Promise<void> {
  const { plugins: _drop, interface: iface, ...rest } = options.ink ?? {};

  const instance = await ink(target, {
    doc: options.doc,
    katex: true,
    lists: true,
    interface: {
      appearance: 'dark',
      toolbar: true,
      attribution: false,
      images: true,
      lists: true,
      ...iface,
    },
    ...rest,
  });

  const current = instance.options();
  const hostExtensions = flattenExtensions(demoDraggerExtensions());

  await instance.reconfigure({
    katex: true,
    plugins: [
      ...current.plugins,
      ...hostExtensions.map((extension) =>
        plugin({
          type: pluginTypes.default,
          value: () => extension,
        }),
      ),
    ],
  });
}

function flattenExtensions(extension: Extension): Extension[] {
  if (Array.isArray(extension)) {
    return extension.flatMap((item) => flattenExtensions(item as Extension));
  }
  return [extension];
}
