import { ink, plugin, pluginTypes, type Options } from 'ink-mde';
import { demoDraggerExtensions } from './editor-bootstrap';

// Shared ink-mde host setup for the website demos.
//
// Critical: ink-mde deep-assigns options and *replaces* the plugins array when
// one is provided. The blank default includes katex() (math grammar + widgets).
// Passing only our dragger plugin used to wipe katex, so $$ blocks stopped
// rendering. We mount without plugins first, then reconfigure to *append*
// our extension on top of the defaults.
export type DemoEditorOptions = {
  doc: string;
  /** Extra ink-mde options merged on top of the demo defaults. */
  ink?: Options;
};

export async function mountDemoEditor(
  target: HTMLElement,
  options: DemoEditorOptions,
): Promise<void> {
  const instance = await ink(target, {
    doc: options.doc,
    // Keep default plugins (katex). Do NOT pass plugins here.
    interface: {
      appearance: 'dark',
      toolbar: true,
      attribution: false,
      // Hybrid image previews + list markers.
      images: true,
      lists: true,
      ...(options.ink?.interface ?? {}),
    },
    lists: true,
    ...stripPlugins(options.ink),
  });

  const current = instance.options();
  await instance.reconfigure({
    plugins: [
      // Preserve whatever the blank default installed (katex grammar + widgets).
      ...current.plugins,
      plugin({
        type: pluginTypes.default,
        value: () => demoDraggerExtensions(),
      }),
    ],
  });
}

function stripPlugins(options: Options | undefined): Options {
  if (!options) return {};
  const { plugins: _ignored, ...rest } = options;
  return rest;
}
