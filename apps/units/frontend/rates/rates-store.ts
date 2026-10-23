import type { AppHost } from '@syntelab/shell-api';
import { useSyncExternalStore } from 'react';
import { loadSettings } from '../settings/units-settings';

/** The converter whose units have no fixed factor: their rates are read from the network. */
export const CURRENCY = 'currency';

/** Rates of one kind, as the Rust side says they are. */
export interface RatesRead {
  /** When they are of, in seconds since 1970. */
  readonly time: number;
  /** When their source changes them next; 0 where it does not say. */
  readonly next: number;
  readonly count: number;
}

/** What is known of the rates of currencies. */
export interface RatesState {
  /** The currencies of countries, and cryptocurrencies; null while there are none. */
  readonly fiat: RatesRead | null;
  readonly coins: RatesRead | null;
  /** The kinds that could not be read the last time it was tried: the rates shown are the last that were. */
  readonly failed: readonly ('fiat' | 'coins')[];
  /** They are being read now. */
  readonly reading: boolean;
  /** Goes up whenever the rates change: what was converted with those of before is converted again. */
  readonly version: number;
}

interface Answer {
  readonly now: number;
  readonly fiat: RatesRead | null;
  readonly coins: RatesRead | null;
  readonly failed: readonly ('fiat' | 'coins')[];
  readonly changed: boolean;
  /** What is kept on this computer, to be handed back next time. */
  readonly keep: unknown;
}

const DATA_KEY = 'rates';
/** Cryptocurrencies are old after a quarter of an hour: the same as on the Rust side. */
const COINS_OLD_AFTER = 15 * 60;
type Host = Pick<AppHost, 'invoke' | 'loadData' | 'saveData'>;

let state: RatesState = { fiat: null, coins: null, failed: [], reading: false, version: 0 };
/** The Rust side was handed what was kept: it starts without rates each time the program does. */
let handed = false;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function change(next: Partial<RatesState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const ratesVersion = (): number => state.version;

/** What is known of the rates, kept up to date while they are read. */
export function useRates(): RatesState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Whether rates are to be read again without being asked: there are none, or their source has newer ones by now. */
export function ratesAreDue(now = Date.now() / 1000): boolean {
  const { fiat, coins } = state;
  return !fiat || !coins || (fiat.next > 0 && now >= fiat.next) || now >= coins.time + COINS_OLD_AFTER;
}

/**
 * Brings the rates up to date: the Rust side reads from the two services what
 * is due, and what it knows is kept on this computer for the times there is
 * no connection. `asked` is the user pressing "Refresh". Where the settings
 * of Units say not to go online, only what was kept is used.
 */
export function refreshRates(host: Host, asked = false): Promise<void> {
  pending ??= (async () => {
    change({ reading: true });
    try {
      const answer = await host.invoke<Answer>('rates', { kept: handed ? null : (host.loadData<unknown>(DATA_KEY) ?? null), asked, offline: !loadSettings(host).ratesOnline });
      handed = true;
      host.saveData(DATA_KEY, answer.keep);
      change({ fiat: answer.fiat, coins: answer.coins, failed: answer.failed, reading: false, version: state.version + (answer.changed ? 1 : 0) });
    } catch {
      change({ reading: false, failed: ['fiat', 'coins'] });
    } finally {
      pending = null;
    }
  })();
  return pending;
}
