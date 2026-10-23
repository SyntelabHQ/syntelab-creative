import { AppInvokeError } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { useEffect, useRef, useState } from 'react';
import { fetchPreview, PREVIEW_UP_TO } from './preview';
import type { PreviewState } from './result-pane';

/** What a result is asked of: the operations of the tool that is open, with the name the result is shown under. */
export interface PreviewOf {
  /** The id of the tool (or of the recipe): the result is of this one. */
  readonly id: string;
  /** Its name, already translated. */
  readonly title: string;
  readonly operations: readonly Record<string, unknown>[];
}

/** How long after the last change of the text or of a choice the result is asked for again. */
const ASKED_AFTER = 300;

/**
 * The result of what is open, kept up to date while the text and the choices
 * change. `text` gives what it would be applied to right now; `version`
 * changes whenever that may have changed. Null while nothing is asked for.
 */
export function usePreview(host: Pick<AppHost, 'invoke'>, of: PreviewOf | null, text: () => string, version: unknown): PreviewState | null {
  const [state, setState] = useState<PreviewState | null>(null);
  const { invoke } = host;
  const latestText = useRef(text);
  latestText.current = text;
  /** What the result now shown was asked of: nothing is asked twice for the same text and choices. */
  const shownFor = useRef<{ text: string; operations: string } | null>(null);
  const operations = of ? JSON.stringify(of.operations) : null;

  useEffect(() => {
    if (!of || operations === null) {
      shownFor.current = null;
      return setState(null);
    }
    let cancelled = false;
    const wait = setTimeout(() => {
      const asked = latestText.current();
      if (shownFor.current?.text === asked && shownFor.current.operations === operations) return;
      if (asked.length > PREVIEW_UP_TO) {
        shownFor.current = null;
        return setState({ kind: 'tooLong' });
      }
      // The result before stays in view while the next is made: no flicker at every key.
      setState((before) => before ?? { kind: 'working' });
      fetchPreview({ invoke }, asked, of.operations).then(
        (preview) => {
          if (cancelled) return;
          shownFor.current = { text: asked, operations };
          setState({ kind: 'ready', preview });
        },
        (error) => {
          if (cancelled) return;
          shownFor.current = null;
          const code = error instanceof AppInvokeError ? error.code : null;
          setState(code === 'bad-pattern' ? { kind: 'problem', key: 'scribe.tools.badPattern', detail: error instanceof Error ? error.message.replace(/^bad-pattern:\s*/, '') : undefined } : { kind: 'problem', key: code === 'bad-choice' ? 'scribe.preview.notYet' : 'scribe.tools.failed' });
        },
      );
    }, ASKED_AFTER);
    return () => {
      cancelled = true;
      clearTimeout(wait);
    };
    // `of` is a new object at every drawing; what it asks for is in `operations`.
  }, [operations, version, invoke]);

  return state;
}
