import { buildMenus, orderMenus } from '@syntelab/command-registry';
import { useI18n } from '@syntelab/i18n';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useApps } from '../apps';
import { FIRST_MENUS, LAST_MENUS, shortcutLabel } from '../commands';
import { openExternal } from '../platform/open-external';
import { useStore } from '../state/create-store';
import { APP_VERSION } from '../updates';
import styles from './help-view.module.css';
import { helpCommands, helpFolded, helpPlace, setHelpFolded } from './help-state';
import type { HelpPlace } from './help-state';
import { searchManuals, SHELL_MANUAL } from './manual';
import type { Manual, ManualBlock, ManualChapter, ManualTopic } from './manual';
import { loadManuals } from './manual-files';

/** The ids of the parts of the contents that are not a manual. */
const ABOUT_PART = 'about';
const COMMANDS_PART = 'commands';

/** Text of a manual with the web addresses in it as links: a click hands the address to the system's browser. */
function linked(text: string): ReactNode {
  const parts = text.split(/(https?:\/\/[^\s)„”"]+)/g);
  if (parts.length === 1) return text;
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <a
        key={index}
        href={part}
        className={styles.link}
        onClick={(event) => {
          event.preventDefault();
          void openExternal(part);
        }}
      >
        {part.replace(/^https?:\/\/(www\.)?/, '')}
      </a>
    ) : (
      part
    ),
  );
}

function Block({ block }: { block: ManualBlock }) {
  if (typeof block === 'string') return <p>{linked(block)}</p>;
  if ('steps' in block) {
    return (
      <ol className={styles.steps}>
        {block.steps.map((step, index) => (
          <li key={index}>{linked(step)}</li>
        ))}
      </ol>
    );
  }
  if ('points' in block) {
    return (
      <ul className={styles.points}>
        {block.points.map((point, index) => (
          <li key={index}>{linked(point)}</li>
        ))}
      </ul>
    );
  }
  return (
    <p className={styles.note}>
      <Icon name="circle-info" size={16} />
      <span>{linked(block.note)}</span>
    </p>
  );
}

/** One part of the contents ("About", a manual, the commands): its name, and what is in it, which can be folded away. */
function Part({ id, title, folded, children }: { id: string; title: string; folded: readonly string[]; children: ReactNode }) {
  return (
    <details
      className={styles.part}
      open={!folded.includes(id)}
      onToggle={(event) => {
        // Only its own folding: the chapters inside it fold on their own.
        if (event.target === event.currentTarget) setHelpFolded(id, !event.currentTarget.open);
      }}
    >
      <summary className={styles.manual}>{title}</summary>
      {children}
    </details>
  );
}

/**
 * Help, in a tab of its own, so it can be read beside the work: the manual
 * of the program and of its apps, with a table of contents and a search, and
 * every command of the tab it was opened from with what it does. Everything
 * in it is in the program: nothing is fetched.
 */
