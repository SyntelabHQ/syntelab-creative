import { useI18n } from '@syntelab/i18n';
import { Button, Icon } from '@syntelab/ui-kit';
import { useState } from 'react';
import { PaneHead } from '../panel/pane-head';
import type { PaneAction } from '../panel/pane-head';
import { factsOf } from './preview';
import type { Preview } from './preview';
import styles from './result-pane.module.css';
import { ResultView } from './result-view';

/** What the pane has to show: a result, the wait for one, why there is none, or that the text is too long to try. */
export type PreviewState =
  | { readonly kind: 'ready'; readonly preview: Preview }
  | { readonly kind: 'working' }
  | { readonly kind: 'problem'; readonly key: string; readonly detail?: string }
  | { readonly kind: 'tooLong' }
  /** Nothing to show, and why: no tool is open, the tool writes text, it still needs a choice, the text is empty, or it would change nothing. */
  | { readonly kind: 'hint'; readonly why: 'noTool' | 'writes' | 'choices' | 'empty' | 'same' }
  /** The tool was just applied: the text is the result now. */
  | { readonly kind: 'applied' };

export interface ResultPaneProps {
  /** The name of the tool or the recipe whose result this is, already translated. */
  readonly title: string;
  readonly state: PreviewState;
  /** The result is of the selection only. */
  readonly ofSelection: boolean;
  readonly wrap: boolean;
  readonly lineNumbers: boolean;
  /** The result stands under the text instead of beside it. */
  readonly stacked: boolean;
  /** The text and the result are scrolled as one. */
  readonly scrollTogether: boolean;
  /** Shows a line of the text (from 1): where a line taken out is. */
  readonly onShowLine: (line: number) => void;
  readonly onCopy: (text: string) => void;
  readonly onOpenAsNew: (text: string) => void;
  /** Opens the text and the result in a tab that compares them. */
  readonly onCompare: (result: string) => void;
  readonly onStacked: (stacked: boolean) => void;
  readonly onScrollTogether: (together: boolean) => void;
  /** Hears what scrolls the result (null when it is gone): to be scrolled with the text. */
  readonly onScroller: (scroller: HTMLElement | null) => void;
  /** Takes back what was just applied, and compares the text with what it was before. */
  readonly onUndo: () => void;
  readonly onCompareApplied: () => void;
  readonly onClose: () => void;
}

/**
 * What the open tool would give, beside the text, before it is applied: the
 * result with what differs marked, what was done in numbers, and the lines
 * that would be taken out. Nothing in the text changes until "Apply".
 */
