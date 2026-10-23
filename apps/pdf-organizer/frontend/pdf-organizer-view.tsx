import type { AppViewProps } from '@syntelab/shell-api';
import { BatchView } from './batch/batch-view';
import { BinderView } from './binder/binder-view';
import { CompareView } from './compare/compare-view';
import { EmptyState } from './empty/empty-state';
import { DocumentView } from './viewer/document-view';

/** One PDF Organizer tab: what an entry of the file manager's menu asked for, a binder, the work on many files, a comparison, a document when the tab has one (saved somewhere or not yet), else an invitation to open a file. */
export function PdfOrganizerView({ host }: AppViewProps) {
  const path = host.params.path;
  // Entries of the file manager's right-click menu (`contextMenu` in app.json), chosen on some files.
  if (host.params.launch === 'combine-to-pdf') return <BinderView host={host} />;
  if (host.params.launch === 'convert-to-pdf' || host.params.batch) return <BatchView host={host} />;
  if (host.params.binder) return <BinderView host={host} />;
  if (host.params.compare) return <CompareView host={host} />;
  return path ? <DocumentView host={host} path={path} unsaved={host.params.unsaved === '1'} /> : <EmptyState host={host} />;
}
