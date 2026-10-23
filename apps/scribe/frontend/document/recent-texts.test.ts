import { describe, expect, it } from 'vitest';
import { loadRecentTexts, MOST_RECENT_TEXTS, rememberText, withRecentText } from './recent-texts';

function storage() {
  const kept = new Map<string, unknown>();
  return { loadData: <T>(key: string) => kept.get(key) as T | undefined, saveData: (key: string, value: unknown) => void kept.set(key, JSON.parse(JSON.stringify(value))) };
}

describe('recent texts', () => {
  it('have the last one first, each once', () => {
    const texts = withRecentText(withRecentText(withRecentText([], 'a.txt', 1), 'b.txt', 2), 'a.txt', 3);
    expect(texts).toEqual([
      { path: 'a.txt', openedAt: 3 },
      { path: 'b.txt', openedAt: 2 },
    ]);
  });

  it('are no more than are kept', () => {
    let texts = withRecentText([], 'first.txt', 0);
    for (let index = 1; index <= MOST_RECENT_TEXTS; index++) texts = withRecentText(texts, `${index}.txt`, index);
    expect(texts.length).toBe(MOST_RECENT_TEXTS);
    expect(texts.some((text) => text.path === 'first.txt')).toBe(false);
  });

  it('are found again, and what is not one is left out', () => {
    const host = storage();
    rememberText(host, 'C:\\notes\\list.txt');
    expect(loadRecentTexts(host).map((text) => text.path)).toEqual(['C:\\notes\\list.txt']);
    host.saveData('recent-texts', [{ path: 'ok.txt', openedAt: 5 }, { path: 7 }, 'x', { path: '', openedAt: 1 }]);
    expect(loadRecentTexts(host)).toEqual([{ path: 'ok.txt', openedAt: 5 }]);
    host.saveData('recent-texts', 'nothing');
    expect(loadRecentTexts(host)).toEqual([]);
  });
});
