import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';

/** The languages whose texts the editor can colour. */
export type Syntax = 'json' | 'yaml' | 'xml' | 'html' | 'sql';

const green = 'color-mix(in srgb, var(--sc-action-support) 70%, var(--sc-text))';
const amber = 'color-mix(in srgb, var(--sc-action-changelog-hover) 75%, var(--sc-text))';

/**
 * The colours of a text that is code, made from the colours of the
 * program's theme (they are CSS variables, so they follow light, dark and
 * the gray themes by themselves): names (keys, tags, keywords) in the
 * accent, strings green, numbers and `true` / `false` amber, the names of
 * attributes and types amber too, comments, `null` and what only marks
 * (brackets of tags, instructions) muted.
 */
const colours = HighlightStyle.define([
  { tag: [tags.propertyName, tags.tagName, tags.keyword, tags.definition(tags.propertyName)], color: 'var(--sc-accent)' },
  { tag: [tags.string, tags.special(tags.string), tags.attributeValue], color: green },
  { tag: [tags.number, tags.bool, tags.attributeName, tags.typeName, tags.atom], color: amber },
  { tag: [tags.null, tags.comment, tags.meta, tags.angleBracket, tags.processingInstruction, tags.documentMeta], color: 'var(--sc-muted)' },
  { tag: tags.comment, fontStyle: 'italic' },
  { tag: tags.invalid, color: 'var(--sc-danger)' },
]);

/** What reads a text as code of a language. Only what is in view is read, so a long text costs no more than a short one. */
function language(syntax: Syntax): Extension {
  switch (syntax) {
    case 'json':
      return json();
    case 'yaml':
      return yaml();
    case 'xml':
      return xml();
    // What `<script>` and `<style>` hold is coloured too, as JavaScript and CSS.
    case 'html':
      return html({ autoCloseTags: false });
    case 'sql':
      return sql();
  }
}

/** What makes the editor read and colour a text as code of a language; nothing for a plain text. */
export function syntaxOf(syntax: Syntax | undefined): Extension {
  return syntax === undefined ? [] : [language(syntax), syntaxHighlighting(colours)];
}
