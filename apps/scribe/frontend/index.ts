import type { AppFrontend } from '@syntelab/shell-api';
import { ScribeView } from './scribe-view';
import { ScribeSettingsView } from './settings/scribe-settings-view';

const frontend: AppFrontend = { View: ScribeView, Settings: ScribeSettingsView };

export default frontend;
