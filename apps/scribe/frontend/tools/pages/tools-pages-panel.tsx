import { useI18n } from '@syntelab/i18n';
import { Button, Icon, IconButton } from '@syntelab/ui-kit';
import { useEffect, useRef, useState } from 'react';
import { DoubtfulWords } from '../doubtful-words';
import { countsOf, isReady, TOOL_GROUPS, TOOLS } from '../tool-definitions';
import type { Tool } from '../tool-definitions';
import type { ToolsPanelProps } from '../tools-panel';
import { CompactFields } from './compact-fields';
import styles from './tools-pages-panel.module.css';
import { useToolRunner } from './use-tool-runner';

const FOLDED_KEY = 'toolGroupsFolded';

/** A text as it is looked for: in small letters, without the marks over and under them. */
function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * The tools, as two pages of one panel: the list of them, to choose from, and
 * the tool that was chosen, with its choices from the top of the panel and
 * its button always in sight at the bottom. Looking for a tool by its name
 * brings the list back from wherever the panel is.
 *
 * It does what `tools-panel.tsx` does, laid out another way: the owner tries
 * the two side by side (View → "Tools: one at a time") before one of them
 * goes.
 */
export function ToolsPagesPanel(props: ToolsPanelProps) {
  const { host, openTool, onOpenTool, hiddenGroups, selected, onReplaceAt, onCompare, disabled } = props;
  const { t } = useI18n();
  const runner = useToolRunner(props);
  const [query, setQuery] = useState('');
  const [explained, setExplained] = useState(false);
  const [folded, setFolded] = useState<readonly string[]>(() => {
    const stored = host.loadData<unknown>(FOLDED_KEY);
    return Array.isArray(stored) ? stored.filter((group): group is string => typeof group === 'string') : [];
  });
  const search = useRef<HTMLInputElement>(null);

  const tool = TOOLS.find((known) => known.id === openTool);
  // A tool opened (from the list, a menu, the start page) is what the panel shows: what was being looked for is put away.
  useEffect(() => {
    if (openTool !== null) setQuery('');
    setExplained(false);
  }, [openTool]);

  const toggleGroup = (group: string) => {
    const next = folded.includes(group) ? folded.filter((known) => known !== group) : [...folded, group];
    setFolded(next);
    host.saveData(FOLDED_KEY, next);
  };

  const wanted = plain(query.trim());
  const listed = TOOLS.filter((known) => !hiddenGroups.includes(known.group) && (wanted === '' || plain(t(`scribe.tool.${known.id}`)).includes(wanted) || plain(t(`scribe.toolHint.${known.id}`)).includes(wanted)));
  const searching = wanted !== '';

  const tile = (known: Tool) => (
    <button key={known.id} type="button" className={styles.tile} data-tooltip={t(`scribe.toolHint.${known.id}`)} onClick={() => onOpenTool(known.id)}>
      <Icon name={known.icon} size={15} />
      <span>{t(`scribe.tool.${known.id}`)}</span>
    </button>
  );

  /** A group that is one tool with one choice laid out: its options stand in the list themselves, each a click away. */
  const optionsOf = (group: string) => {
    const [only, ...others] = TOOLS.filter((known) => known.group === group);
    const field = others.length === 0 ? only?.fields.find((known) => known.kind === 'choice' && known.spread) : undefined;
    return only && field?.kind === 'choice' ? { tool: only, field } : null;
  };
  const optionTiles = ({ tool: known, field }: NonNullable<ReturnType<typeof optionsOf>>) =>
    field.options.map((option) => (
      <button
        key={option}
        type="button"
        className={styles.tile}
        data-tooltip={t(`scribe.toolHint.${known.id}`)}
        onClick={() => {
          // The tool opens with this option chosen; its other choices stay as they were left.
          runner.setToolValues(known, { ...runner.valuesOf(known), [field.name]: option });
          onOpenTool(known.id);
        }}
      >
        <Icon name={known.icon} size={15} />
        <span>{t(`scribe.variant.${known.id}.${option}`)}</span>
      </button>
    ));

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
          <IconButton variant="ghost" aria-label={t('scribe.tools.allTools')} onClick={() => onOpenTool(null)}>
            <Icon name="arrow-left" size={14} />
          </IconButton>
          <span className={styles.title} data-open="true">
            <Icon name={tool.icon} size={15} />
            <span>{t(`scribe.tool.${tool.id}`)}</span>
          </span>
          <IconButton variant="ghost" aria-label={t('scribe.tools.whatItDoes')} aria-expanded={explained} onClick={() => setExplained(!explained)}>
            <Icon name="circle-info" size={14} />
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

  // The list of tools: all of them, or those that answer to what is looked for.
  return (
    <div className={styles.panel}>
      {finder}
      <div className={styles.body}>
        {TOOL_GROUPS.every((group) => hiddenGroups.includes(group)) && <p className={styles.scope}>{t('scribe.tools.allHidden')}</p>}
        {searching && listed.length === 0 && <p className={styles.scope}>{t('scribe.tools.noToolFound')}</p>}
        {searching && listed.length > 0 && <div className={styles.tiles}>{listed.map(tile)}</div>}
        {!searching &&
          TOOL_GROUPS.filter((group) => !hiddenGroups.includes(group)).map((group) => {
            const open = !folded.includes(group);
            return (
              <section key={group} className={styles.group}>
                <button type="button" className={styles.groupName} aria-expanded={open} onClick={() => toggleGroup(group)}>
                  <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
                  {t(`scribe.toolGroup.${group}`)}
                </button>
                {open && <div className={styles.tiles}>{optionsOf(group) ? optionTiles(optionsOf(group) as NonNullable<ReturnType<typeof optionsOf>>) : TOOLS.filter((known) => known.group === group).map(tile)}</div>}
              </section>
            );
          })}
      </div>
    </div>
  );
}
