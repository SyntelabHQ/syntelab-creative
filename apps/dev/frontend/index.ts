import type { AppFrontend } from '@syntelab/shell-api';
import { DevView } from './dev-view';
import { DevSettingsView } from './settings/dev-settings-view';

const frontend: AppFrontend = { View: DevView, Settings: DevSettingsView };

export default frontend;
