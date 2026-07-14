import { EditorView } from '@codemirror/view';
import {
  BlockType,
  detectBlock,
  planConvert,
  planDelete,
  selectOne,
  type ConvertTo,
} from 'md-dragger/domain';

export type ConvertOption = {
  to: ConvertTo;
  label: string;
};

export const CONVERT_OPTIONS: ConvertOption[] = [
  { to: { type: BlockType.Paragraph }, label: 'Paragraph' },
  { to: { type: BlockType.Heading, level: 1 }, label: 'Heading 1' },
  { to: { type: BlockType.Heading, level: 2 }, label: 'Heading 2' },
  { to: { type: BlockType.Heading, level: 3 }, label: 'Heading 3' },
  { to: { type: BlockType.ListItem, markerType: 'unordered' }, label: 'Bullet list' },
  { to: { type: BlockType.ListItem, markerType: 'ordered' }, label: 'Numbered list' },
  { to: { type: BlockType.ListItem, markerType: 'task' }, label: 'Task list' },
  { to: { type: BlockType.Blockquote }, label: 'Quote' },
  { to: { type: BlockType.CodeBlock }, label: 'Code block' },
  { to: { type: BlockType.MathBlock }, label: 'Math block' },
];

const TAB_SIZE = 4;

export function convertBlockAt(
  view: EditorView,
  lineNumber: number,
  to: ConvertTo,
): boolean {
  const block = detectBlock(view.state.doc, lineNumber, { tabSize: TAB_SIZE });
  if (!block) return false;
  const changes = planConvert({ doc: view.state.doc, block, to });
  if (changes.length === 0) return false;
  view.dispatch({ changes, scrollIntoView: false });
  return true;
}

export function deleteBlockAt(view: EditorView, lineNumber: number): boolean {
  const block = detectBlock(view.state.doc, lineNumber, { tabSize: TAB_SIZE });
  if (!block) return false;
  const result = planDelete({
    doc: view.state.doc,
    selection: selectOne(block),
  });
  if ('type' in result) return false; // CommandReject
  if (!result.changes.length) return false;
  view.dispatch({ changes: result.changes, scrollIntoView: false });
  return true;
}
