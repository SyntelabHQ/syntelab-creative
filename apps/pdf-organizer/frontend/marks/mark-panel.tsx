import { useTranslation } from '@syntelab/i18n';
import { Button, Icon, IconButton, tooltip } from '@syntelab/ui-kit';
import { useState } from 'react';
import type { ReactNode } from 'react';
import panelStyles from '../crop/crop-panel.module.css';
import type { PageRange } from '../document/page-range';
import shapeStyles from '../organize/shape-dialog.module.css';
import { FontSelect } from './font-select';
import { HIGHLIGHT_COLOR, isAddition, isField, MARK_KINDS, TEXT_ALIGNS } from './mark';
import type { Mark, MarkKind, MarkStyle } from './mark';
import type { MarkTool } from './mark-layer';
import { CLIP_COLOR } from './mark-shape';
import styles from './mark-panel.module.css';
import type { Along } from './place-on-page';

export interface MarkPanelProps {
  readonly tool: MarkTool;
  readonly onToolChange: (tool: MarkTool) => void;
  /** The style shown: of the selected mark, or of the next one to draw. */
  readonly style: MarkStyle;
  /** Changes the selected mark (when there is one) and what is drawn next. */
  readonly onStyleChange: (change: Partial<MarkStyle>) => void;
  /** The kind of the selected mark, or null when none is. */
  readonly selectedKind: MarkKind | null;
  /** The selected mark itself, for what only some kinds have (where a link leads, the name of a field). */
  readonly selected: Mark | null;
  readonly onSelectedChange: (change: Partial<Mark>) => void;
  /** The keys of the pages, in order: a link can lead to one of them. */
  readonly pageKeys: readonly string[];
  readonly onDelete: () => void;
  /** Moves the selected mark against an edge of its page or to its middle, across or down. */
  readonly onPlaceOnPage: (across: Along | null, down: Along | null) => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  /** Puts the tools away; what was drawn stays on the page. */
  readonly onDone: () => void;
  /** The fonts installed on the computer. */
  readonly fonts: readonly string[];
  /** For the selected mark: how many pages it is on, of how many; and how to put it on others. */
  readonly repeated: { readonly pages: number; readonly of: number } | null;
  readonly onRepeat: (range: PageRange) => void;
  /** Makes a copy of the selected mark beside it. */
  readonly onDuplicate: () => void;
  /** The tools are shown as a list with their names, by kind, instead of a grid of buttons. */
  readonly toolsAsList: boolean;
  readonly onToolsAsListChange: (asList: boolean) => void;
  /** Something chosen (a signature, an image) waits to be put on a page. */
  readonly placing: boolean;
  readonly onCancelPlacing: () => void;
  /** What is said while placing, when it is not the usual words (the area of a signature with a certificate). */
  readonly placingText?: string;
  /** Given: a signature with a certificate can be made without a place on the page, from here. */
  readonly onPlaceNowhere?: () => void;
}

