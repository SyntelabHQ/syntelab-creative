/**
 * The tools of Dev, each said once: the menus, the first page and the search
 * are made from this list. A tool is added here and gets a folder of its own
 * under `tools/` when it is built.
 */

/** The menus the tools are listed under, in the order they are shown. */
export const GROUPS = ['encode', 'data', 'generate', 'inspect', 'network'] as const;
export type ToolGroup = (typeof GROUPS)[number];

export interface Tool {
  /** Its name in the code, in the translations (`dev.tool.<id>`) and in the pins. */
  readonly id: string;
  readonly group: ToolGroup;
  /** Name of a file in `assets/icons/`, without the extension. A tool the model has is drawn with the model's icon. */
  readonly icon: string;
  /** Put off to a later version: shown in its place, and cannot be opened. */
  readonly later?: boolean;
}

const tool = (group: ToolGroup, id: string, icon: string, later = false): Tool => (later ? { id, group, icon, later } : { id, group, icon });

export const TOOLS: readonly Tool[] = [
  tool('encode', 'base64', 'file-code'),
  tool('encode', 'url-encode', 'link'),
  tool('encode', 'html-entities', 'paragraph'),
  tool('encode', 'jwt', 'key'),
  tool('encode', 'escape', 'quote-right'),
  tool('encode', 'gzip', 'file-zipper'),
  tool('encode', 'number-base', 'superscript'),

  tool('data', 'json-formatter', 'code'),
  tool('data', 'jsonpath', 'route'),
  tool('data', 'json-schema', 'list-check'),
  tool('data', 'json-schema-generator', 'wand-magic-sparkles'),
  tool('data', 'json-to-typescript', 'file-code'),
  tool('data', 'yaml-json', 'file-lines'),
  tool('data', 'csv-json', 'table'),
  tool('data', 'markup', 'window-maximize'),
  tool('data', 'sql', 'indent'),
  tool('data', 'diff', 'code-branch'),
  tool('data', 'markdown', 'eye'),
  tool('data', 'minify', 'paintbrush', true),

  tool('generate', 'uuid', 'tags'),
  tool('generate', 'hash', 'hashtag'),
  tool('generate', 'secrets', 'shield-halved'),
  tool('generate', 'keys', 'fingerprint'),

  tool('inspect', 'regex', 'asterisk'),
  tool('inspect', 'cron', 'clock'),
  tool('inspect', 'timestamp', 'calendar-days'),
  tool('inspect', 'url-parser', 'diagram-project'),
  tool('inspect', 'certificate', 'certificate'),
  tool('inspect', 'hex', 'microchip'),

  tool('network', 'http', 'globe'),
  tool('network', 'dns', 'server'),
  tool('network', 'port', 'plug'),
  tool('network', 'site-certificate', 'lock'),
];

export const toolById = (id: string): Tool | undefined => TOOLS.find((known) => known.id === id);
