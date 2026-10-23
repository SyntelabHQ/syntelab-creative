import { arrowHead, centerOf, cssFont, DEFAULT_STYLE, TEXT_ASCENT, TEXT_LINE_HEIGHT } from './mark';
import type { Mark } from './mark';

/** The paper clip of an attached file, when no color was chosen for it. */
export const CLIP_COLOR = '#007bff';

export interface MarkShapeProps {
  readonly mark: Mark;
  /** The whole of the mark answers the pointer, its empty inside too (to pick it up). */
  readonly grabbable?: boolean;
}

/** One mark as SVG, drawn the way the Rust side will write it into the page. */
export function MarkShape({ mark, grabbable = false }: MarkShapeProps) {
  const { x, y, width, height, lineWidth } = mark;
  const stroke = mark.stroke ?? 'none';
  const fill = mark.fill ?? 'none';
  const center = centerOf(mark);
  const common = {
    opacity: mark.opacity,
    transform: mark.rotation ? `rotate(${mark.rotation} ${center.x} ${center.y})` : undefined,
    pointerEvents: grabbable ? ('all' as const) : undefined,
  };
  const line = { stroke: mark.stroke ?? '#000000', strokeWidth: lineWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const [left, top, right, bottom] = [Math.min(x, x + width), Math.min(y, y + height), Math.max(x, x + width), Math.max(y, y + height)];
  const [boxWidth, boxHeight] = [right - left, bottom - top];

  switch (mark.kind) {
    case 'rectangle':
      return <rect {...common} x={left} y={top} width={boxWidth} height={boxHeight} stroke={stroke} strokeWidth={lineWidth} strokeLinejoin="round" fill={fill} />;
    case 'ellipse':
      return <ellipse {...common} cx={center.x} cy={center.y} rx={boxWidth / 2} ry={boxHeight / 2} stroke={stroke} strokeWidth={lineWidth} fill={fill} />;
    case 'highlight':
      // What is under a highlight stays as dark as it was.
      return <rect {...common} x={left} y={top} width={boxWidth} height={boxHeight} fill={mark.fill ?? '#ffeb00'} style={{ mixBlendMode: 'multiply' }} />;
    case 'erase':
    case 'erasePicture':
      // Blank paper over the line that is being written anew.
      return <rect {...common} x={left} y={top} width={boxWidth} height={boxHeight} fill="#ffffff" />;
    case 'redact':
      return <rect {...common} x={left} y={top} width={boxWidth} height={boxHeight} fill="#000000" />;
    case 'dot':
      return <ellipse {...common} cx={center.x} cy={center.y} rx={boxWidth / 2} ry={boxHeight / 2} fill={mark.stroke ?? '#000000'} />;
    case 'check':
      return <polyline {...common} {...line} points={`${left},${top + boxHeight * 0.55} ${left + boxWidth * 0.36},${bottom} ${right},${top}`} />;
    case 'cross':
      return <path {...common} {...line} d={`M${left} ${top}L${right} ${bottom}M${left} ${bottom}L${right} ${top}`} />;
    case 'line':
      return <line {...common} {...line} x1={x} y1={y} x2={x + width} y2={y + height} />;
    case 'arrow': {
      const length = Math.hypot(width, height);
      if (length === 0) return null;
      const head = arrowHead(lineWidth, length);
      const [alongX, alongY] = [width / length, height / length];
      const [tipX, tipY] = [x + width, y + height];
      // The line stops where the head begins, so its round end does not stick out of the point.
      const [neckX, neckY] = [tipX - alongX * head.length, tipY - alongY * head.length];
      const [sideX, sideY] = [-alongY * head.halfWidth, alongX * head.halfWidth];
      return (
        <g {...common}>
          <line {...line} x1={x} y1={y} x2={neckX} y2={neckY} />
          <polygon fill={line.stroke} points={`${tipX},${tipY} ${neckX + sideX},${neckY + sideY} ${neckX - sideX},${neckY - sideY}`} />
          {/* A thin line is hard to pick up: a wider one that cannot be seen takes the pointer. */}
          {grabbable && <line x1={x} y1={y} x2={tipX} y2={tipY} stroke="transparent" strokeWidth={Math.max(lineWidth, 10)} />}
        </g>
      );
    }
    case 'text': {
      const font = cssFont(mark);
      const size = mark.size ?? DEFAULT_STYLE.size;
      // Each line stands at the left, the middle or the right of the box.
      const [lineX, anchor] = mark.align === 'center' ? ([x + width / 2, 'middle'] as const) : mark.align === 'right' ? ([x + width, 'end'] as const) : ([x, 'start'] as const);
      return (
        <g {...common}>
          {grabbable && <rect x={x} y={y} width={Math.max(width, size)} height={Math.max(height, size)} fill="transparent" />}
          <text fill={mark.stroke ?? '#000000'} fontFamily={font.family} fontSize={size} fontWeight={font.weight} fontStyle={font.style} textAnchor={anchor} direction="ltr" style={{ whiteSpace: 'pre', userSelect: 'none' }}>
            {(mark.text ?? '').split('\n').map((text, number) => (
              <tspan key={number} x={lineX} y={y + size * TEXT_ASCENT + number * size * TEXT_LINE_HEIGHT}>
                {text}
              </tspan>
            ))}
          </text>
        </g>
      );
    }
    case 'link':
      return <rect {...common} x={left} y={top} width={boxWidth} height={boxHeight} rx={2} fill="rgb(36 80 200 / 0.14)" stroke="#2450c8" strokeWidth={0.8} strokeDasharray="3 2" />;
    case 'textField':
    case 'signatureField': {
      const signing = mark.kind === 'signatureField';
      const letters = Math.min(9, boxHeight * 0.6);
      return (
        <g {...common}>
          <rect x={left} y={top} width={boxWidth} height={boxHeight} rx={1.5} fill={signing ? 'rgb(255 221 120 / 0.4)' : 'rgb(120 160 255 / 0.25)'} stroke={signing ? '#b07d00' : '#4a6fd0'} strokeWidth={0.8} strokeDasharray={signing ? '4 2' : undefined} />
          <text x={left + 3} y={top + (signing ? letters + 2 : boxHeight / 2 + letters * 0.35)} fontSize={letters} fontFamily="Arial, Helvetica, sans-serif" fill={signing ? '#7a5600' : '#2c478f'} style={{ userSelect: 'none' }}>
            {mark.name ?? ''}
          </text>
        </g>
      );
    }
    case 'choiceField': {
      const letters = Math.min(9, boxHeight * 0.6);
      const arrow = Math.min(boxHeight * 0.3, 5);
      return (
        <g {...common}>
          <rect x={left} y={top} width={boxWidth} height={boxHeight} rx={1.5} fill="rgb(120 160 255 / 0.25)" stroke="#4a6fd0" strokeWidth={0.8} />
          <text x={left + 3} y={top + boxHeight / 2 + letters * 0.35} fontSize={letters} fontFamily="Arial, Helvetica, sans-serif" fill="#2c478f" style={{ userSelect: 'none' }}>
            {mark.name ?? ''}
          </text>
          <path d={`M${right - arrow * 2.6} ${top + boxHeight / 2 - arrow / 2}l${arrow} ${arrow}l${arrow} ${-arrow}`} fill="none" stroke="#2c478f" strokeWidth={0.9} />
        </g>
      );
    }
    case 'radioButton':
      return <ellipse {...common} cx={center.x} cy={center.y} rx={boxWidth / 2} ry={boxHeight / 2} fill="rgb(120 160 255 / 0.25)" stroke="#4a6fd0" strokeWidth={0.8} />;
    case 'checkBox':
      return <rect {...common} x={left} y={top} width={boxWidth} height={boxHeight} rx={1} fill="rgb(120 160 255 / 0.25)" stroke="#4a6fd0" strokeWidth={0.8} />;
    case 'bookmark':
      // A ribbon, as bookmarks are drawn everywhere.
      return (
        <g {...common}>
          <rect x={left} y={top} width={boxWidth} height={boxHeight} fill="transparent" />
          <path d={`M${left + boxWidth * 0.2} ${top}h${boxWidth * 0.6}v${boxHeight}l${-boxWidth * 0.3} ${-boxHeight * 0.28}l${-boxWidth * 0.3} ${boxHeight * 0.28}z`} fill="#e67e22" stroke="#a85608" strokeWidth={0.6} />
        </g>
      );
    case 'attachment': {
      // A paper clip; the Rust side draws the same one into the file.
      const at = (px: number, py: number) => `${left + px * boxWidth} ${top + (1 - py) * boxHeight}`;
      const clip = `M${at(0.62, 0.72)}L${at(0.62, 0.3)}C${at(0.62, 0.14)} ${at(0.38, 0.14)} ${at(0.38, 0.3)}L${at(0.38, 0.8)}C${at(0.38, 0.98)} ${at(0.78, 0.98)} ${at(0.78, 0.8)}L${at(0.78, 0.22)}C${at(0.78, 0)} ${at(0.22, 0)} ${at(0.22, 0.22)}L${at(0.22, 0.72)}`;
      return (
        <g {...common}>
          <rect x={left} y={top} width={boxWidth} height={boxHeight} fill="transparent" />
          <path d={clip} fill="none" stroke={mark.stroke ?? CLIP_COLOR} strokeWidth={Math.max(Math.min(boxWidth, boxHeight) * 0.09, 0.8)} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    }
    case 'hiddenText':
      // In the page for readers and for searching, not for the eye.
      return null;
    case 'picture':
      return <image {...common} href={mark.data} x={left} y={top} width={boxWidth} height={boxHeight} preserveAspectRatio="none" />;
  }
}
