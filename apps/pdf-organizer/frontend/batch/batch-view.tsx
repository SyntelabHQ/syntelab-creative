import { useI18n } from '@syntelab/i18n';
import type { AppViewProps } from '@syntelab/shell-api';
import { Button, Icon } from '@syntelab/ui-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { emptyTabCommands } from '../commands';
import { CreatePdfDialog } from '../create/create-pdf-dialog';
import { DropHint } from '../document/drop-hint';
import { loadPicture } from '../document/load-picture';
import type { LoadedPicture } from '../document/load-picture';
import { binderStartFiles, openBinderTab } from '../document/open-file';
import { PAGE_SOURCES, PICTURE_TYPES } from '../document/page-sources';
import { useFileCommands } from '../document/use-file-commands';
import { useReceivedFiles } from '../document/use-received-files';
import { todayWritten } from '../insert/page-texts-panel';
import { scaled, textSample, WATERMARK_COLOR } from '../insert/watermark-sample';
import { fitted } from '../marks/measure-text';
import shapeStyles from '../organize/shape-dialog.module.css';
import { useOrganizerSettings } from '../settings/organizer-settings';
import { useCertificateChoice } from '../sign/certificate-picker';
import { signatureWords, useSignatureLooks } from '../sign/look-picker';
import { presetLines } from '../sign/signature-presets';
import { useTabCommands } from '../use-tab-commands';
import { BATCH_OUTPUTS, BATCH_STEPS, canBeOne, commonFolder, DEFAULT_JOB, defaultSuffix, has, inFolder, oneName, resultEnding, resultNames, resultPaths, withStep } from './batch-actions';
import type { BatchJob, BatchOutput, BatchStep } from './batch-actions';
import { loadRecipes, saveRecipes, withRecipe } from './batch-recipes';
import { reportName, reportText } from './batch-report';
import type { BatchRecipe } from './batch-recipes';
import { BatchPreview } from './batch-preview';
import { ColumnSplitter } from './column-splitter';
import { FileList } from './file-list';
import { HeightGrip } from './height-grip';
import { OcrOptions } from './ocr-options';
import { PIXELS_PER_POINT, PreviewZoomBar, readPreviewZoom } from './preview-zoom';
import type { PreviewZoom } from './preview-zoom';
import { RecipeBar } from './recipe-bar';
import { ReplaceDialog } from './replace-dialog';
import { SignOptions } from './sign-options';
import { readSignSettings } from './sign-settings';
import type { SignSettings } from './sign-settings';
import { StepOptions } from './step-options';
import { StepPicker } from './step-picker';
import { useBatchRun } from './use-batch-run';
import type { Outcome } from './use-batch-run';
import styles from './batch-view.module.css';

const OUTPUT_ICONS: Record<BatchOutput, string> = { each: 'copy', one: 'layer-group' };
const NOTHING_TO_DO = () => {};
/** Where the last folder chosen and the choice to open it are kept, for the next time. */
const FOLDER_KEY = 'batchFolder';
const OPEN_FOLDER_KEY = 'batchOpenFolder';
const KEEP_FOLDERS_KEY = 'batchKeepFolders';
const REPORT_KEY = 'batchReport';
/** How the files were last signed: the pages, the place, what the signature says. */
const SIGN_KEY = 'batchSign';
/** How much of the width the files take, as the user dragged it: kept for the next time. */
const SIDE_SHARE_KEY = 'batchSideShare';
const SIDE_SHARE = { least: 0.2, most: 0.7, shipped: 0.4, step: 0.02 };
const sideShare = (share: number) => Math.min(Math.max(share, SIDE_SHARE.least), SIDE_SHARE.most);
/** How tall the user made the list of files, in pixels: kept for the next time. */
const FILES_HEIGHT_KEY = 'batchFilesHeight';
const FILES_HEIGHT = { least: 100, most: 2000 };
/** How large the preview of "Sign many files" was last shown. */
const PREVIEW_ZOOM_KEY = 'batchPreviewZoom';
/** What the preview takes besides the page, in height: the file it shows, the sizes, the pages. */
const PREVIEW_AROUND = 130;
/** The sheet the sizes that fit are worked out for, before a file is there: A4, standing, in points. */
const SHEET = { width: 595, height: 842 };
/** A recipe "Sign many files" can use: it signs, and does nothing else. */
const signsOnly = (recipe: BatchRecipe) => recipe.job.steps.length === 1 && recipe.job.steps[0] === 'sign';