export function ResultPane({ title, state, ofSelection, wrap, lineNumbers, stacked, scrollTogether, onShowLine, onCopy, onOpenAsNew, onCompare, onStacked, onScrollTogether, onScroller, onUndo, onCompareApplied, onClose }: ResultPaneProps) {
  const { t, language } = useI18n();
  const [removedShown, setRemovedShown] = useState(true);
  const number = new Intl.NumberFormat(language);
  const preview = state.kind === 'ready' ? state.preview : null;
  const nothing = !preview || preview.kind === 'same';

  const actions: PaneAction[] = [
    { id: 'copy', icon: 'copy', label: t('scribe.preview.copy'), disabled: nothing, onRun: () => preview && onCopy(preview.text) },
    { id: 'new', icon: 'file-circle-plus', minor: true, label: t('scribe.preview.openAsNew'), disabled: nothing, onRun: () => preview && onOpenAsNew(preview.text) },
    { id: 'compare', icon: 'code-compare', minor: true, label: t('scribe.preview.compare'), disabled: nothing, onRun: () => preview && onCompare(preview.text) },
    { id: 'together', icon: 'link', minor: true, label: t('scribe.preview.scrollTogether'), pressed: scrollTogether, onRun: () => onScrollTogether(!scrollTogether) },
    { id: 'stacked', icon: stacked ? 'table-columns' : 'rectangle-list', label: t(stacked ? 'scribe.preview.sideBySide' : 'scribe.preview.stacked'), onRun: () => onStacked(!stacked) },
    { id: 'close', icon: 'xmark', label: t('scribe.preview.close'), onRun: onClose },
  ];

  return (
    <section className={styles.pane} aria-label={t('scribe.preview.title')}>
      <PaneHead
        title={t('scribe.preview.title')}
        of={title === '' ? undefined : `${title}${ofSelection ? ` · ${t('scribe.preview.ofSelection')}` : ''}`}
        actions={actions}
        facts={
          <>
            {state.kind === 'working' && <span className={styles.said}>{t('scribe.tools.working')}</span>}
            {state.kind === 'hint' && <span className={styles.said}>{t('scribe.preview.notApplied')}</span>}
            {state.kind === 'tooLong' && <span className={styles.said}>{t('scribe.preview.tooLong')}</span>}
            {state.kind === 'problem' && (
              <span className={styles.problem} role="alert">
                {t(state.key)}
                {state.detail && <bdi dir="ltr"> {state.detail}</bdi>}
              </span>
            )}
            {preview && (
              <>
                <span className={styles.kind}>{t(`scribe.preview.kind.${preview.kind}`)}</span>
                {factsOf(preview).map((fact) => (
                  <span key={fact.key} className={styles.fact} data-fact={fact.key}>
                    {t(`scribe.preview.fact.${fact.key}`, { count: fact.count })}
                  </span>
                ))}
                <span className={styles.sizes}>
                  {t('scribe.preview.lines', { before: number.format(preview.linesBefore), after: number.format(preview.linesAfter) })} · {t('scribe.preview.characters', { before: number.format(preview.charactersBefore), after: number.format(preview.charactersAfter) })}
                </span>
              </>
            )}
          </>
        }
      />

      {preview && <ResultView text={preview.text} marks={preview.marks} wrap={wrap} lineNumbers={lineNumbers} onScroller={onScroller} />}
      {state.kind === 'hint' && (
        <div className={styles.empty}>
          <Icon name={state.why === 'same' ? 'circle-check' : 'circle-info'} size={22} />
          <p>{t(`scribe.preview.hint.${state.why}`)}</p>
        </div>
      )}
      {state.kind === 'applied' && (
        <div className={styles.empty} data-kind="applied" role="status">
          <Icon name="circle-check" size={22} />
          <p>{t('scribe.preview.applied')}</p>
          <span className={styles.after}>
            <Button onClick={onUndo}>
              <Icon name="arrow-rotate-left" size={14} />
              {t('scribe.command.undo')}
            </Button>
            <Button onClick={onCompareApplied}>
              <Icon name="code-compare" size={14} />
              {t('scribe.tools.compareWithBefore')}
            </Button>
          </span>
        </div>
      )}
      {!preview && state.kind !== 'hint' && state.kind !== 'applied' && <div className={styles.empty} />}
      {preview && preview.removed.length > 0 && (
        <div className={styles.removed}>
          <button type="button" className={styles.removedHead} aria-expanded={removedShown} onClick={() => setRemovedShown(!removedShown)}>
            <Icon name={removedShown ? 'chevron-down' : 'chevron-right'} size={12} />
            {t('scribe.preview.removed', { count: preview.removedLines })}
          </button>
          {removedShown && (
            <ol className={styles.removedList}>
              {preview.removed.map((line) => (
                <li key={line.line}>
                  <button type="button" className={styles.removedLine} onClick={() => onShowLine(line.line)}>
                    <span className={styles.removedNumber}>{line.line}</span>
                    <bdi className={styles.removedText}>{line.text === '' ? t('scribe.preview.emptyLine') : line.text}</bdi>
                  </button>
                </li>
              ))}
              {preview.removedLines > preview.removed.length && <li className={styles.more}>{t('scribe.preview.moreRemoved', { count: preview.removedLines - preview.removed.length })}</li>}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
