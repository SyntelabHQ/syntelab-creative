import type { MarkTool } from './mark-layer';

/** Which words explain the pen in hand (said on the line under the bar of its tool). */
export function penHintKey(tool: MarkTool): string {
  if (tool === 'select') return 'pdf-organizer.marks.hint.select';
  if (tool === 'link') return 'pdf-organizer.marks.hint.link';
  if (tool === 'bookmark') return 'pdf-organizer.marks.hint.bookmark';
  if (tool === 'radioButton') return 'pdf-organizer.marks.hint.radio';
  if (tool === 'textField' || tool === 'checkBox' || tool === 'signatureField' || tool === 'choiceField') return 'pdf-organizer.marks.hint.field';
  if (tool === 'edit') return 'pdf-organizer.marks.editNote';
  if (tool === 'text') return 'pdf-organizer.marks.hint.text';
  if (tool === 'redact') return 'pdf-organizer.marks.redactNote';
  return 'pdf-organizer.marks.hint.draw';
}