/** The tools drawn as what they make, so no words are needed to tell them apart. */
const TOOL_DRAWINGS: Record<MarkTool, ReactNode> = {
  select: <path d="M5 3l11 6.5-4.6 1.2 2.9 5-1.9 1.1-2.9-5L6 15.2z" fill="currentColor" stroke="none" />,
  edit: <path d="M3 15.5h7M3 11h5M12.5 16.5l.6-3 5-5 2.4 2.4-5 5zM3 6.5h10" />,
  rectangle: <rect x="3" y="5" width="14" height="10" rx="1" />,
  ellipse: <ellipse cx="10" cy="10" rx="7.5" ry="5.5" />,
  line: <path d="M3.5 16.5l13-13" />,
  arrow: <path d="M3.5 16.5l12-12M9 4h7v7" />,
  check: <path d="M3.5 10.5l4.5 5 8.5-11" />,
  cross: <path d="M4.5 4.5l11 11M15.5 4.5l-11 11" />,
  dot: <circle cx="10" cy="10" r="3.5" fill="currentColor" stroke="none" />,
  highlight: (
    <>
      <rect x="2.5" y="12" width="15" height="5" fill="#ffeb00" stroke="none" />
      <path d="M5 10.5l6-7 3.5 3-6 7-4 .5z" />
    </>
  ),
  text: <path d="M4 5V3.5h12V5M10 3.5v13M7.5 16.5h5" />,
  redact: (
    <>
      <path d="M3 5.5h14M3 14.5h9" />
      <rect x="3" y="8" width="14" height="4" fill="currentColor" stroke="none" />
    </>
  ),
  link: <path d="M8.5 11.5a3.2 3.2 0 0 0 4.6 0l3-3a3.2 3.2 0 0 0-4.6-4.6l-1.2 1.2M11.5 8.5a3.2 3.2 0 0 0-4.6 0l-3 3a3.2 3.2 0 0 0 4.6 4.6l1.2-1.2" />,
  textField: (
    <>
      <rect x="2.5" y="6" width="15" height="8" rx="1.5" />
      <path d="M5.5 8.5v3" />
    </>
  ),
  checkBox: (
    <>
      <rect x="4" y="4" width="12" height="12" rx="1.5" />
      <path d="M7 10.2l2.2 2.3L13.2 7.5" />
    </>
  ),
  radioButton: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <circle cx="10" cy="10" r="2.6" fill="currentColor" stroke="none" />
    </>
  ),
  choiceField: (
    <>
      <rect x="2.5" y="6" width="15" height="8" rx="1.5" />
      <path d="M11.5 9l1.800 1.800L15 9" />
    </>
  ),
  signatureField: (
    <>
      <path d="M3 16.5h14" />
      <path d="M4 13c2-6 4-8 5-7s-3 6-1.500 6.500S10 9 11 9.500s0 3 1.500 3 2-1.500 3.500-1.500" />
    </>
  ),
  bookmark: <path d="M6 3h8v14l-4-3.500L6 17z" />,
};

/** The tools by what they are for; the grid shows them in the same order. */
const TOOL_GROUPS: readonly { readonly name: string; readonly tools: readonly MarkTool[] }[] = [
  { name: 'select', tools: ['select', 'edit'] },
  { name: 'shapes', tools: ['rectangle', 'ellipse', 'line', 'arrow'] },
  { name: 'signs', tools: ['check', 'cross', 'dot'] },
  { name: 'text', tools: ['text', 'highlight', 'redact'] },
  { name: 'links', tools: ['link', 'bookmark'] },
  { name: 'forms', tools: ['textField', 'checkBox', 'radioButton', 'choiceField', 'signatureField'] },
];
const GROUPED: readonly MarkTool[] = TOOL_GROUPS.flatMap((group) => group.tools);
// A kind of mark without a group still gets its button, at the end.
const TOOLS: readonly MarkTool[] = [...GROUPED, ...MARK_KINDS.filter((kind) => !GROUPED.includes(kind))];
const LINE_WIDTHS = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12];
const TEXT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

/** Where on the page the selected mark can be sent: a name, and the place across and down. */
const PAGE_PLACES: readonly { readonly name: string; readonly across: Along | null; readonly down: Along | null }[] = [
  { name: 'left', across: -1, down: null },
  { name: 'center', across: 0, down: null },
  { name: 'right', across: 1, down: null },
  { name: 'top', across: null, down: -1 },
  { name: 'middle', across: null, down: 0 },
  { name: 'bottom', across: null, down: 1 },
];

/** A small page with a block where the mark would go. */
function placeDrawing(across: Along | null, down: Along | null): ReactNode {
  const block = across !== null ? { x: 3.5 + (across + 1) * 4.5, y: 3.5, width: 4, height: 13 } : { x: 3.5, y: 3.5 + ((down ?? 0) + 1) * 4.5, width: 13, height: 4 };
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <rect x="2" y="2" width="16" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
      <rect {...block} rx="1" fill="currentColor" />
    </svg>
  );
}

