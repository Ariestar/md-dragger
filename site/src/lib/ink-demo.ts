import { ink, plugin, pluginTypes, type Options } from 'ink-mde';
import { demoDraggerExtensions } from './editor-bootstrap';
import { hybridMarkdownInkPlugins } from './hybrid-markdown';

// Shared ink-mde host setup for the website demos.
//
// Explicit plugin list — do not rely on ink-mde blank defaults surviving a
// host plugins: [...] override (deep-assign replaces the array):
//   1. math grammar (host-owned)
//   2. dragger + hybrid widgets (CM extensions)
export type DemoEditorOptions = {
  doc: string;
  ink?: Options;
};

export function mountDemoEditor(
  target: HTMLElement,
  options: DemoEditorOptions,
): ReturnType<typeof ink> {
  const { plugins: _ignored, interface: interfaceOverride, ...rest } = options.ink ?? {};
  return ink(target, {
    doc: options.doc,
    plugins: [
      ...hybridMarkdownInkPlugins(),
      plugin({
        type: pluginTypes.default,
        value: () => demoDraggerExtensions(),
      }),
    ],
    interface: {
      appearance: 'dark',
      toolbar: true,
      attribution: false,
      images: true,
      lists: true,
      ...interfaceOverride,
    },
    lists: true,
    ...rest,
  });
}
