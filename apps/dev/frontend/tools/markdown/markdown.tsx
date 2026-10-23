import { useTranslation } from '@syntelab/i18n';
import { useCallback, useState } from 'react';
import type { MouseEvent } from 'react';
import { CodecTool } from '../codec-tool';
import type { ToolProps } from '../registry';
import styles from './markdown.module.css';

/**
 * Markdown as it will look, and as HTML to copy or save: CommonMark with
 * tables, strikethrough, task lists and footnotes. The Rust side writes the
 * HTML, and writes only what is safe to show: HTML typed inside the
 * Markdown is shown as text, and a picture that would be fetched from the
 * network is not fetched (its words and its address stand in its place).
 * A link that is clicked is handed to the system, which opens it in the
 * browser.
 */
export default function Markdown(props: ToolProps) {
  const t = useTranslation();
  const [html, setHtml] = useState<string | null>(null);
  const read = useCallback((text: string | null) => setHtml(text), []);

  /** A link in the preview is not followed inside the program: the browser of the system opens it. One to a place in the page (a footnote) scrolls the preview there. */
  const follow = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest('a');
    if (!link) return;
    event.preventDefault();
    const address = link.getAttribute('href') ?? '';
    if (address.startsWith('#')) {
      let id = address.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // Kept as it is written.
      }
      const escaped = CSS.escape(id);
      event.currentTarget.querySelector(`[id="${escaped}"], a[name="${escaped}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    if (/^(https?:|mailto:)/i.test(address)) void props.host.openLink(address).catch(() => {});
  };

  return (
    <CodecTool
      {...props}
      tool="markdown"
      options={{}}
      optionsView={null}
      reads={false}
      outputSyntax="html"
      onText={read}
      extra={{
        label: t('dev.markdown.preview'),
        resultLabel: 'HTML',
        first: true,
        view:
          html === null || html === '' ? (
            <p className={styles.note}>{t('dev.markdown.empty')}</p>
          ) : (
            // What the Rust side wrote holds no script and no HTML of the user's own: see `markdown.rs`.
            <div className={styles.preview} onClick={follow} dangerouslySetInnerHTML={{ __html: html }} />
          ),
      }}
      opens={{ typeName: t('dev.markdown.files'), extensions: ['md', 'markdown', 'txt'] }}
      saves={{ typeName: t('dev.entities.files'), extension: 'html', name: (name) => `${name?.replace(/\.[^.]+$/, '') ?? 'page'}.html` }}
      naming={{ beside: { ending: 'html' }, inFolder: { ending: 'html' }, example: 'name.html', noReplace: true }}
      fine={t('dev.markdown.fine')}
      workTitle={t('dev.markdown.working')}
    />
  );
}
