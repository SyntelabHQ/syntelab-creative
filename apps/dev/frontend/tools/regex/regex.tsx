import { useI18n } from '@syntelab/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Choice } from '../../frame/choice';
import { formatDuration } from '../../frame/format';
import type { ToolInput, ToolOutcome } from '../../frame/text-tool';
import { TextBox, Toggle } from '../../frame/toggle';
import { ToolBody } from '../../frame/tool-body';
import { oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';
import type { RegexAnswer, RegexRequest } from './regex-engine';

/** The flags of JavaScript the tool offers, each a letter. */
const FLAGS = ['g', 'i', 'm', 's', 'u', 'y'] as const;
/** What comes out: the matches, as JSON; or the text with the matches replaced. */
const SHOWS = ['matches', 'replaced'] as const;
/** How long a pattern may run before it is ended: one that backtracks without end would never answer. */
const ENDED_AFTER = 20_000;

interface Options {
  readonly flags: string;
  readonly show: (typeof SHOWS)[number];
}

const readOptions = (value: unknown): Options => {
  const { flags, show } = stored(value);
  return { flags: typeof flags === 'string' ? FLAGS.filter((flag) => flags.includes(flag)).join('') : 'g', show: oneOf(SHOWS, show) };
};

/**
 * A regular expression tried on a text: the regular expressions of
 * JavaScript, run by the engine the program draws with (they are not
 * PCRE, nor those of Rust). The pattern and what replaces a match are
 * typed in the line of options; the text goes in the input. What comes
 * out: every match with its place and its groups, as JSON, or the text
 * with the matches replaced. The pattern runs away from the window, and
 * one that never ends is ended.
 */
export default function Regex({ host, layout, onActions }: ToolProps) {
  const { t, language } = useI18n();
  const [options, change] = useOptions(host, 'regex.options', readOptions);
  // Not kept between uses: what is typed into a tool never is.
  const [pattern, setPattern] = useState('');
  const [replacement, setReplacement] = useState('');
  /** Ends the run that is going on, if one is: its worker, and the wait for its answer. */
  const ending = useRef<(() => void) | null>(null);
  const replacing = options.show === 'replaced';

  // A pattern still running when the tool goes away is ended with it.
  useEffect(() => () => ending.current?.(), []);

  const ask = useCallback((request: RegexRequest) => {
    // A run that was overtaken by another is ended at once: only the last one is waited for.
    ending.current?.();
    const fresh = new Worker(new URL('./regex.worker.ts', import.meta.url), { type: 'module' });
    return new Promise<RegexAnswer | 'ended'>((resolve) => {
      const end = (answer: RegexAnswer | 'ended') => {
        clearTimeout(timer);
        fresh.terminate();
        if (ending.current === stop) ending.current = null;
        resolve(answer);
      };
      const stop = () => end('ended');
      const timer = setTimeout(stop, ENDED_AFTER);
      ending.current = stop;
      fresh.onmessage = (event: MessageEvent<RegexAnswer>) => end(event.data);
      fresh.onerror = (event) => end({ ok: false, detail: event.message });
      fresh.postMessage(request);
    });
  }, []);

  const run = useCallback(
    async (input: ToolInput): Promise<ToolOutcome> => {
      const nowhere = (message: string): ToolOutcome => ({ ok: false, message, line: 0, column: 0, offset: 0 });
      if ('path' in input) return nowhere(t('dev.regex.problem.file'));
      if (pattern === '') return nowhere(t('dev.regex.problem.none'));
      const started = performance.now();
      const answer = await ask({ pattern, flags: options.flags, text: input.text, replacement: replacing ? replacement : null });
      if (answer === 'ended') return nowhere(t('dev.regex.problem.ended', { seconds: String(ENDED_AFTER / 1000) }));
      if (!answer.ok) return nowhere(t('dev.regex.problem.pattern', { detail: answer.detail }));
      const time = formatDuration(Math.round(performance.now() - started), language);
      if (answer.replaced !== null) return { ok: true, text: answer.replaced, fine: t('dev.regex.fine.replaced'), summary: time };
      const found = new Intl.NumberFormat(language).format(answer.matches.length);
      return { ok: true, text: JSON.stringify(answer.matches, null, 2), fine: t('dev.regex.fine.matches', { found }), summary: time, warning: answer.matches.length === 0 };
    },
    [ask, pattern, replacement, replacing, options.flags, t, language],
  );

  const toggle = (flag: string, on: boolean) => change({ flags: FLAGS.filter((known) => (known === flag ? on : options.flags.includes(known))).join('') });

  return (
    <ToolBody
      host={host}
      layout={layout}
      options={
        <>
          <TextBox label={t('dev.regex.pattern')} value={pattern} wide code hint="(\w+)@(\w+)\.com" onChange={setPattern} />
          {FLAGS.map((flag) => (
            <Toggle key={flag} label={t(`dev.regex.flag.${flag}`)} checked={options.flags.includes(flag)} onChange={(on) => toggle(flag, on)} />
          ))}
          <Choice label={t('dev.regex.show')} value={options.show} options={SHOWS.map((value) => ({ value, label: t(`dev.regex.show.${value}`) }))} onChange={(show) => change({ show })} />
          {replacing && <TextBox label={t('dev.regex.replacement')} value={replacement} wide code hint="$2 at $1" onChange={setReplacement} />}
        </>
      }
      optionsKey={`${pattern}\n${options.flags}\n${replacing ? replacement : '\u0000'}`}
      tellsOnly={false}
      run={run}
      outputSyntax={replacing ? undefined : 'json'}
      opens={{ typeName: t('dev.codec.textFiles'), extensions: ['txt', 'log', 'md', 'csv', 'json'] }}
      saves={replacing ? { typeName: t('dev.codec.textFiles'), extension: 'txt', name: () => 'replaced.txt' } : { typeName: t('dev.json.files'), extension: 'json', name: () => 'matches.json' }}
      workTitle={t('dev.regex.working')}
      onActions={onActions}
    />
  );
}