/**
 * Batch processing, in a tab of its own: the same things done to many files,
 * one after another. The files are on one side, each with how it went; what
 * is done to them and where the results go are on the other. Each result is
 * a new file. When results would take the place of files already there (the
 * files themselves, written to their own folder under the same names), the
 * user is asked first whether to replace them.
 *
 * The results go to the folder the user chose for this list; until one is
 * chosen, to the folder all the files come from, or else to the last folder
 * chosen.
 *
 * Opened as "Sign many files" (`signing`), the same tab only signs: the
 * signature's choices are shown straight away, with no other step to pick, and
 * the preview stays beside the files, as wide as their column.
 */
export function BatchView({ host }: AppViewProps) {
  const { t, language } = useI18n();
  const { pickFiles, pickFolder } = host;
  const [files, setFiles] = useState<readonly string[]>(() => binderStartFiles(host.params));
  /**
   * Asked for with a thing to do, the tab starts with it chosen: `kind`, or `batch` itself naming it (as the search of
   * the Start page opens it, one tab for each thing).
   */
  const signOnly = host.params.signing === '1';
  const asked = signOnly ? 'sign' : BATCH_STEPS.find((step) => step === (host.params.kind ?? host.params.batch));
  const title = t(signOnly ? 'pdf-organizer.command.signBatch' : 'pdf-organizer.command.batch');
  const [job, setJob] = useState<BatchJob>(() => (asked ? { ...DEFAULT_JOB, steps: withStep(DEFAULT_JOB.steps, asked, true) } : DEFAULT_JOB));
  /** The step whose choices are in view. */
  const [shown, setShown] = useState<BatchStep>(asked ?? 'compress');
  const [output, setOutput] = useState<BatchOutput>('each');
  /** What is added to each name; null while the usual one of the job is used. */
  const [added, setAdded] = useState<string | null>(null);
  const [one, setOne] = useState('');
  /** The folder chosen for this list of files; null until one is chosen. */
  const [chosenFolder, setChosenFolder] = useState<string | null>(null);
  const [lastFolder, setLastFolder] = useState(() => host.loadData<string>(FOLDER_KEY) ?? '');
  const [openFolder, setOpenFolder] = useState(() => host.loadData<boolean>(OPEN_FOLDER_KEY) ?? true);
  /** For the files that came with a folder: where each lies under it. */
  const [under, setUnder] = useState<ReadonlyMap<string, string>>(new Map());
  const [keepFolders, setKeepFolders] = useState(() => host.loadData<boolean>(KEEP_FOLDERS_KEY) ?? true);
  const [report, setReport] = useState(() => host.loadData<boolean>(REPORT_KEY) ?? false);
  const [sign, setSign] = useState<SignSettings>(() => readSignSettings(host.loadData<unknown>(SIGN_KEY)));
  const [recipes, setRecipes] = useState<readonly BatchRecipe[]>(() => loadRecipes(host));
  const [recipeId, setRecipeId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  /** The files the run would write over, while the user is asked what to do with them. */
  const [existing, setExisting] = useState<readonly string[]>([]);
  /** True while they are looked for. */
  const [looking, setLooking] = useState(false);
  /** The file shown in the preview. */
  const [previewed, setPreviewed] = useState(0);
  const [share, setShare] = useState(() => sideShare(host.loadData<number>(SIDE_SHARE_KEY) ?? SIDE_SHARE.shipped));
  /** How wide the side with the files is drawn, for the preview it holds. */
  const side = useRef<HTMLElement>(null);
  const [filesHeight, setFilesHeight] = useState<number | null>(() => {
    const kept = host.loadData<unknown>(FILES_HEIGHT_KEY);
    return typeof kept === 'number' ? kept : null;
  });
  const [sideRoom, setSideRoom] = useState({ width: 0, height: 0 });
  const [previewZoom, setPreviewZoom] = useState<PreviewZoom>(() => readPreviewZoom(host.loadData<unknown>(PREVIEW_ZOOM_KEY)));
  const { combinedName, timeStampSignatures, timeStampServer } = useOrganizerSettings(host);
  const run = useBatchRun(host);
  const { running, outcomes } = run;
  const signing = has(job, 'sign');
  // Looked up once, when the tab opens: a recipe can then choose among them.
  const certificate = useCertificateChoice(host, true);
  const looks = useSignatureLooks(host, true);

  // The same file commands as any tab without a document of its own.
  const fileCommands = useFileCommands(host, NOTHING_TO_DO);
  const commands = useMemo(() => emptyTabCommands(fileCommands.commands, () => openBinderTab(host, t('pdf-organizer.binder.title'))), [fileCommands.commands, host, t]);
  useTabCommands(host, commands);

  const addPaths = (paths: readonly string[]) => setFiles((current) => [...current, ...paths.filter((path) => !current.includes(path))]);
  // Files dropped on the tab or pasted join the list.
  const filesOver = useReceivedFiles(host, (received) => {
    if (!running) addPaths(received.paths);
  });

  const suffix = added ?? defaultSuffix(job);
  const filesFolder = commonFolder(files, under);
  const folder = chosenFolder ?? filesFolder ?? lastFolder;
  const shownFile = Math.min(previewed, Math.max(files.length - 1, 0));
  const gathered = output === 'one' && canBeOne(job);
  const change = (part: Partial<BatchJob>) => setJob((current) => ({ ...current, ...part }));
  const words = { page: t('pdf-organizer.numbers.wordsPage'), pageOf: t('pdf-organizer.numbers.wordsPageOf') };
  const moment = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  const facts = { signer: certificate.signer ?? t('pdf-organizer.sign.look.yourName'), moment, reason: sign.reason.trim(), location: sign.location.trim() };
  const tools = { words, fitted, sample: (text: string) => textSample(text, WATERMARK_COLOR, 'sans'), scaled, today: todayWritten(language) };

  // Kept once the bar stops moving, not at each step of a drag.
  useEffect(() => {
    const saving = window.setTimeout(() => host.saveData(SIDE_SHARE_KEY, share), 300);
    return () => window.clearTimeout(saving);
  }, [host, share]);

  useEffect(() => {
    const saving = window.setTimeout(() => host.saveData(FILES_HEIGHT_KEY, filesHeight), 300);
    return () => window.clearTimeout(saving);
  }, [host, filesHeight]);

  useEffect(() => {
    const element = side.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => entry && setSideRoom({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const counted = [...outcomes.values()];
  const done = counted.filter((outcome) => outcome.state === 'done').length;
  const failed = counted.filter((outcome) => outcome.state === 'failed').length;
  const finished = done + failed;

  const addFiles = async () => addPaths(await pickFiles({ typeName: t('pdf-organizer.batch.fileType'), extensions: [...PAGE_SOURCES], multiple: true }));
  /** Adds the files of a folder and of the folders under it. */
  const addFolder = async () => {
    const chosen = await pickFolder();
    if (chosen === null) return;
    try {
      const found = await host.invoke<{ files: { path: string; under: string }[]; more: boolean }>('list_folder', { path: chosen, endings: [...PAGE_SOURCES] });
      addPaths(found.files.map((file) => file.path));
      setUnder((current) => new Map([...current, ...found.files.filter((file) => file.under !== '').map((file) => [file.path, file.under] as const)]));
      setProblem(found.more ? 'pdf-organizer.batch.tooManyFiles' : found.files.length === 0 ? 'pdf-organizer.batch.emptyFolder' : null);
    } catch {
      setProblem('pdf-organizer.batch.folderNotRead');
    }
  };
  const keepFolder = (chosen: string) => {
    setChosenFolder(chosen);
    setLastFolder(chosen);
    host.saveData(FOLDER_KEY, chosen);
  };
  const chooseFolder = async () => {
    const chosen = await pickFolder();
    if (chosen !== null) keepFolder(chosen);
  };
  const move = (index: number, by: number) =>
    setFiles((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved !== undefined) next.splice(index + by, 0, moved);
      return next;
    });
  const pickPicture = async (): Promise<LoadedPicture | null> => {
    const [chosen] = await pickFiles({ typeName: t('pdf-organizer.place.pictureType'), extensions: [...PICTURE_TYPES] });
    if (!chosen) return null;
    return loadPicture(host, chosen).catch(() => null);
  };
  const showFolder = (path: string) => void host.showInFolder(path).catch(() => setProblem('pdf-organizer.batch.folderNotOpened'));

  /** Sets everything as a recipe has it. The certificate and the look are chosen when they are still there. */
  const applyRecipe = (recipe: BatchRecipe | null) => {
    setRecipeId(recipe?.id ?? '');
    if (!recipe) return;
    setJob(recipe.job);
    setShown(recipe.job.steps[0] ?? shown);
    setOutput(recipe.output);
    setAdded(recipe.added);
    setOne(recipe.oneName);
    setSign(recipe.sign);
    if (recipe.folder !== '') keepFolder(recipe.folder);
    if (recipe.certificateId !== '') certificate.choose(recipe.certificateId);
    if (recipe.presetId !== '') looks.choose(recipe.presetId);
  };
  const changeSign = (part: Partial<SignSettings>) =>
    setSign((current) => {
      const next = { ...current, ...part };
      host.saveData(SIGN_KEY, next);
      return next;
    });
  const storeRecipes = (next: readonly BatchRecipe[]) => {
    setRecipes(next);
    saveRecipes(host, next);
  };
  const saveRecipe = (name: string) => {
    const id = `recipe-${Date.now().toString(36)}`;
    // A certificate in a file is not kept: its password is asked for each time.
    const certificateId = certificate.chosen !== 'file' ? certificate.chosen : '';
    // A folder taken from the files is not kept: the next files may be elsewhere.
    const kept = chosenFolder ?? (filesFolder === null ? folder : '');
    const next = withRecipe(recipes, { id, name, job, output, added, oneName: one, folder: kept, sign, certificateId, presetId: looks.preset.id });
    storeRecipes(next);
    setRecipeId(next.find((recipe) => recipe.name === name)?.id ?? id);
  };

  /** Writes what the run did as a text file beside the results. */
  const writeReport = async (ended: ReadonlyMap<string, Outcome>) => {
    const text = reportText(files, ended, { moment, steps: job.steps.length === 0 ? t('pdf-organizer.batch.onlyPdf') : job.steps.map((step) => t(`pdf-organizer.batch.kind.${step}`)).join(', '), folder }, {
      title,
      done: t('pdf-organizer.batch.action'),
      folder: t('pdf-organizer.batch.folder'),
      written: t('pdf-organizer.batch.report.written'),
      failed: t('pdf-organizer.batch.report.failed'),
      notReached: t('pdf-organizer.batch.report.notReached'),
      problem: t,
    });
    await host.invoke('write_report', { destination: inFolder(folder, reportName(new Date())), text }).catch(() => setProblem('pdf-organizer.batch.reportNotWritten'));
  };

  const resultUnder = keepFolders && !gathered ? under : new Map<string, string>();
  const gatheredName = oneName(one.trim() === '' ? combinedName : one);

  /** Looks for files where the results go first: when there are any, the user is asked what to do with them. */
  const begin = async () => {
    setProblem(null);
    const destinations = gathered ? [inFolder(folder, gatheredName)] : resultPaths(files, resultUnder, folder, resultNames(files, suffix, resultEnding(job)));
    setLooking(true);
    // Not known: they are left alone, as each one is then found.
    const found = await host
      .invoke<{ existing: string[] }>('existing_files', { paths: destinations })
      .then(
        (answer) => answer.existing,
        () => [],
      )
      .finally(() => setLooking(false));
    if (found.length > 0) setExisting(found);
    else await start(false);
  };

  const start = async (replace: boolean) => {
    setProblem(null);
    // The certificate is settled before anything is written: a wrong password stops here.
    const settled = signing ? await certificate.settle() : null;
    if (signing && !settled) return;
    if (signing) looks.remember();
    const { first, outcomes: ended } = await run.start({
      files,
      under: resultUnder,
      job,
      output: gathered ? 'one' : 'each',
      folder,
      suffix,
      oneName: one.trim() === '' ? combinedName : one,
      replace,
      signing: settled ? { ...settled, reason: sign.reason.trim(), location: sign.location.trim(), lock: sign.lock, timeStamp: timeStampSignatures ? timeStampServer : null, pages: sign.pages, spot: sign.spot, preset: looks.preset, moment, words: signatureWords(t) } : null,
      tools,
    });
    if (report && first !== null) await writeReport(ended);
    if (first !== null && openFolder) showFolder(first);
  };

  const missing = files.length === 0 ? 'pdf-organizer.batch.needFiles' : folder === '' ? 'pdf-organizer.batch.needFolder' : signing && !certificate.ready ? 'pdf-organizer.batch.needCertificate' : has(job, 'ocr') && job.ocrLanguages.length === 0 ? 'pdf-organizer.batch.needLanguages' : null;
  const sample = gathered ? gatheredName : (resultNames(['Document.pdf'], suffix, resultEnding(job))[0] ?? '');
  const shownProblem = problem ?? run.problem;

  /** While the place of the signature is chosen, the files are shown beside it, and the box is moved on them. */
  const previewBeside = !signOnly && signing && shown === 'sign' && sign.pages !== 'none';
  /** Signing only, the preview is as large as the user chose: fitting the column of the files, or a share of the size on paper. */
  const room = { width: Math.max(sideRoom.width, 200), height: Math.max(sideRoom.height - PREVIEW_AROUND, 240) };
  const box = previewZoom === 'page' ? room : { width: room.width, height: Number.MAX_SAFE_INTEGER };
  const shownZoom = typeof previewZoom === 'number' ? previewZoom : Math.min(box.width / SHEET.width, box.height / SHEET.height) / PIXELS_PER_POINT;
  const zoomTo = (zoom: PreviewZoom) => {
    setPreviewZoom(zoom);
    host.saveData(PREVIEW_ZOOM_KEY, zoom);
  };
  const preview = (
    <BatchPreview
      host={host}
      files={files}
      index={shownFile}
      onIndexChange={setPreviewed}
      job={job}
      tools={tools}
      signature={signing ? { settings: sign, picture: looks.preset.picture, lines: presetLines(looks.preset, facts, signatureWords(t)) } : null}
      onSpotChange={(spot) => changeSign({ spot })}
      disabled={running}
      width={signOnly ? box.width : previewBeside ? 360 : 240}
      height={signOnly ? box.height : previewBeside ? 480 : 300}
      pixelsPerPoint={signOnly && typeof previewZoom === 'number' ? previewZoom * PIXELS_PER_POINT : undefined}
      wheelTurnsPages={!signOnly}
    />
  );

  return (
    <div className={styles.view}>
      <DropHint shown={filesOver} textKey="pdf-organizer.batch.dropHere" />
      <CreatePdfDialog host={host} open={fileCommands.creating} onClose={fileCommands.closeCreating} onDone={NOTHING_TO_DO} />
      <ReplaceDialog existing={existing} canSkip={!gathered} onClose={() => setExisting([])} onChoose={(replace) => void start(replace)} />

      <div className={styles.columns} style={{ '--side-share': share } as CSSProperties}>
        <section ref={side} className={styles.side} aria-labelledby="batch-files">
          <header className={styles.sideHead}>
            <h1 id="batch-files" className={styles.title}>
              {title}
            </h1>
            <span className={styles.count}>{t('pdf-organizer.batch.files', { count: files.length })}</span>
          </header>
          <span className={styles.buttons}>
            <Button variant={files.length === 0 ? 'primary' : undefined} disabled={running} onClick={() => void addFiles()}>
              <Icon name="folder-plus" size={14} />
              {t('pdf-organizer.batch.add')}
            </Button>
            <Button disabled={running} onClick={() => void addFolder()}>
              <Icon name="folder-tree" size={14} />
              {t('pdf-organizer.batch.addFolder')}
            </Button>
            <Button
              disabled={running || files.length === 0}
              onClick={() => {
                setFiles([]);
                setUnder(new Map());
                // A new list, a new folder: until one is chosen, the one its files come from.
                setChosenFolder(null);
                run.clear();
              }}
            >
              {t('pdf-organizer.batch.clear')}
            </Button>
          </span>
          <FileList files={files} outcomes={outcomes} ordered={gathered} disabled={running} onMove={move} onRemove={(path) => setFiles((current) => current.filter((other) => other !== path))} selected={shownFile} onSelect={setPreviewed} height={filesHeight} />
          <HeightGrip label={t('pdf-organizer.batch.resizeFiles')} onHeight={(height) => setFilesHeight(Math.round(Math.min(Math.max(height, FILES_HEIGHT.least), FILES_HEIGHT.most)))} onReset={() => setFilesHeight(null)} />
          {signOnly && <PreviewZoomBar zoom={previewZoom} shown={shownZoom} onChange={zoomTo} />}
          {!previewBeside && preview}
          <p className={styles.tip}>{t('pdf-organizer.batch.safeTip')}</p>
        </section>

        <ColumnSplitter label={t('pdf-organizer.batch.resizeColumns')} onMove={(next) => setShare(sideShare(next))} onStep={(by) => setShare((current) => sideShare(current + by * SIDE_SHARE.step))} onReset={() => setShare(SIDE_SHARE.shipped)} />

        <div className={styles.details}>
          <RecipeBar
            recipes={signOnly ? recipes.filter(signsOnly) : recipes}
            chosen={recipeId}
            onChoose={applyRecipe}
            onSave={saveRecipe}
            onDelete={() => {
              storeRecipes(recipes.filter((recipe) => recipe.id !== recipeId));
              setRecipeId('');
            }}
            disabled={running}
          />

          {signOnly ? (
            <section className={styles.group} aria-labelledby="batch-steps">
              <h2 id="batch-steps" className={styles.heading}>
                {t('pdf-organizer.batch.kind.sign')}
              </h2>
              <SignOptions certificate={certificate} looks={looks} settings={sign} onChange={changeSign} timeStamp={timeStampSignatures ? timeStampServer : null} facts={facts} onPickPicture={pickPicture} disabled={running} preview={null} />
            </section>
          ) : (
            <section className={styles.group} aria-labelledby="batch-steps">
              <h2 id="batch-steps" className={styles.heading}>
                {t('pdf-organizer.batch.action')}
              </h2>
              <p className={shapeStyles.lead}>{t('pdf-organizer.batch.always')}</p>
              <StepPicker job={job} shown={shown} onShow={setShown} onToggle={(step, on) => change({ steps: withStep(job.steps, step, on) })} disabled={running}>
                {shown === 'ocr' ? (
                  <OcrOptions host={host} languages={job.ocrLanguages} onChange={(ocrLanguages) => change({ ocrLanguages })} disabled={running} />
                ) : shown === 'sign' ? (
                  <SignOptions certificate={certificate} looks={looks} settings={sign} onChange={changeSign} timeStamp={timeStampSignatures ? timeStampServer : null} facts={facts} onPickPicture={pickPicture} disabled={running} preview={previewBeside ? preview : null} />
                ) : (
                  <StepOptions step={shown} job={job} onChange={change} words={words} disabled={running} />
                )}
              </StepPicker>
            </section>
          )}

          <section className={styles.group} aria-labelledby="batch-result">
            <h2 id="batch-result" className={styles.heading}>
              {t('pdf-organizer.batch.folder')}
            </h2>
            <div role="radiogroup" aria-label={t('pdf-organizer.batch.output')} className={styles.outputs}>
              {BATCH_OUTPUTS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={(gathered ? 'one' : 'each') === option}
                  className={styles.output}
                  disabled={running || (option === 'one' && !canBeOne(job))}
                  onClick={() => setOutput(option)}
                >
                  <Icon name={OUTPUT_ICONS[option]} size={16} />
                  <span className={styles.kindTexts}>
                    <span className={styles.kindName}>{t(`pdf-organizer.batch.output.${option}`)}</span>
                    <span className={styles.kindNote}>{t(option === 'one' && !canBeOne(job) ? 'pdf-organizer.batch.output.onePdfOnly' : `pdf-organizer.batch.outputNote.${option}`)}</span>
                  </span>
                </button>
              ))}
            </div>

            <div className={styles.grid}>
              {gathered ? (
                <label className={styles.cell}>
                  <span>{t('pdf-organizer.batch.oneName')}</span>
                  <input type="text" className={styles.field} dir="auto" maxLength={120} value={one} placeholder={oneName(combinedName).replace(/\.pdf$/, '')} disabled={running} onChange={(event) => setOne(event.target.value)} />
                </label>
              ) : (
                <label className={styles.cell}>
                  <span>{t('pdf-organizer.batch.added')}</span>
                  <input type="text" className={styles.field} dir="ltr" maxLength={60} value={suffix} disabled={running} onChange={(event) => setAdded(event.target.value)} />
                </label>
              )}
              <div className={styles.cell}>
                <span>{t('pdf-organizer.batch.folderName')}</span>
                <span className={styles.folderRow}>
                  <bdi className={styles.folder} dir="ltr" title={folder}>
                    {folder === '' ? t('pdf-organizer.batch.noFolder') : folder}
                  </bdi>
                  <Button variant={folder === '' ? 'primary' : undefined} disabled={running} onClick={() => void chooseFolder()}>
                    <Icon name="folder-open" size={14} />
                    {t('pdf-organizer.batch.chooseFolder')}
                  </Button>
                </span>
              </div>
            </div>
            <p className={styles.tip} dir="auto">
              {t(gathered ? 'pdf-organizer.batch.sampleOne' : 'pdf-organizer.batch.sample', { name: sample })}
            </p>
            <label className={shapeStyles.choice}>
              <input
                type="checkbox"
                checked={openFolder}
                disabled={running}
                onChange={(event) => {
                  setOpenFolder(event.target.checked);
                  host.saveData(OPEN_FOLDER_KEY, event.target.checked);
                }}
              />
              {t('pdf-organizer.batch.openFolder')}
            </label>
            {under.size > 0 && !gathered && (
              <label className={shapeStyles.choice}>
                <input
                  type="checkbox"
                  checked={keepFolders}
                  disabled={running}
                  onChange={(event) => {
                    setKeepFolders(event.target.checked);
                    host.saveData(KEEP_FOLDERS_KEY, event.target.checked);
                  }}
                />
                {t('pdf-organizer.batch.keepFolders')}
              </label>
            )}
            <label className={shapeStyles.choice}>
              <input
                type="checkbox"
                checked={report}
                disabled={running}
                onChange={(event) => {
                  setReport(event.target.checked);
                  host.saveData(REPORT_KEY, event.target.checked);
                }}
              />
              {t('pdf-organizer.batch.writeReport')}
            </label>
          </section>
        </div>
      </div>

      <footer className={styles.bottom}>
        <div className={styles.progress}>
          {(running || finished > 0) && <progress className={styles.bar} max={Math.max(files.length, 1)} value={finished} aria-label={t('pdf-organizer.batch.progress')} />}
          <p className={styles.status} role="status">
            {running && t('pdf-organizer.batch.progressOf', { finished, count: files.length })}
            {!running && finished > 0 && t(failed > 0 ? 'pdf-organizer.batch.doneSome' : 'pdf-organizer.batch.doneAll', { done, failed })}
            {!running && finished === 0 && missing && t(missing)}
          </p>
          {shownProblem && (
            <p className={styles.problem} role="alert">
              {t(shownProblem)}
            </p>
          )}
        </div>
        {!running && run.firstResult !== null && (
          <Button onClick={() => run.firstResult !== null && showFolder(run.firstResult)}>
            <Icon name="folder-open" size={14} />
            {t('pdf-organizer.batch.showFolder')}
          </Button>
        )}
        {running && <Button onClick={run.stop}>{t('pdf-organizer.batch.stop')}</Button>}
        <Button variant="primary" disabled={missing !== null || running || looking || certificate.checking} onClick={() => void begin()}>
          <Icon name="list-check" size={14} />
          {t(running ? 'pdf-organizer.batch.working' : 'pdf-organizer.batch.start', { count: files.length })}
        </Button>
      </footer>
    </div>
  );
}
