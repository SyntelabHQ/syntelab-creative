import { MarkShape } from '../marks/mark-shape';
import { fitted } from '../marks/measure-text';
import { signatureLook } from './signature-look';
import { presetLines } from './signature-presets';
import type { SignatureFacts, SignaturePreset, SignatureWords } from './signature-presets';
import styles from './signing.module.css';

/** The box a signature is shown in here, in points: the shape of a usual one on a page. */
const BOX = { width: 300, height: 90 };

export interface SignaturePreviewProps {
  readonly preset: SignaturePreset;
  readonly facts: SignatureFacts;
  readonly words: SignatureWords;
}

/** A look of a signature as it will show on the page, on white like the paper it goes on. */
export function SignaturePreview({ preset, facts, words }: SignaturePreviewProps) {
  const marks = signatureLook(BOX, 0, preset.picture, presetLines(preset, facts, words), fitted, 'preview');
  return (
    <svg className={styles.preview} viewBox={`0 0 ${BOX.width} ${BOX.height}`} role="img" aria-label={preset.name}>
      {marks.map((mark) => (
        <MarkShape key={mark.id} mark={mark} />
      ))}
    </svg>
  );
}
