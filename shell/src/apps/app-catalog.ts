import { API_VERSION } from '@syntelab/shell-api';
import type { AppEntry, AppManifest } from '@syntelab/shell-api';
import { isTauri } from '../platform';

// Browser fallback (`npm run dev:web`): the same files the Rust side reads,
// collected at build time.
const bundledManifests = import.meta.glob<AppManifest>('../../../apps/*/app.json', {
  import: 'default',
  eager: true,
});
const bundledIcons = import.meta.glob<string>('../../../apps/*/assets/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function appFolder(path: string): string | undefined {
  return /\/apps\/([^/]+)\//.exec(path)?.[1];
}

function readBundledApps(): AppEntry[] {
  return Object.entries(bundledManifests).flatMap(([path, manifest]) => {
    const folder = appFolder(path);
    // Same rules as crates/syntelab-apps-manager: folder name = app id.
    if (!folder || manifest.id !== folder) return [];
    const iconPath = Object.keys(bundledIcons).find((candidate) =>
      candidate.endsWith(`/apps/${folder}/${manifest.brand.icon}`),
    );
    return [{ manifest, iconSvg: iconPath ? (bundledIcons[iconPath] ?? null) : null }];
  });
}

async function readAppsFromBackend(): Promise<AppEntry[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<AppEntry[]>('list_apps');
}

/** Where the apps stand until the user moves them; apps not named here follow, by id. */
const USUAL_ORDER = ['pdf-organizer', 'scribe', 'dev', 'units'];

function usualPlace(entry: AppEntry): number {
  const index = USUAL_ORDER.indexOf(entry.manifest.id);
  return index === -1 ? USUAL_ORDER.length : index;
}

/** Every app with an `app.json` in `apps/` that follows this contract version. */
export async function loadApps(): Promise<AppEntry[]> {
  const entries = isTauri() ? await readAppsFromBackend() : readBundledApps();
  return entries
    .filter((entry) => entry.manifest.apiVersion === API_VERSION)
    .sort(
      (a, b) =>
        Number(b.manifest.status === 'active') - Number(a.manifest.status === 'active') ||
        usualPlace(a) - usualPlace(b),
    );
}
