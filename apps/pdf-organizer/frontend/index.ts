import type { AppFrontend } from '@syntelab/shell-api';
import { PdfOrganizerView } from './pdf-organizer-view';
import { OrganizerSettingsView } from './settings/organizer-settings-view';

const frontend: AppFrontend = { View: PdfOrganizerView, Settings: OrganizerSettingsView };

export default frontend;
