import type { AppFrontend } from '@syntelab/shell-api';
import { UnitsSettingsView } from './settings/units-settings-view';
import { UnitsView } from './units-view';

const frontend: AppFrontend = { View: UnitsView, Settings: UnitsSettingsView };

export default frontend;
