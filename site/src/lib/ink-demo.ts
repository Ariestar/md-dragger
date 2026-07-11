import { ink, plugin, pluginTypes, type Options } from 'ink-mde';
import { demoDraggerExtensions } from './editor-bootstrap';
import { tableAndRulePreview } from './table-hr-preview';

// Website editor mount.
//
// Math: ink-mde's katex plugins are gated on options.katex (default false).
// Table/HR: host-owned text-scan preview (table-hr-preview), registered as its
// own default plugin so it is not buried inside a nested Extension[] from
// the dragger bootstrap.
//
// plugins: [...] replaces the whole default array — mount with katex defaults
// first, then reconfigure to append host plugins.
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
        value: () => tableAndRulePreview(),
      }),
      plugin({
        type: pluginTypes.default,
        value: () => demoDraggerExtensions(),
      }),
    ],
  });
}
