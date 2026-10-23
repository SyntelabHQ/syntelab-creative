import type { Translate } from '@syntelab/i18n';

/** The group the user's own units are listed under, as the Rust side names it. */
export const OWN_GROUP = 'custom';

/** What a unit is called: a unit of the user's own carries its name; the others are named by the translations. */
export const unitName = (t: Translate, converterId: string, unit: { readonly id: string; readonly name?: string | null }): string => unit.name ?? t(`units.unit.${converterId}.${unit.id}`);

/** What a group of units is called. */
export const groupName = (t: Translate, converterId: string, groupId: string): string => (groupId === OWN_GROUP ? t('units.own.group') : t(`units.group.${converterId}.${groupId}`));
