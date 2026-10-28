import { useI18n } from '@syntelab/i18n';
import { Button, Icon, IconButton } from '@syntelab/ui-kit';
import { useEffect, useRef, useState } from 'react';
import { DoubtfulWords } from '../doubtful-words';
import { countsOf, isReady, TOOLS } from '../tool-definitions';
import type { Tool } from '../tool-definitions';
import type { ToolsPanelProps } from '../tool-panel-types';
import { CompactFields } from './compact-fields';
import styles from './tools-pages-panel.module.css';
import { useToolRunner } from './use-tool-runner';

/** A text as it is looked for: in small letters, without the marks over and under them. */
function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * The tool that was chosen (on the bar of its group, in the search, on the
 * start page), with its choices from the top of the panel and its button
 * always in sight at the bottom. The tools themselves are chosen on the bars:
 * with none open, the panel says so and can look for one by its name.
 */
export function ToolsPagesPanel(props: ToolsPanelProps) {
  const { openTool, onOpenTool, selected, onReplaceAt, onCompare, disabled } = props;
  const { t } = useI18n();
  const runner = useToolRunner(props);
  const [query, setQuery] = useState('');
  const [explained, setExplained] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  const tool = TOOLS.find((known) => known.id === openTool);
  // A tool opened (from the list, a menu, the start page) is what the panel shows: what was being looked for is put away.
  useEffect(() => {
    if (openTool !== null) setQuery('');
    setExplained(false);
  }, [openTool]);

  const wanted = plain(query.trim());
  const listed = TOOLS.filter((known) => (wanted === '' || plain(t(`scribe.tool.${known.id}`)).includes(wanted) || plain(t(`scribe.toolHint.${known.id}`)).includes(wanted)));
  const searching = wanted !== '';

  const tile = (known: Tool) => (
    <button key={known.id} type="button" className={styles.tile} data-tooltip={t(`scribe.toolHint.${known.id}`)} onClick={() => onOpenTool(known.id)}>
      <Icon name={known.icon} size={15} />
      <span>{t(`scribe.tool.${known.id}`)}</span>
    </button>
  );

  const finder = (
    <div className={styles.finder}>
      <Icon name="magnifying-glass" size={13} />
      <input
        ref={search}
        type="search"
        className={styles.find}
        value={query}
        placeholder={t('scribe.tools.findTool')}
        aria-label={t('scribe.tools.findTool')}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Enter opens the first tool found; Escape puts the search away.
          if (event.key === 'Enter' && searching && listed[0]) onOpenTool(listed[0].id);
          if (event.key === 'Escape') setQuery('');
        }}
      />
    </div>
  );

  // The page of one tool.
  if (tool && !searching) {
    const chosen = runner.valuesOf(tool);
    const { result, last, doubts, matches, matchFacts, working } = runner;
    return (
      <form
        className={styles.panel}
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled && !working && isReady(tool, chosen)) void runner.apply(tool);
        }}
      >
        {finder}
        <div className={styles.head}>
          <span className={styles.title} data-open="true">
            <Icon name={tool.icon} size={15} />
            <span>{t(`scribe.tool.${tool.id}`)}</span>
          </span>
          <IconButton variant="ghost" aria-label={t('scribe.tools.whatItDoes')} aria-expanded={explained} onClick={() => setExplained(!explained)}>
            <Icon name="circle-info" size={14} />
          </IconButton>
          <IconButton variant="ghost" aria-label={t('scribe.tools.allTools')} onClick={() => onOpenTool(null)}>
            <Icon name="xmark" size={14} />
          </IconButton>
        </div>
        <div className={styles.body}>
          {/* What the tool does: its first line always, the rest when asked for. */}
          <p className={styles.hint} data-whole={explained} onClick={() => setExplained(!explained)}>
            {t(`scribe.toolHint.${tool.id}`)}
          </p>
          <CompactFields tool={tool} values={chosen} disabled={disabled || working} onChange={(next) => runner.setToolValues(tool, next)} />
          {tool.id === 'replace' && matches !== null && (
            <p className={styles.count}>
              {t('scribe.tools.matches', { count: matches })}
              {matches > 1 && matchFacts && ` ${t('scribe.tools.matchFacts', { lines: matchFacts.lines, different: matchFacts.different })}`}
            </p>
          )}
          {doubts && <DoubtfulWords doubts={doubts} onChoose={onReplaceAt} disabled={disabled || working} />}
        </div>
        {/* Always in sight, however many choices the tool has: what it is applied to, the button, what it did. */}
        <div className={styles.foot}>
          {result?.kind === 'done' && !(result.changed === 0 && doubts) && (
            <p className={styles.done} role="status">
              {t(result.changed === 0 ? 'scribe.tools.nothingChanged' : `scribe.tools.changed.${countsOf(tool)}`, { count: result.changed })}
            </p>
          )}
          {result?.kind === 'made' && (
            <p className={styles.done} role="status">
              {t('scribe.tools.made')}
            </p>
          )}
          {result?.kind === 'problem' && (
            <p className={styles.problem} role="alert">
              {t(result.key)}
              {result.detail && <bdi dir="ltr"> {result.detail}</bdi>}
            </p>
          )}
          {!result && <p className={styles.scope}>{selected > 0 ? t('scribe.tools.onSelection', { count: selected }) : t('scribe.tools.onAll')}</p>}
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={disabled || working || !isReady(tool, chosen)}>
              {t(working ? 'scribe.tools.working' : tool.online ? 'scribe.tools.bring' : tool.makes ? 'scribe.tools.write' : 'scribe.tools.apply')}
            </Button>
            {result?.kind === 'done' && last && (
              <IconButton aria-label={t('scribe.tools.compareWithBefore')} onClick={() => onCompare(last.before, last.after)}>
                <Icon name="code-compare" size={14} />
              </IconButton>
            )}
          </div>
        </div>
      </form>
    );
  }

  // No tool open: where to choose one, or the tools that answer to what is looked for.
  return (
    <div className={styles.panel}>
      {finder}
      <div className={styles.body}>
        {!searching && <p className={styles.scope}>{t('scribe.tools.chooseTool')}</p>}
        {searching && listed.length === 0 && <p className={styles.scope}>{t('scribe.tools.noToolFound')}</p>}
        {searching && listed.length > 0 && <div className={styles.tiles}>{listed.map(tile)}</div>}
      </div>
    </div>
  );
}
