import type { AppHost, AppSettingsHost, AppTabParams } from '@syntelab/shell-api';
import { commandRegistry } from '../commands';
import { setImmersive } from '../immersive';
import { setIdleBar, showTool } from '../layout/tools/use-tools';
import { appResourceUrl, invokeApp, isDefaultPdfApp, openDefaultAppSettings, pathsOfDropped, pickFiles, pickFolder, openExternal, pickSavePath, readWebPage, saveWebPage, shareFile, showInFolder } from '../platform';
import { printImages } from '../print';
import { showSettingsSection } from '../settings/settings-section';
import { tabs } from '../tabs';
import { loadAppData, saveAppData } from './app-data';

const NO_PARAMS = Object.freeze({});

/** Everything in an `AppHost` that stays the same while its tab lives. */
export type AppServices = Omit<AppHost, 'active' | 'immersive' | 'tool' | 'tools'>;

/**
 * The shell's services for one tab of one app. Created once per tab (a tab
 * keeps its id and params while it lives), so the app can rely on the
 * functions keeping their identity: an app reopens its document when they change.
 */
export function createAppServices(appId: string, tabId: string, params: AppTabParams | undefined): AppServices {
  return {
    appId,
    params: params ?? NO_PARAMS,
    invoke: (command, payload) => invokeApp(appId, command, payload),
    resourceUrl: (path, query) => appResourceUrl(appId, path, query),
    pickFiles,
    pickSavePath,
    pathsOfDropped,
    pickFolder,
    printImages,
    shareFile,
    showInFolder,
    openLink: (url) => (/^(https?:|mailto:)/i.test(url.trim()) ? openExternal(url.trim()) : Promise.reject(new Error('not-a-link'))),
    saveWebPage,
    readWebPage,
    isDefaultPdfApp,
    openDefaultAppSettings,
    setImmersive,
    showTool: (menuKey) => showTool(tabId, menuKey),
    setIdleBar: (shown) => setIdleBar(tabId, shown),
    registerCommands: (commands) => commandRegistry.registerAll(commands),
    loadData: (key) => loadAppData(appId, key),
    saveData: (key, value) => saveAppData(appId, key, value),
    openTab: (request) => tabs.openApp(appId, request),
    openSettings: () => {
      showSettingsSection(appId);
      tabs.openSettings();
    },
    setUnsavedChanges: (unsaved) => tabs.setUnsaved(tabId, unsaved),
    closeTab: (options) => (options?.discardChanges ? tabs.close(tabId) : tabs.requestClose(tabId)),
  };
}

/** What an app's own part of Settings gets: the same place for small data its tabs use. */
export function createAppSettingsHost(appId: string): AppSettingsHost {
  return {
    appId,
    loadData: (key) => loadAppData(appId, key),
    saveData: (key, value) => saveAppData(appId, key, value),
    invoke: (command, payload) => invokeApp(appId, command, payload),
  };
}
