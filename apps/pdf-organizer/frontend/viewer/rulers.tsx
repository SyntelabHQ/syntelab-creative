import { rulerTicks } from './ruler-ticks';
import styles from './rulers.module.css';

/** How wide the rulers are, in pixels. */
const RULER_SIZE = 22;

export interface RulersProps {
  /** Where the top-left corner of the page lies, in pixels from the top-left corner of the area the pages are shown in. */
  readonly origin: { readonly x: number; readonly y: number };
  /** The size of that area, in pixels. */
  readonly width: number;
  readonly height: number;
  /** How many pixels one unit of the rulers is at the current zoom. */
  readonly unitPixels: number;
  /** The unit, as written in the corner: `mm`. */
  readonly unitName: string;
}

/**
 * A ruler along the top and one along the left of the pages, counting from
 * the corner of the page in view. They follow scrolling and zoom.
 */
export function Rulers({ origin, width, height, unitPixels, unitName }: RulersProps) {
  // Each ruler starts after the corner where the two meet.
  const across = rulerTicks(origin.x - RULER_SIZE, width - RULER_SIZE, unitPixels);
  const down = rulerTicks(origin.y - RULER_SIZE, height - RULER_SIZE, unitPixels);
  const mark = (major: boolean) => (major ? RULER_SIZE * 0.55 : RULER_SIZE * 0.28);

  return (
    // Rulers read the same in every language: left to right, top to bottom.
    <div className={styles.rulers} dir="ltr" aria-hidden="true">
      <span className={styles.corner}>{unitName}</span>
      <svg className={styles.across} width={Math.max(width - RULER_SIZE, 0)} height={RULER_SIZE}>
        {across.map((tick) => (
          <line key={tick.at} x1={tick.at} x2={tick.at} y1={RULER_SIZE - mark(tick.major)} y2={RULER_SIZE} />
        ))}
        {across
          .filter((tick) => tick.major)
          .map((tick) => (
            <text key={tick.at} x={tick.at + 3} y={10}>
              {tick.label}
            </text>
          ))}
      </svg>
      <svg className={styles.down} width={RULER_SIZE} height={Math.max(height - RULER_SIZE, 0)}>
        {down.map((tick) => (
          <line key={tick.at} y1={tick.at} y2={tick.at} x1={RULER_SIZE - mark(tick.major)} x2={RULER_SIZE} />
        ))}
        {down
          .filter((tick) => tick.major)
          .map((tick) => (
            // Written sideways, reading upward, like on a drawing board.
            <text key={tick.at} x={9} y={tick.at + 3} transform={`rotate(-90 9 ${tick.at + 3})`} textAnchor="end">
              {tick.label}
            </text>
          ))}
      </svg>
    </div>
  );
}
