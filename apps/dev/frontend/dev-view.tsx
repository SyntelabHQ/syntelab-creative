import { useTranslation } from '@syntelab/i18n';
import { useTabCommands } from '@syntelab/shell-api';
import type { AppViewProps } from '@syntelab/shell-api';
import { useMemo, useState } from 'react';
import { devCommands } from './commands';
import styles from './dev-view.module.css';
import { LaunchedFiles } from './frame/launched-files';
import { readSplit } from './frame/layout';
import type { ToolLayout } from './frame/layout';
import type { ToolActions } from './frame/text-tool';
import { ToolFrame } from './frame/tool-frame';
import { pinsOf, savePins } from './pins/pins-store';
import { LAST_TOOL_KEY, useDevSettings } from './settings/dev-settings';
import { DevStart } from './start/dev-start';
import { launchedBy } from './start/launched';
import { toolById } from './tools/catalog';

// How the frame of a tool is laid out, each under a key of its own.
const SIDE_BY_SIDE_KEY = 'sideBySide';
const LINE_NUMBERS_KEY = 'lineNumbers';
const WRAP_KEY = 'wrap';
const SPLIT_KEY = 'split';

/**
 * One Dev tab. It opens on the first page, where every tool is; choosing a
 * tool there or from the menus shows it in the tab, or in a tab of its own
 * when the settings say so (such a tab opens on its tool). Nothing that is
 * typed in a tool is kept: only the pins, the options of the tools and how
 * the frame is laid out are.
 *
 * A tab opened from outside the program (an entry of the file manager's
 * right-click menu, a file opened with the program) opens on the tool that
 * is for it, which starts with the files.
 */
export function DevView({ host }: AppViewProps) {
  const t = useTranslation();
  const settings = useDevSettings(host);
  /** What the tab was opened with from outside the program, until the user goes elsewhere in it. */
  const [launch, setLaunch] = useState(() => {
    const launched = launchedBy(host.params);
    if (!launched || !toolById(launched.tool)) return null;
    // A converter is turned toward reading the file, as if the user had chosen so.
    const { turned } = launched;
    if (turned) host.saveData(turned.key, { ...(host.loadData<Record<string, unknown>>(turned.key) ?? {}), ...turned.values });
    return launched;
  });
  /** The tool that is shown; null while the first page is. */
  const [open, setOpen] = useState<string | null>(() => {
    if (launch) return launch.tool;
    if (host.params.tool !== undefined && toolById(host.params.tool)) return host.params.tool;
    // A new tab opens on the tool used last, when the settings say so: its name is kept, nothing that was in it.
    const last = settings.startOn === 'last' ? host.loadData<unknown>(LAST_TOOL_KEY) : null;
    return typeof last === 'string' && toolById(last) ? last : null;
  });
  const [pins, setPins] = useState(() => pinsOf(host));
  const [sideBySide, setSideBySide] = useState(() => host.loadData<boolean>(SIDE_BY_SIDE_KEY) !== false);
  // Line numbers are shown unless they were turned off; long lines are wrapped only once that was turned on.
  const [lineNumbers, setLineNumbers] = useState(() => host.loadData<boolean>(LINE_NUMBERS_KEY) !== false);
  const [wrap, setWrap] = useState(() => host.loadData<boolean>(WRAP_KEY) === true);
  const [split, setSplit] = useState(() => readSplit(host.loadData<unknown>(SPLIT_KEY)));
  /** What the commands do with the tool that is shown; null when it is not built, or on the first page. */
  const [actions, setActions] = useState<ToolActions | null>(null);

  const togglePin = (id: string) => {
    const next = pins.includes(id) ? pins.filter((known) => known !== id) : [...pins, id];
    setPins(next);
    savePins(host, next);
  };

  const { sameTab } = settings;
  const showTool = (id: string) => {
    host.saveData(LAST_TOOL_KEY, id);
    if (sameTab) setLaunch(null);
    if (sameTab) setOpen(id);
    else host.openTab({ key: `tool:${id}`, title: t(`dev.tool.${id}`), params: { tool: id } });
  };

  /** Turns one choice of the View menu over, and keeps it. */
  const turned = (key: string, now: boolean, set: (value: boolean) => void) => () => {
    set(!now);
    host.saveData(key, !now);
  };

  const pinned = open !== null && pins.includes(open);
  const commands = useMemo(
    () =>
      devCommands({
        openTool: open,
        actions,
        sideBySide,
        onSideBySide: turned(SIDE_BY_SIDE_KEY, sideBySide, setSideBySide),
        lineNumbers,
        onLineNumbers: turned(LINE_NUMBERS_KEY, lineNumbers, setLineNumbers),
        wrap,
        onWrap: turned(WRAP_KEY, wrap, setWrap),
        pinned,
        onPin: () => open !== null && togglePin(open),
        onTool: showTool,
        onStart: () => {
          setLaunch(null);
          setOpen(null);
        },
        onClose: () => host.closeTab(),
      }),
    // `host` changes when the tab moves to the back; what it does, does not.
    [open, actions, sideBySide, lineNumbers, wrap, pinned, pins, sameTab, host.closeTab, host.saveData, host.openTab, t],
  );
  useTabCommands(host, commands);

  const layout = useMemo<ToolLayout>(
    () => ({
      sideBySide,
      lineNumbers,
      wrap,
      split,
      onSplit: (value) => {
        setSplit(value);
        host.saveData(SPLIT_KEY, value);
      },
    }),
    [sideBySide, lineNumbers, wrap, split, host.saveData],
  );

  const tool = open === null ? undefined : toolById(open);
  return (
    <LaunchedFiles.Provider value={launch !== null && launch.tool === open ? launch : null}>
      <div className={styles.tab}>{tool ? <ToolFrame host={host} tool={tool} layout={layout} onActions={setActions} /> : <DevStart pins={pins} onPin={togglePin} onOpen={showTool} />}</div>
    </LaunchedFiles.Provider>
  );
}