export function HelpView() {
  const { t, has, fallbackChain } = useI18n();
  const [read, setManuals] = useState<readonly Manual[]>([]);
  // The program first, then the apps in the order the user arranged them on Start: the same as everywhere they are listed.
  const { apps } = useApps();
  const manuals = useMemo(() => {
    const place = (manual: Manual) => (manual.id === SHELL_MANUAL ? -1 : ((index) => (index === -1 ? apps.length : index))(apps.findIndex((app) => app.manifest.id === manual.id)));
    return [...read].sort((one, other) => place(one) - place(other));
  }, [read, apps]);
  // Where the reader is, kept while the tab is at the back: coming back finds the same topic.
  const { shown, query, goTo, scope } = useStore(helpPlace);
  /** The Help of the program: what it and each app say of themselves, and its own manual. Else the Help of one app: its manual. */
  const ofProgram = scope === SHELL_MANUAL;
  const folded = useStore(helpFolded);
  const setShown = (next: HelpPlace['shown']) => helpPlace.set((place) => ({ ...place, shown: next }));
  const setQuery = (next: string) => helpPlace.set((place) => ({ ...place, query: next }));
  const commands = useStore(helpCommands);
  const contents = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    void loadManuals(fallbackChain).then((loaded) => !cancelled && setManuals(loaded));
    return () => {
      cancelled = true;
    };
    // Read again when the language of the program changes.
  }, [fallbackChain.join()]);

  // Asked to open at the manual of an app, or at what it says about itself: go there once the manuals are read.
  useEffect(() => {
    if (manuals.length === 0) return;
    if (!goTo) {
      // Opened for the first time with nowhere asked for: the first page of the first manual.
      const first = manuals[0]?.chapters.find((chapter) => !chapter.about)?.topics[0];
      if (!shown && manuals[0] && first) setShown({ kind: 'topic', manual: manuals[0].id, topic: first.id });
      return;
    }
    // Already reading in that manual: the reader's place is kept (they went to their work and came back).
    const reading = shown?.kind === 'topic' && shown.manual === goTo.manual ? manuals.find((known) => known.id === goTo.manual)?.chapters.find((chapter) => chapter.topics.some((known) => known.id === shown.topic)) : undefined;
    if (reading && Boolean(reading.about) === goTo.about) {
      setHelpFolded(goTo.about ? ABOUT_PART : goTo.manual, false);
      return helpPlace.set((place) => ({ ...place, goTo: null }));
    }
    const wanted = (manual: Manual | undefined) => manual?.chapters.find((chapter) => Boolean(chapter.about) === goTo.about)?.topics[0];
    // An app without a manual (or without an "About" of its own) leads to the program's.
    const manual = [manuals.find((known) => known.id === goTo.manual), manuals.find((known) => known.id === SHELL_MANUAL), manuals[0]].find((known) => wanted(known));
    const topic = wanted(manual);
    setHelpFolded(goTo.about ? ABOUT_PART : (manual?.id ?? ''), false);
    // An app without a manual of its own is answered with the program's Help, not with an empty one.
    helpPlace.set((place) => ({ ...place, goTo: null, scope: goTo.about || !manual ? SHELL_MANUAL : manual.id, shown: manual && topic ? { kind: 'topic', manual: manual.id, topic: topic.id } : place.shown }));
  }, [manuals, goTo]);

  // What is in view is in view in the contents too.
  useEffect(() => {
    contents.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [shown, manuals]);

  // The commands of the tab Help was opened from, by menu.
  const menus = useMemo(() => orderMenus(buildMenus(commands), FIRST_MENUS, LAST_MENUS), [commands]);
  // Only what this Help holds is searched: an app's own pages, or the program's and what is said about each app.
  const found = useMemo(
    () => searchManuals(manuals, query).filter(({ manual, chapter }) => (ofProgram ? manual.id === SHELL_MANUAL || Boolean(chapter.about) : manual.id === scope && !chapter.about)),
    [manuals, query, scope, ofProgram],
  );
  const searching = query.trim() !== '';

  let topic: ManualTopic | undefined;
  if (shown?.kind === 'topic') topic = manuals.find((manual) => manual.id === shown.manual)?.chapters.flatMap((chapter) => chapter.topics).find((known) => known.id === shown.topic);
  const menu = shown?.kind === 'menu' ? menus.find((known) => known.menuKey === shown.menuKey) : undefined;
  const isShown = (manual: string, id: string) => shown?.kind === 'topic' && shown.manual === manual && shown.topic === id;

  /** A chapter as a list of its topics that can be folded; open while one of them is in view. */
  const chapterOf = (manual: Manual, chapter: ManualChapter, title: string) => (
    <details key={`${manual.id}/${chapter.title}`} className={styles.chapter} open={chapter.topics.some((known) => isShown(manual.id, known.id)) || undefined}>
      <summary>{title}</summary>
      <ul className={styles.topics}>
        {chapter.topics.map((known) => (
          <li key={known.id}>
            <button type="button" className={styles.topic} aria-current={isShown(manual.id, known.id)} onClick={() => setShown({ kind: 'topic', manual: manual.id, topic: known.id })}>
              {known.title}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );

  return (
    <div className={styles.help}>
      <nav ref={contents} className={styles.contents} aria-label={t('shell.help.contents')}>
        <label className={styles.search}>
          <Icon name="magnifying-glass" size={14} />
          <input type="search" value={query} placeholder={t('shell.help.search')} aria-label={t('shell.help.search')} onChange={(event) => setQuery(event.target.value)} />
        </label>

        {searching && (
          <ul className={styles.topics}>
            {found.length === 0 && <li className={styles.nothing}>{t('shell.help.nothingFound')}</li>}
            {found.map(({ manual, chapter, topic: hit }) => (
              <li key={`${manual.id}/${hit.id}`}>
                <button type="button" className={styles.topic} aria-current={isShown(manual.id, hit.id)} onClick={() => setShown({ kind: 'topic', manual: manual.id, topic: hit.id })}>
                  <span>{hit.title}</span>
                  <span className={styles.where}>{chapter.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* What the program and each app say of themselves, together: General first, then one for each app. */}
        {!searching && ofProgram && manuals.some((manual) => manual.chapters.some((chapter) => chapter.about)) && (
          <Part id={ABOUT_PART} title={t('shell.help.about')} folded={folded}>
            {manuals.flatMap((manual) => manual.chapters.filter((chapter) => chapter.about).map((chapter) => chapterOf(manual, chapter, manual.id === SHELL_MANUAL ? t('shell.settings.general') : manual.title)))}
          </Part>
        )}

        {/* The manual of the program in its own Help; in an app's, the manual of that app and no other. */}
        {!searching &&
          manuals.filter((manual) => manual.id === scope).map((manual) => (
            <Part key={manual.id} id={manual.id} title={manual.title} folded={folded}>
              {manual.chapters.filter((chapter) => !chapter.about).map((chapter) => chapterOf(manual, chapter, chapter.title))}
            </Part>
          ))}

        {!searching && !ofProgram && menus.length > 0 && (
          <Part id={COMMANDS_PART} title={t('shell.help.commands')} folded={folded}>
            <ul className={styles.topics}>
              {menus.map((known) => (
                <li key={known.menuKey}>
                  <button type="button" className={styles.topic} aria-current={shown?.kind === 'menu' && shown.menuKey === known.menuKey} onClick={() => setShown({ kind: 'menu', menuKey: known.menuKey })}>
                    {t(known.menuKey)}
                  </button>
                </li>
              ))}
            </ul>
          </Part>
        )}
      </nav>

      <article className={styles.article} key={shown?.kind === 'topic' ? `${shown.manual}/${shown.topic}` : shown?.menuKey}>
        {topic && (
          <>
            <h3 className={styles.heading}>{topic.title}</h3>
            {/* The page about the program says which version this is. */}
            {shown?.kind === 'topic' && shown.manual === SHELL_MANUAL && topic.id === 'about' && <p className={styles.lead}>{t('shell.update.version', { version: APP_VERSION })}</p>}
            {topic.body.map((block, index) => (
              <Block key={index} block={block} />
            ))}
          </>
        )}
        {menu && (
          <>
            <h3 className={styles.heading}>{t('shell.help.commandsOf', { menu: t(menu.menuKey) })}</h3>
            <p className={styles.lead}>{t('shell.help.commandsNote')}</p>
            {menu.groups.map((group) => (
              <section key={group.groupKey} className={styles.group}>
                {group.groupKey !== '' && has(group.groupKey) && <h4 className={styles.groupName}>{t(group.groupKey)}</h4>}
                <dl className={styles.commands}>
                  {group.commands.map((command) => (
                    <div key={command.id} className={styles.command}>
                      <dt>
                        {command.icon && <Icon name={command.icon} size={14} />}
                        <span>{t(command.labelKey).replace(/…$/, '')}</span>
                        {shortcutLabel(command) && <kbd>{shortcutLabel(command)}</kbd>}
                      </dt>
                      {command.hintKey && has(command.hintKey) && <dd>{t(command.hintKey)}</dd>}
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </>
        )}
        {!topic && !menu && <p className={styles.lead}>{t('shell.help.choose')}</p>}
      </article>
    </div>
  );
}