/** Which words explain the tool in use. */
function hintKey(tool: MarkTool): string {
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

/**
 * The tools for drawing and writing on the page, beside the document: what to
 * draw, how it looks, and what to do with the object that is selected. It
 * stays open while the user works, page after page.
 */
export function MarkPanel(props: MarkPanelProps) {
  const { selected, onSelectedChange, pageKeys, onDuplicate, toolsAsList, onToolsAsListChange } = props;
  const { tool, onToolChange, style, onStyleChange, selectedKind, onDelete, onPlaceOnPage, canUndo, canRedo, onUndo, onRedo, onDone, fonts, repeated, onRepeat, placing, onCancelPlacing, placingText, onPlaceNowhere } = props;
  const [repeatList, setRepeatList] = useState<string | null>(null);
  const t = useTranslation();
  // The look that matters: of the selected mark, or of what the tool draws.
  const kind: MarkKind | null = selectedKind ?? (tool === 'select' || tool === 'edit' ? null : tool);
  // What is not drawn into the page has no look to choose.
  const plain = kind === 'redact' || kind === 'erase' || kind === 'erasePicture' || (kind !== null && isAddition(kind));
  const linkPage = selected?.toPageKey !== undefined ? pageKeys.indexOf(selected.toPageKey) + 1 : 0;
  const hasLine = kind !== null && kind !== 'highlight' && kind !== 'picture' && !plain;
  const hasFill = kind === 'rectangle' || kind === 'ellipse' || kind === 'highlight';
  const hasOpacity = kind !== null && !plain;
  const explained = kind === 'erase' || kind === 'erasePicture';
  const hasWidth = kind !== null && !plain && !['dot', 'highlight', 'text', 'picture'].includes(kind);
  const isText = kind === 'text';
  const lineName = t(isText ? 'pdf-organizer.marks.textColor' : 'pdf-organizer.marks.lineColor');
  const toolDrawing = (option: MarkTool) => (
    <svg viewBox="0 0 20 20" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {TOOL_DRAWINGS[option]}
    </svg>
  );

  return (
    <aside className={panelStyles.panel} aria-label={t('pdf-organizer.marks.panel')}>
      <div className={panelStyles.head}>
        <h2 className={panelStyles.title}>{t('pdf-organizer.marks.panel')}</h2>
        <IconButton variant="ghost" aria-label={t('common.action.close')} tooltipSide="bottom-end" onClick={onDone}>
          <Icon name="xmark" size={14} />
        </IconButton>
      </div>
      <div className={panelStyles.body}>
        {placing && (
          <div className={styles.placing} role="status">
            <Icon name="arrow-pointer" size={16} />
            <span>{placingText ?? t('pdf-organizer.marks.placing')}</span>
            {onPlaceNowhere && <Button onClick={onPlaceNowhere}>{t('pdf-organizer.sign.invisible')}</Button>}
            <Button onClick={onCancelPlacing}>{t('common.action.cancel')}</Button>
          </div>
        )}

        <fieldset className={panelStyles.group} disabled={placing}>
          <legend className={shapeStyles.legend}>{t('pdf-organizer.marks.tool')}</legend>
          <div role="radiogroup" aria-label={t('pdf-organizer.marks.toolsView')} className={styles.views}>
            <button type="button" role="radio" aria-checked={!toolsAsList} aria-label={t('pdf-organizer.marks.toolsView.buttons')} className={styles.view} {...tooltip(t('pdf-organizer.marks.toolsView.buttons'), 'bottom-end')} onClick={() => onToolsAsListChange(false)}>
              <Icon name="grip" size={13} />
            </button>
            <button type="button" role="radio" aria-checked={toolsAsList} aria-label={t('pdf-organizer.marks.toolsView.list')} className={styles.view} {...tooltip(t('pdf-organizer.marks.toolsView.list'), 'bottom-end')} onClick={() => onToolsAsListChange(true)}>
              <Icon name="bars" size={13} />
            </button>
          </div>
          {toolsAsList ? (
            <div role="radiogroup" aria-label={t('pdf-organizer.marks.tool')} className={styles.toolList}>
              {TOOL_GROUPS.map((group) => (
                <div key={group.name} role="group" aria-label={t(`pdf-organizer.marks.group.${group.name}`)} className={styles.toolGroup}>
                  <span className={styles.toolGroupName}>{t(`pdf-organizer.marks.group.${group.name}`)}</span>
                  {group.tools.map((option) => (
                    <button key={option} type="button" role="radio" aria-checked={tool === option} className={styles.toolRow} onClick={() => onToolChange(option)}>
                      {toolDrawing(option)}
                      {t(`pdf-organizer.marks.tool.${option}`)}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div role="radiogroup" aria-label={t('pdf-organizer.marks.tool')} className={styles.tools}>
              {TOOLS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={tool === option}
                  aria-label={t(`pdf-organizer.marks.tool.${option}`)}
                  className={styles.tool}
                  {...tooltip(t(`pdf-organizer.marks.tool.${option}`), 'bottom')}
                  onClick={() => onToolChange(option)}
                >
                  {toolDrawing(option)}
                </button>
              ))}
            </div>
          )}
          {!toolsAsList && <p className={styles.toolName}>{t(`pdf-organizer.marks.tool.${tool}`)}</p>}
          <p className={styles.note}>{t(hintKey(tool))}</p>
        </fieldset>

        {selected?.kind === 'link' && (
          <fieldset className={panelStyles.group}>
            <legend className={shapeStyles.legend}>{t('pdf-organizer.marks.link')}</legend>
            <div role="radiogroup" aria-label={t('pdf-organizer.marks.link')} className={styles.choices}>
              <button type="button" role="radio" aria-checked={selected.toPageKey === undefined} className={styles.choice} onClick={() => onSelectedChange({ toPageKey: undefined })}>
                {t('pdf-organizer.marks.link.address')}
              </button>
              <button type="button" role="radio" aria-checked={selected.toPageKey !== undefined} className={styles.choice} onClick={() => onSelectedChange({ toPageKey: selected.toPageKey ?? pageKeys[0] })}>
                {t('pdf-organizer.marks.link.page')}
              </button>
            </div>
            {selected.toPageKey === undefined ? (
              <input
                type="text"
                className={`${shapeStyles.number} ${styles.wide}`}
                dir="ltr"
                // A link just drawn asks at once where it leads.
                autoFocus={(selected.url ?? '') === ''}
                placeholder="https://"
                aria-label={t('pdf-organizer.marks.link.address')}
                value={selected.url ?? ''}
                onChange={(event) => onSelectedChange({ url: event.target.value })}
              />
            ) : (
              <label className={panelStyles.row}>
                <span>{t('pdf-organizer.marks.link.toPage')}</span>
                <input
                  type="number"
                  className={shapeStyles.number}
                  min={1}
                  max={pageKeys.length}
                  value={linkPage || ''}
                  onChange={(event) => {
                    const page = pageKeys[Math.min(Math.max(Math.floor(event.target.valueAsNumber) || 1, 1), pageKeys.length) - 1];
                    if (page !== undefined) onSelectedChange({ toPageKey: page });
                  }}
                />
              </label>
            )}
            <p className={styles.note}>{t('pdf-organizer.marks.link.note')}</p>
          </fieldset>
        )}

        {selected && (isField(selected.kind) || selected.kind === 'bookmark') && (
          <fieldset className={panelStyles.group}>
            <legend className={shapeStyles.legend}>{t(selected.kind === 'bookmark' ? 'pdf-organizer.marks.bookmark' : 'pdf-organizer.marks.field')}</legend>
            <input
              type="text"
              className={`${shapeStyles.number} ${styles.wide}`}
              dir="auto"
              maxLength={120}
              aria-label={t(selected.kind === 'bookmark' ? 'pdf-organizer.marks.bookmark.title' : selected.kind === 'radioButton' ? 'pdf-organizer.marks.field.group' : 'pdf-organizer.marks.field.name')}
              placeholder={t(selected.kind === 'bookmark' ? 'pdf-organizer.marks.bookmark.title' : selected.kind === 'radioButton' ? 'pdf-organizer.marks.field.group' : 'pdf-organizer.marks.field.name')}
              value={selected.name ?? ''}
              onChange={(event) => onSelectedChange({ name: event.target.value })}
            />
            {selected.kind === 'radioButton' && (
              <input
                type="text"
                className={`${shapeStyles.number} ${styles.wide}`}
                dir="auto"
                maxLength={120}
                aria-label={t('pdf-organizer.marks.field.value')}
                placeholder={t('pdf-organizer.marks.field.value')}
                value={selected.value ?? ''}
                onChange={(event) => onSelectedChange({ value: event.target.value })}
              />
            )}
            {selected.kind === 'choiceField' && (
              <label className={styles.stacked}>
                <span>{t('pdf-organizer.marks.field.options')}</span>
                <textarea
                  className={styles.answers}
                  dir="auto"
                  rows={4}
                  value={(selected.options ?? []).join('\n')}
                  onChange={(event) => onSelectedChange({ options: event.target.value.split('\n') })}
                  // Enter starts the next answer; the keys of the page are not meant here.
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </label>
            )}
            {selected.kind === 'textField' && (
              <label className={shapeStyles.choice}>
                <input type="checkbox" checked={selected.multiline ?? false} onChange={(event) => onSelectedChange({ multiline: event.target.checked })} />
                {t('pdf-organizer.marks.field.multiline')}
              </label>
            )}
            <p className={styles.note}>{t(selected.kind === 'bookmark' ? 'pdf-organizer.marks.bookmark.note' : selected.kind === 'signatureField' ? 'pdf-organizer.marks.field.signNote' : selected.kind === 'radioButton' ? 'pdf-organizer.marks.field.radioNote' : 'pdf-organizer.marks.field.note')}</p>
          </fieldset>
        )}

        {selected?.kind === 'attachment' && (
          <fieldset className={panelStyles.group}>
            <legend className={shapeStyles.legend}>{t('pdf-organizer.marks.attachment')}</legend>
            <label className={styles.stacked}>
              <span>{t('pdf-organizer.marks.attachment.name')}</span>
              <input type="text" className={`${shapeStyles.number} ${styles.wide}`} dir="auto" maxLength={200} value={selected.name ?? ''} onChange={(event) => onSelectedChange({ name: event.target.value })} />
            </label>
            <label className={styles.stacked}>
              <span>{t('pdf-organizer.marks.attachment.author')}</span>
              <input type="text" className={`${shapeStyles.number} ${styles.wide}`} dir="auto" maxLength={120} value={selected.author ?? ''} onChange={(event) => onSelectedChange({ author: event.target.value })} />
            </label>
            <label className={styles.stacked}>
              <span>{t('pdf-organizer.marks.attachment.path')}</span>
              <bdi className={styles.path} dir="ltr">
                {selected.path ?? ''}
              </bdi>
            </label>
            <div className={panelStyles.row}>
              <span>{t('pdf-organizer.marks.attachment.color')}</span>
              <input type="color" className={styles.color} value={selected.stroke ?? CLIP_COLOR} aria-label={t('pdf-organizer.marks.attachment.color')} onChange={(event) => onSelectedChange({ stroke: event.target.value })} />
            </div>
            <p className={styles.note}>{t('pdf-organizer.marks.attachment.note')}</p>
          </fieldset>
        )}

        {(hasLine || hasFill || hasWidth || hasOpacity || explained) && (
          <fieldset className={panelStyles.group}>
            <legend className={shapeStyles.legend}>{t('pdf-organizer.marks.appearance')}</legend>
            {hasLine && (
              <div className={panelStyles.row}>
                <span>{lineName}</span>
                <span className={styles.colorRow}>
                  {hasFill && (
                    <button type="button" className={styles.none} aria-pressed={style.stroke === null} {...tooltip(t('pdf-organizer.marks.noLine'), 'bottom')} aria-label={t('pdf-organizer.marks.noLine')} onClick={() => onStyleChange({ stroke: style.stroke === null ? '#000000' : null })}>
                      <Icon name="ban" size={13} />
                    </button>
                  )}
                  {isText ? (
                    <input type="color" className={styles.color} value={style.textColor} aria-label={lineName} onChange={(event) => onStyleChange({ textColor: event.target.value })} />
                  ) : (
                    <input type="color" className={styles.color} data-none={style.stroke === null} value={style.stroke ?? '#000000'} aria-label={lineName} onChange={(event) => onStyleChange({ stroke: event.target.value })} />
                  )}
                </span>
              </div>
            )}
            {hasFill && (
              <div className={panelStyles.row}>
                <span>{t('pdf-organizer.marks.fillColor')}</span>
                <span className={styles.colorRow}>
                  {kind !== 'highlight' && (
                    <button type="button" className={styles.none} aria-pressed={style.fill === null} {...tooltip(t('pdf-organizer.marks.noFill'), 'bottom')} aria-label={t('pdf-organizer.marks.noFill')} onClick={() => onStyleChange({ fill: style.fill === null ? '#ffffff' : null })}>
                      <Icon name="ban" size={13} />
                    </button>
                  )}
                  <input
                    type="color"
                    className={styles.color}
                    data-none={style.fill === null}
                    value={style.fill ?? (kind === 'highlight' ? HIGHLIGHT_COLOR : '#ffffff')}
                    aria-label={t('pdf-organizer.marks.fillColor')}
                    onChange={(event) => onStyleChange({ fill: event.target.value })}
                  />
                </span>
              </div>
            )}
            {hasWidth && (
              <label className={panelStyles.row}>
                <span>{t('pdf-organizer.marks.lineWidth')}</span>
                <select className={shapeStyles.select} value={style.lineWidth} onChange={(event) => onStyleChange({ lineWidth: Number(event.target.value) })}>
                  {[...new Set([...LINE_WIDTHS, style.lineWidth])]
                    .sort((a, b) => a - b)
                    .map((width) => (
                      <option key={width} value={width}>
                        {t('pdf-organizer.marks.points', { count: width })}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {hasOpacity && (
              <label className={panelStyles.row}>
                <span>{t('pdf-organizer.marks.opacity')}</span>
                <span className={styles.opacity}>
                  <input type="range" min={10} max={100} step={5} value={Math.round(style.opacity * 100)} aria-label={t('pdf-organizer.marks.opacity')} onChange={(event) => onStyleChange({ opacity: Number(event.target.value) / 100 })} />
                  <span className={styles.percent}>{Math.round(style.opacity * 100)}%</span>
                </span>
              </label>
            )}
            {kind === 'erase' && <p className={styles.note}>{t('pdf-organizer.marks.eraseNote')}</p>}
            {kind === 'erasePicture' && <p className={styles.note}>{t('pdf-organizer.marks.erasePictureNote')}</p>}
          </fieldset>
        )}

        {isText && (
          <fieldset className={panelStyles.group}>
            <legend className={shapeStyles.legend}>{t('pdf-organizer.marks.textSection')}</legend>
            <FontSelect className={`${shapeStyles.select} ${styles.wide}`} value={style.font} onChange={(font) => onStyleChange({ font })} families={fonts} />
            <label className={panelStyles.row}>
              <span>{t('pdf-organizer.marks.textSize')}</span>
              <select className={shapeStyles.select} value={style.size} onChange={(event) => onStyleChange({ size: Number(event.target.value) })}>
                {[...new Set([...TEXT_SIZES, style.size])]
                  .sort((a, b) => a - b)
                  .map((size) => (
                    <option key={size} value={size}>
                      {t('pdf-organizer.marks.points', { count: size })}
                    </option>
                  ))}
              </select>
            </label>
            <div className={panelStyles.row}>
              <span className={styles.buttons}>
                <IconButton variant="ghost" aria-label={t('pdf-organizer.marks.bold')} aria-pressed={style.bold} onClick={() => onStyleChange({ bold: !style.bold })}>
                  <Icon name="bold" size={14} />
                </IconButton>
                <IconButton variant="ghost" aria-label={t('pdf-organizer.marks.italic')} aria-pressed={style.italic} onClick={() => onStyleChange({ italic: !style.italic })}>
                  <Icon name="italic" size={14} />
                </IconButton>
              </span>
              <span role="radiogroup" aria-label={t('pdf-organizer.marks.align')} className={styles.buttons}>
                {TEXT_ALIGNS.map((align) => (
                  <IconButton key={align} variant="ghost" role="radio" aria-checked={style.align === align} aria-label={t(`pdf-organizer.marks.align.${align}`)} onClick={() => onStyleChange({ align })}>
                    {/* Three lines, drawn here: shorter ones stand at the left, in the middle or at the right. */}
                    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                      <path d={align === 'left' ? 'M2 3.5h12M2 8h7M2 12.5h10' : align === 'center' ? 'M2 3.5h12M4.5 8h7M3 12.5h10' : 'M2 3.5h12M7 8h7M4 12.5h10'} />
                    </svg>
                  </IconButton>
                ))}
              </span>
            </div>
            <p className={styles.note}>{t('pdf-organizer.marks.textNote')}</p>
          </fieldset>
        )}

        {selectedKind !== null && (
          <fieldset className={panelStyles.group}>
            <legend className={shapeStyles.legend}>{t('pdf-organizer.marks.selected')}</legend>
            <div className={panelStyles.row}>
              <span>{t('pdf-organizer.marks.placeOnPage')}</span>
            </div>
            <div className={styles.places}>
              {PAGE_PLACES.map(({ name, across, down }) => (
                <button key={name} type="button" className={styles.tool} aria-label={t(`pdf-organizer.marks.onPage.${name}`)} {...tooltip(t(`pdf-organizer.marks.onPage.${name}`), 'bottom')} onClick={() => onPlaceOnPage(across, down)}>
                  {placeDrawing(across, down)}
                </button>
              ))}
            </div>
            {repeated && (
              <>
                <label className={panelStyles.row} {...tooltip(t('pdf-organizer.marks.repeatHint'), 'bottom')}>
                  <span>{t('pdf-organizer.marks.repeat')}</span>
                  <select
                    className={shapeStyles.select}
                    // What it is on now: this page only, all of them, or some.
                    value={repeatList !== null ? 'custom' : repeated.pages <= 1 ? 'this' : repeated.pages >= repeated.of ? 'all' : 'some'}
                    onChange={(event) => {
                      const choice = event.target.value;
                      setRepeatList(choice === 'custom' ? '' : null);
                      if (choice === 'this') onRepeat({ kind: 'custom', list: '' });
                      else if (choice === 'all') onRepeat({ kind: 'all' });
                      else if (choice === 'chosen') onRepeat({ kind: 'chosen' });
                    }}
                  >
                    <option value="this">{t('pdf-organizer.marks.repeat.this')}</option>
                    <option value="all">{t('pdf-organizer.marks.repeat.all')}</option>
                    <option value="chosen">{t('pdf-organizer.marks.repeat.chosen')}</option>
                    <option value="custom">{t('pdf-organizer.marks.repeat.custom')}</option>
                    {repeated.pages > 1 && repeated.pages < repeated.of && repeatList === null && <option value="some">{t('pdf-organizer.marks.repeat.some', { count: repeated.pages })}</option>}
                  </select>
                </label>
                {repeatList !== null && (
                  <form
                    className={styles.pages}
                    onSubmit={(event) => {
                      event.preventDefault();
                      onRepeat({ kind: 'custom', list: repeatList });
                      setRepeatList(null);
                    }}
                  >
                    <input type="text" className={shapeStyles.number} dir="ltr" autoFocus placeholder="1, 3, 5-8" aria-label={t('pdf-organizer.marks.repeat.custom')} value={repeatList} onChange={(event) => setRepeatList(event.target.value)} />
                    <Button type="submit">{t('pdf-organizer.marks.repeat.apply')}</Button>
                  </form>
                )}
              </>
            )}
            <div className={styles.pair}>
              <Button onClick={onDuplicate} {...tooltip(t('pdf-organizer.marks.duplicateHint'), 'bottom')}>
                <Icon name="copy" size={14} />
                {t('pdf-organizer.marks.duplicate')}
              </Button>
              <Button onClick={onDelete}>
                <Icon name="trash-can" size={14} />
                {t('pdf-organizer.marks.delete')}
              </Button>
            </div>
          </fieldset>
        )}
      </div>
      <div className={panelStyles.actions}>
        <span className={styles.history}>
          <IconButton variant="ghost" aria-label={t('pdf-organizer.command.undo')} disabled={!canUndo} onClick={onUndo}>
            <Icon name="arrow-rotate-left" size={15} />
          </IconButton>
          <IconButton variant="ghost" aria-label={t('pdf-organizer.command.redo')} disabled={!canRedo} onClick={onRedo}>
            <Icon name="arrow-rotate-right" size={15} />
          </IconButton>
        </span>
        <Button variant="primary" onClick={onDone}>
          <Icon name="check" size={14} />
          {t('pdf-organizer.marks.done')}
        </Button>
      </div>
    </aside>
  );
}
