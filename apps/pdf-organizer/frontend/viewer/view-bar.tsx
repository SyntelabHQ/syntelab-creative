import { useTranslation } from '@syntelab/i18n';
import type { ImmersiveMode } from '@syntelab/shell-api';
import { Button, Icon, IconButton } from '@syntelab/ui-kit';
import type { QuickTool } from '../settings/organizer-settings';
import { PageNavigator } from './page-navigator';
import styles from './view-bar.module.css';
import { MAX_ZOOM, MIN_ZOOM } from './view-settings';
import type { ZoomMode } from './view-settings';
import { ZoomBox } from './zoom-box';
import { zoomIn, zoomOut } from './zoom';

/** What the optional buttons of the quick toolbar do. */
export interface QuickActions {
  readonly onSave: () => void;
  readonly canSave: boolean;
  readonly onPrint: () => void;
  readonly onUndo: () => void;
  readonly canUndo: boolean;
  readonly onRedo: () => void;
  readonly canRedo: boolean;
  readonly zoomMode: ZoomMode;
  readonly onFit: (mode: 'fit-page' | 'fit-width') => void;
  /** Turns the view a quarter: 1 clockwise, -1 back. */
  readonly onRotateView: (direction: 1 | -1) => void;
  readonly onFind: () => void;
  readonly onOrganize: () => void;
  /** Hands the file to the system's share window. */
  readonly onShare: () => void;
}

export interface ViewBarProps {
  /** Zero-based. */
  readonly currentPage: number;
  readonly pageCount: number;
  /** The zoom in use right now (a "fit" mode resolves to a number). */
  readonly zoom: number;
  /** The pages were rearranged and not saved yet. */
  readonly modified: boolean;
  /** The document has no file of its own yet. */
  readonly unsaved?: boolean;
  readonly onZoomChange: (zoom: number) => void;
  readonly onGoToPage: (page: number) => void;
  readonly onStep: (direction: 1 | -1) => void;
  /** Which tools the user wants here (a setting of the app). */
  readonly tools: readonly QuickTool[];
  readonly actions: QuickActions;
  readonly immersive: ImmersiveMode;
  readonly onLeaveImmersive: () => void;
}

/**
 * The quick toolbar, the strip above the pages: where you are in the
 * document and how large it is shown, and whatever else the user put here in
 * the app's settings. Every command is also in the layout the user chose.
 */
export function ViewBar(props: ViewBarProps) {
  const { currentPage, pageCount, zoom, modified, unsaved, onZoomChange, onGoToPage, onStep, tools, actions, immersive, onLeaveImmersive } = props;
  const t = useTranslation();
  const smaller = Math.max(zoomOut(zoom), MIN_ZOOM);
  const larger = Math.min(zoomIn(zoom), MAX_ZOOM);
  const has = (tool: QuickTool) => tools.includes(tool);
  const button = (labelKey: string, icon: string, onClick: () => void, options: { disabled?: boolean; pressed?: boolean } = {}) => (
    <IconButton variant="ghost" aria-label={t(labelKey)} aria-pressed={options.pressed} disabled={options.disabled} onClick={onClick}>
      <Icon name={icon} size={16} />
    </IconButton>
  );

  return (
    <div role="toolbar" aria-label={t('pdf-organizer.viewer.toolbar')} className={styles.bar}>
      {(has('save') || has('print') || has('history')) && (
        <span className={styles.group}>
          {has('save') && button('pdf-organizer.command.save', 'floppy-disk', actions.onSave, { disabled: !actions.canSave })}
          {has('print') && button('pdf-organizer.command.print', 'print', actions.onPrint)}
          {has('history') && button('pdf-organizer.command.undo', 'arrow-rotate-left', actions.onUndo, { disabled: !actions.canUndo })}
          {has('history') && button('pdf-organizer.command.redo', 'arrow-rotate-right', actions.onRedo, { disabled: !actions.canRedo })}
        </span>
      )}

      {has('pages') && <PageNavigator currentPage={currentPage} pageCount={pageCount} onGoToPage={onGoToPage} onStep={onStep} />}

      {(has('zoom') || has('fit')) && (
        <span className={styles.group}>
          {has('zoom') && (
            <>
              <IconButton variant="ghost" aria-label={t('pdf-organizer.viewer.zoomOut')} disabled={smaller >= zoom} onClick={() => onZoomChange(smaller)}>
                <Icon name="magnifying-glass-minus" size={18} />
              </IconButton>
              <ZoomBox zoom={zoom} onZoomChange={onZoomChange} />
              <IconButton variant="ghost" aria-label={t('pdf-organizer.viewer.zoomIn')} disabled={larger <= zoom} onClick={() => onZoomChange(larger)}>
                <Icon name="magnifying-glass-plus" size={18} />
              </IconButton>
            </>
          )}
          {has('fit') && button('pdf-organizer.view.fitPage', 'maximize', () => actions.onFit('fit-page'), { pressed: actions.zoomMode === 'fit-page' })}
          {has('fit') && button('pdf-organizer.view.fitWidth', 'arrows-left-right', () => actions.onFit('fit-width'), { pressed: actions.zoomMode === 'fit-width' })}
        </span>
      )}

      {(has('rotate') || has('find') || has('organize') || has('share')) && (
        <span className={styles.group}>
          {has('rotate') && button('pdf-organizer.grid.rotateLeft', 'rotate-left', () => actions.onRotateView(-1))}
          {has('rotate') && button('pdf-organizer.grid.rotateRight', 'rotate-right', () => actions.onRotateView(1))}
          {has('find') && button('pdf-organizer.command.find', 'magnifying-glass', actions.onFind)}
          {has('organize') && button('pdf-organizer.command.organizePages', 'table-cells', actions.onOrganize)}
          {has('share') && button('pdf-organizer.command.share', 'share-nodes', actions.onShare)}
        </span>
      )}

      {modified && <span className={styles.modified}>{t(unsaved ? 'pdf-organizer.viewer.unsaved' : 'pdf-organizer.viewer.modified')}</span>}

      {/* With the menus hidden, this is the visible way back (Escape works too). */}
      {immersive !== 'none' && (
        <Button variant="outline" className={styles.leave} onClick={onLeaveImmersive}>
          <Icon name="xmark" size={14} />
          {t(immersive === 'read' ? 'pdf-organizer.view.leaveReadMode' : 'pdf-organizer.view.leaveFullScreen')}
        </Button>
      )}
    </div>
  );
}
