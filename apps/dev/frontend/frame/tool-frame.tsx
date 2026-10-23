import type { AppHost } from '@syntelab/shell-api';
import { Suspense } from 'react';
import type { Tool } from '../tools/catalog';
import { builtTool } from '../tools/registry';
import { EmptyTool } from './empty-tool';
import type { ToolLayout } from './layout';
import type { ToolActions } from './text-tool';
import styles from './tool-frame.module.css';

export interface ToolFrameProps {
  readonly host: AppHost;
  readonly tool: Tool;
  readonly layout: ToolLayout;
  /** Gives the tab what its commands do with the tool; null when there is nothing they can do. */
  readonly onActions: (actions: ToolActions | null) => void;
}

/**
 * The frame every tool is shown in. It has no head of its own: the menus say
 * which tool is open, and all the room goes to the tool (its options, what
 * goes in, what comes out, a line under them). A tool that is not built yet
 * is shown with the frame empty.
 */
export function ToolFrame({ host, tool, layout, onActions }: ToolFrameProps) {
  const Built = builtTool(tool.id);

  return (
    <div className={styles.frame}>
      {Built ? (
        <Suspense fallback={null}>
          {/* Keyed by the tool: one tool never starts with what another held. */}
          <Built key={tool.id} host={host} layout={layout} onActions={onActions} />
        </Suspense>
      ) : (
        <EmptyTool layout={layout} />
      )}
    </div>
  );
}
