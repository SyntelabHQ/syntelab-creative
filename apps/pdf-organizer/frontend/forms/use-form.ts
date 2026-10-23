import type { AppHost } from '@syntelab/shell-api';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlanPage } from '../document/page-plan';
import { answer, answersForPage } from './form-fields';
import type { Answers, FormField } from './form-fields';

export interface Form {
  /** The fields of the open document's form; empty when it has none. */
  readonly fields: readonly FormField[];
  /** The fields of one page of the file. */
  fieldsOnPage(page: number): readonly FormField[];
  /** What the user filled in and did not save yet. */
  readonly answers: Answers;
  /** True when there are answers to save. */
  readonly dirty: boolean;
  fill(field: FormField, value: string): void;
  /** The answers to send with a page when it is written. */
  answersFor(page: PlanPage): { id: number; value: string }[];
}

const NO_FIELDS: readonly FormField[] = [];

/**
 * The form of the open document. Its fields are read once per document; what
 * the user types stays here until the document is saved, when it is written
 * into the file. A saved document comes back under a new id, with the answers
 * in it, and this starts clean again.
 */
export function useForm(host: AppHost, documentId: number | undefined): Form {
  const [fields, setFields] = useState<readonly FormField[]>(NO_FIELDS);
  const [answers, setAnswers] = useState<Answers>(new Map());
  const { invoke } = host;

  useEffect(() => {
    setFields(NO_FIELDS);
    setAnswers(new Map());
    if (documentId === undefined) return;
    let cancelled = false;
    invoke<{ fields: readonly FormField[] }>('form_fields', { documentId }).then(
      (read) => {
        if (!cancelled) setFields(read.fields);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [invoke, documentId]);

  const byPage = useMemo(() => {
    const pages = new Map<number, FormField[]>();
    for (const field of fields) pages.set(field.page, [...(pages.get(field.page) ?? []), field]);
    return pages;
  }, [fields]);

  const fill = useCallback(
    (field: FormField, value: string) => setAnswers((current) => answer(fields, current, field, value)),
    [fields],
  );
  const answersFor = useCallback(
    (page: PlanPage) => (documentId === undefined ? [] : answersForPage(page, documentId, fields, answers)),
    [documentId, fields, answers],
  );

  return {
    fields,
    fieldsOnPage: useCallback((page: number) => byPage.get(page) ?? NO_FIELDS, [byPage]),
    answers,
    dirty: answers.size > 0,
    fill,
    answersFor,
  };
}
