import { useTranslation } from '@syntelab/i18n';
import { useContext, useState } from 'react';
import { BatchView } from './batch-view';
import type { BatchViewProps } from './batch-view';
import { Choice } from './choice';
import { LaunchedFiles } from './launched-files';
import { TextTool } from './text-tool';
import type { FileToLoad, TextToolProps } from './text-tool';
import styles from './tool-frame.module.css';

/** What a tool works on: a text (typed, pasted, or one file), or many files in one run. */
const SOURCES = ['text', 'files'] as const;
type Source = (typeof SOURCES)[number];

export interface ToolBodyProps extends Omit<TextToolProps, 'active' | 'lead'> {
  /** What the tool needs to work on many files in one run; left out by a tool that has no use for it. */
  readonly batch?: Pick<BatchViewProps, 'naming' | 'onlyReads' | 'run' | 'check' | 'wrongText'>;
}

/**
 * A tool that takes a text and gives a text, with both ways of feeding it:
 * a text (or one file) with its result beside it, and many files in one run.
 * The first choice in the line of options goes from one to the other. Both
 * are kept as they are while the other is shown: going to the files and back
 * loses nothing that was typed.
 *
 * A tool opened from outside the program with files (the right-click menu
 * of the file manager) starts with them: one is opened as the text, several
 * are listed to be worked on in one run.
 */
export function ToolBody({ batch, ...tool }: ToolBodyProps) {
  const t = useTranslation();
  const given = useContext(LaunchedFiles);
  // Taken once, when the tool is made: what the tab was opened with is not opened again.
  const [many] = useState(() => (batch && given && (given.listed || given.files.length > 1) ? given.files : undefined));
  const [one] = useState<FileToLoad | undefined>(() => (!many && given?.files[0] !== undefined ? { path: given.files[0] } : undefined));
  const [source, setSource] = useState<Source>(many ? 'files' : 'text');
  // A tool that works on one text only has no such choice: it is the frame of a text, and nothing more.
  if (!batch) return <TextTool {...tool} load={tool.load ?? one} active />;

  const lead = <Choice label={t('dev.frame.source')} value={source} options={SOURCES.map((value) => ({ value, label: t(`dev.frame.source.${value}`) }))} onChange={setSource} />;

  return (
    <>
      <div className={styles.mode} hidden={source !== 'text'}>
        <TextTool {...tool} load={tool.load ?? one} active={source === 'text'} lead={lead} />
      </div>
      <div className={styles.mode} hidden={source !== 'files'}>
        <BatchView host={tool.host} layout={tool.layout} active={source === 'files'} lead={lead} options={tool.options} optionsKey={tool.optionsKey} tellsOnly={tool.tellsOnly || batch.onlyReads === true} opens={tool.opens} shows={tool.resultFits === true} add={many} workTitle={tool.workTitle} onActions={tool.onActions} preview={{ run: tool.run, writesNothing: tool.tellsOnly || tool.resultFits === true, syntax: tool.outputSyntax }} {...batch} />
      </div>
    </>
  );
}
