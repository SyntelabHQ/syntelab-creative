import type { AppHost } from '@syntelab/shell-api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlanPage } from '../document/page-plan';
import { compareHits, hitsOnPlan, planPlaces, stepHit } from './find-hits';
import type { FoundPage, Hit } from './find-hits';

/** Pages asked for in one go: short enough to stay quick, long enough to get on. */
const STRETCH = 40;
/** Typing is not searched letter by letter. */
const TYPING_PAUSE_MILLISECONDS = 250;
/** Beyond this the list stops growing: nobody steps through more. */
const MAX_HITS = 5000;

export interface Find {
  /** True while the find bar is shown. */
  readonly open: boolean;
  show(): void;
  close(): void;
  readonly query: string;
  setQuery(query: string): void;
  /** Every place found so far, in reading order. */
  readonly hits: readonly Hit[];
  /** Index in `hits` of the one the user is at, or -1. */
  readonly active: number;
  /** The document is still being looked through. */
  readonly searching: boolean;
  /** More was found than is listed. */
  readonly limited: boolean;
  /** Goes to the next (1) or previous (-1) hit and returns it. */
  step(direction: 1 | -1, currentPage: number): Hit | null;
}

/**
 * "Find in document": looks for the text in the pages as arranged now (pages
 * taken from other files included), a stretch at a time, so results show up
 * while a long document is still being searched.
 */
export function useFind(host: AppHost, plan: readonly PlanPage[]): Find {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly Hit[]>([]);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [limited, setLimited] = useState(false);
  const { invoke } = host;
  const places = useMemo(() => planPlaces(plan), [plan]);
  const hitsRef = useRef(hits);
  hitsRef.current = hits;
  const activeRef = useRef(active);
  activeRef.current = active;

  const needle = open ? query.trim() : '';
  useEffect(() => {
    setHits([]);
    setActive(-1);
    setLimited(false);
    if (needle === '') {
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;

    const search = async () => {
      let found: Hit[] = [];
      for (const [documentId, placesOfDocument] of places) {
        const lastPage = Math.max(...placesOfDocument.keys());
        for (let fromPage = 0; fromPage <= lastPage; fromPage += STRETCH) {
          const answer = await invoke<{ pages: readonly FoundPage[] }>('search_text', {
            documentId,
            query: needle,
            fromPage,
            pageCount: STRETCH,
          });
          if (cancelled) return;
          const added = hitsOnPlan(answer.pages, placesOfDocument);
          if (added.length === 0) continue;
          found = [...found, ...added].sort(compareHits);
          if (found.length > MAX_HITS) {
            setHits(found.slice(0, MAX_HITS));
            setLimited(true);
            return;
          }
          setHits(found);
        }
      }
    };

    const timer = setTimeout(() => {
      void search()
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, TYPING_PAUSE_MILLISECONDS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [invoke, needle, places]);

  const step = useCallback((direction: 1 | -1, currentPage: number): Hit | null => {
    const next = stepHit(hitsRef.current, activeRef.current, direction, currentPage);
    setActive(next);
    return hitsRef.current[next] ?? null;
  }, []);

  return {
    open,
    show: useCallback(() => setOpen(true), []),
    close: useCallback(() => setOpen(false), []),
    query,
    setQuery,
    hits,
    active,
    searching,
    limited,
    step,
  };
}
