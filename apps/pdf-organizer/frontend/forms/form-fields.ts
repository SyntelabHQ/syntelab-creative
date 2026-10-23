import type { PlanPage } from '../document/page-plan';

/** One field of a document's form, as `form_fields` describes it. */
export interface FormField {
  /** The page of the file it is on, from 0. */
  readonly page: number;
  /** What tells it apart from every other field of the file. */
  readonly id: number;
  /** The field's name in the form; radio buttons of one group share it. */
  readonly name: string;
  /** What the form calls it for the reader, when it says. */
  readonly label: string;
  readonly kind: 'text' | 'checkbox' | 'radio' | 'choice';
  /** What the file has in it. A checkbox or radio button: `on` when ticked, else `Off`. */
  readonly value: string;
  /** `[x, y, width, height]` in points from the page's top-left corner. */
  readonly area: readonly [number, number, number, number];
  readonly readOnly: boolean;
  readonly multiline: boolean;
  readonly options: readonly { readonly value: string; readonly text: string }[];
  /** The value of a ticked checkbox or radio button. */
  readonly on: string | null;
  readonly maxLength: number | null;
}

/** The value of a checkbox or radio button that is not ticked. */
export const OFF = 'Off';

/** What the user filled in and did not save yet: field id → value. */
export type Answers = ReadonlyMap<number, string>;

/** What a field holds now: the user's answer, else what the file has. */
export function valueOf(field: FormField, answers: Answers): string {
  return answers.get(field.id) ?? field.value;
}

/**
 * The answers after the user gave `value` for `field`. Ticking a radio
 * button clears the other buttons of its group. An answer equal to what the
 * file already has is no answer at all.
 */
export function answer(fields: readonly FormField[], answers: Answers, field: FormField, value: string): Map<number, string> {
  const next = new Map(answers);
  const put = (target: FormField, given: string) => {
    if (given === target.value) next.delete(target.id);
    else next.set(target.id, given);
  };
  put(field, value);
  if (field.kind === 'radio' && value !== OFF) {
    for (const other of fields) {
      if (other.kind === 'radio' && other.name === field.name && other.id !== field.id) put(other, OFF);
    }
  }
  return next;
}

/**
 * The answers to send with one page when it is written. Only a page still as
 * it is in the file has its fields where the answers belong; a page that came
 * back changed from the Rust side already carries what was filled in then.
 */
export function answersForPage(
  page: PlanPage,
  documentId: number,
  fields: readonly FormField[],
  answers: Answers,
): { id: number; value: string }[] {
  if (page.documentId !== documentId || page.origin) return [];
  return fields
    .filter((field) => field.page === page.page && answers.has(field.id))
    .map((field) => ({ id: field.id, value: answers.get(field.id) ?? field.value }));
}
