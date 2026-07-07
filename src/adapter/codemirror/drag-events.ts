import { StateEffect } from '@codemirror/state';
import type { Transition } from '../../runtime';

// Broadcast channel between the runtime plugin and any visual plugin
// (drop indicator, selection highlight, ...) that wants to derive from
// the pipeline output stream. dragRuntime dispatches one effect per
// transition; visual plugins read them off update.transactions.
export const dragTransitionEffect = StateEffect.define<Transition>();
