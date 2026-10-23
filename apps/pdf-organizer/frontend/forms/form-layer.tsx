import type { QuarterTurns } from '../document/page-plan';
import { turnBox } from '../find/find-hits';
import { OFF, valueOf } from './form-fields';
import type { Answers, FormField } from './form-fields';
import styles from './form-layer.module.css';

export interface FormLayerProps {
  /** The fields of this page. */
  readonly fields: readonly FormField[];
  readonly answers: Answers;
  readonly onFill: (field: FormField, value: string) => void;
  /** The page's size in the file, in points, and how far it is turned as shown. */
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly turn: QuarterTurns;
  /** How many pixels a point is at the current zoom. */
  readonly pixelsPerPoint: number;
}

/** The form fields of one page, over its picture, to fill in where they are. */
export function FormLayer({ fields, answers, onFill, pageWidth, pageHeight, turn, pixelsPerPoint }: FormLayerProps) {
  return (
    <>
      {fields.map((field) => {
        const [x, y, width, height] = field.area;
        const box = turnBox({ x, y, width, height }, pageWidth, pageHeight, turn);
        const style = {
          left: box.x * pixelsPerPoint,
          top: box.y * pixelsPerPoint,
          width: box.width * pixelsPerPoint,
          height: box.height * pixelsPerPoint,
          // Letters as tall as the field allows, up to a comfortable size.
          fontSize: Math.min(box.height * 0.68, 12) * pixelsPerPoint,
        };
        const value = valueOf(field, answers);
        const name = field.label || field.name;
        const common = { className: styles.field, style, 'aria-label': name, title: name, disabled: field.readOnly } as const;

        if (field.kind === 'checkbox' || field.kind === 'radio') {
          const on = field.on ?? 'Yes';
          return (
            <input
              key={field.id}
              {...common}
              className={styles.tick}
              type={field.kind}
              // The file's own group name is not unique enough across pages and tabs.
              name={field.kind === 'radio' ? `field-${field.name}` : undefined}
              checked={value === on}
              onChange={(event) => onFill(field, event.target.checked ? on : OFF)}
              // A ticked radio button of a form can usually be cleared again.
              onClick={() => field.kind === 'radio' && value === on && onFill(field, OFF)}
            />
          );
        }
        if (field.kind === 'choice') {
          return (
            <select key={field.id} {...common} value={value} onChange={(event) => onFill(field, event.target.value)}>
              {/* A choice not made yet, or a value the list does not have. */}
              {!field.options.some((option) => option.value === value) && <option value={value}>{value}</option>}
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.text}
                </option>
              ))}
            </select>
          );
        }
        return field.multiline ? (
          <textarea
            key={field.id}
            {...common}
            dir="auto"
            value={value}
            maxLength={field.maxLength ?? undefined}
            onChange={(event) => onFill(field, event.target.value)}
          />
        ) : (
          <input
            key={field.id}
            {...common}
            type="text"
            dir="auto"
            value={value}
            maxLength={field.maxLength ?? undefined}
            onChange={(event) => onFill(field, event.target.value)}
          />
        );
      })}
    </>
  );
}
