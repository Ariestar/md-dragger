import { ink, plugin, pluginTypes, type Options } from 'ink-mde';
import { demoDraggerExtensions } from './editor-bootstrap';

// Website editor mount.
//
// Root cause of missing math: ink-mde ships katex() in its default plugins, but
// filterPlugins only loads plugins whose `key` is truthy on options. The default
// is katex: false, so math never activates. Setting katex: true is enough.
//
// Root cause of wiping math: passing plugins: [dragger] replaces the whole
// default array (deep-assign replaces arrays). Mount with defaults first, then
// reconfigure to append the dragger extension.
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
  await instance.reconfigure({
    katex: true,
    plugins: [
      ...current.plugins,
      plugin({
        type: pluginTypes.default,
        value: () => demoDraggerExtensions(),
      }),
    ],
  });
}
