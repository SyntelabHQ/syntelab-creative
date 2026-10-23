import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { QuarterTurns } from '../document/page-plan';
import { BOX_HANDLES, canBeWrittenAsText, centerOf, cssFont, DEFAULT_STYLE, drawMark, isAddition, isLine, moveMark, resizeMark, TEXT_LINE_HEIGHT, turnPoint } from './mark';
import type { BoxHandle, DrawnKind, Mark, MarkHandle, MarkStyle, Point } from './mark';
import styles from './mark-layer.module.css';
import { MarkShape } from './mark-shape';
import { fitText, textAsPicture } from './measure-text';
import { placedMarks } from './placing';
import type { Placing } from './placing';
import { isTaken } from './page-pictures';
import type { PagePicture } from './page-pictures';
import { isRewritten, rewriteLine } from './text-lines';
import type { TextLine } from './text-lines';

/** What the pointer does on the page: pick marks up, draw a new one of a kind, or (`edit`) rewrite a line of the document's own text. */
export type MarkTool = 'select' | 'edit' | DrawnKind;

export interface MarkLayerProps {
  readonly marks: readonly Mark[];
  /** The page's size in the file, in points, and how far it is turned as shown. */
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly turn: QuarterTurns;
  /** How many pixels a point is at the current zoom. */
  readonly pixelsPerPoint: number;
  /** The tool in use; null when marks are only shown. */
  readonly tool: MarkTool | null;
  readonly style: MarkStyle;
  /** The id of the selected mark of this page, if it has it. */
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  /** The marks of this page after a change that is finished (a drag ended, a text was typed). */
  readonly onChange: (marks: readonly Mark[]) => void;
  /** The lines of text the page has, for the tool that rewrites them. */
  readonly lines?: readonly TextLine[];
  /** The pictures the page has, for the same tool: a click picks one up. */
  readonly pictures?: readonly PagePicture[];
  readonly onTakePicture?: (picture: PagePicture) => void;
  /** Something chosen that waits to be put on a page (a signature, an image): the next drag says where and how large. */
  readonly placing?: Placing | null;
  /** A paper clip was clicked while no tool is in use: its file is asked about. */
  readonly onOpenMark?: (id: string) => void;
  /** It was put on this page, as the mark of this id (already among the marks given to `onChange`). */
  readonly onPlaced?: (id: string) => void;
}

/** What a drag is doing, from where, to which mark. */
type Drag =
  | { readonly kind: 'draw'; readonly from: Point; readonly draft: Mark }
  | { readonly kind: 'move'; readonly from: Point; readonly original: Mark; readonly draft: Mark }
  | { readonly kind: 'handle'; readonly handle: MarkHandle; readonly original: Mark; readonly draft: Mark }
  | { readonly kind: 'place'; readonly from: Point; readonly ids: readonly string[]; readonly drafts: readonly Mark[] };

const NO_LINES: readonly TextLine[] = [];
const NO_PICTURES: readonly PagePicture[] = [];

/** Sizes of the selection's handles, in pixels on screen whatever the zoom. */
const HANDLE = 10;
/** The room around a handle that still takes the pointer: easy to catch. */
const HANDLE_REACH = 22;
const TURN_HANDLE_AWAY = 26;

/** How the page's own grid is turned into the grid of the page as shown. */
export function turnTransform(turn: QuarterTurns, pageWidth: number, pageHeight: number): string | undefined {
  if (turn === 90) return `translate(${pageHeight} 0) rotate(90)`;
  if (turn === 180) return `translate(${pageWidth} ${pageHeight}) rotate(180)`;
  if (turn === 270) return `translate(0 ${pageWidth}) rotate(270)`;
  return undefined;
}

/**
 * The marks of one page, over its picture. With a tool, the pointer draws
 * new marks and moves, resizes and turns the selected one; the page under it
 * still scrolls and zooms.
 */
export function MarkLayer(props: MarkLayerProps) {
  const { marks, pageWidth, pageHeight, turn, pixelsPerPoint, tool, style, selectedId, onSelect, onChange, lines = NO_LINES, placing = null, onPlaced, onOpenMark, pictures = NO_PICTURES, onTakePicture } = props;
  const gridRef = useRef<SVGGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The text mark being typed, with what is typed so far. */
  const [typing, setTyping] = useState<Mark | null>(null);
  const sideways = turn % 180 !== 0;
  const [shownWidth, shownHeight] = sideways ? [pageHeight, pageWidth] : [pageWidth, pageHeight];
  const active = tool !== null || placing !== null;
  const editing = tool === 'edit' && !placing;
  const drawing = tool !== null && tool !== 'select' && !editing && !placing;
  /** A mark can be picked up: always with the arrow; with a drawing tool, the selected one still can. */
  const grabbable = (mark: Mark) => active && !placing && (!drawing || mark.id === selectedId);

  // Leaving the tools ends whatever was going on.
  useEffect(() => {
    if (!active) setDrag(null);
  }, [active]);

  /** Where the pointer is, in the page's own points. */
  const pointOf = (event: { clientX: number; clientY: number }): Point => {
    const matrix = gridRef.current?.getScreenCTM()?.inverse();
    if (!matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  };

  const replace = (changed: Mark) => marks.map((mark) => (mark.id === changed.id ? changed : mark));

  const finishTyping = (mark: Mark | null) => {
    setTyping(null);
    if (!mark) return;
    const others = marks.filter((other) => other.id !== mark.id);
    const text = (mark.text ?? '').replace(/\s+$/, '');
    if (text === '') {
      // Nothing typed: the text never was (or is taken away).
      if (others.length !== marks.length) onChange(others);
      onSelect(null);
      return;
    }
    const typed = { ...mark, text };
    const finished = canBeWrittenAsText(text) ? fitText(typed) : textAsPicture(typed);
    onChange(marks.some((other) => other.id === mark.id) ? replace(finished) : [...marks, finished]);
    onSelect(finished.id);
  };

  const capture = (event: ReactPointerEvent<Element>) => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that cannot be held still draws while it stays over the page.
    }
  };

  /** A line of the document was clicked: it is taken out, and its words stand in its place, ready to be changed. */
  const rewrite = (line: TextLine) => {
    if (typing) finishTyping(typing);
    const { erase, text } = rewriteLine(line, `line-${Date.now().toString(36)}`);
    onChange([...marks, erase, text]);
    onSelect(text.id);
    setTyping(text);
  };

  /** What is being placed, as marks, for a drag between two places of the page. */
  const placed = (what: Placing, from: Point, to: Point, ids: readonly string[]): Mark[] => {
    let next = 0;
    return placedMarks(what, from, to, turn, fitText, () => ids[next++] ?? `placed-${next}`);
  };

  const onBackgroundDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!active || event.button !== 0) return;
    if (typing) return finishTyping(typing);
    if (placing) {
      event.preventDefault();
      capture(event);
      const from = pointOf(event);
      const ids = [0, 1].map((number) => `placed-${Date.now().toString(36)}-${number}`);
      return setDrag({ kind: 'place', from, ids, drafts: placed(placing, from, from, ids) });
    }
    // With the tool that rewrites lines, a click beside the lines does nothing.
    if (editing) return onSelect(null);
    if (!drawing || tool === 'edit') return onSelect(null);
    event.preventDefault();
    capture(event);
    const from = pointOf(event);
    if (tool === 'text') {
      // Typing starts where the page was clicked.
      const mark = drawMark('text', style, from, from);
      onSelect(mark.id);
      return setTyping(mark);
    }
    setDrag({ kind: 'draw', from, draft: drawMark(tool, style, from, from) });
  };

  const onMarkDown = (event: ReactPointerEvent<SVGGElement>, mark: Mark) => {
    // With a drawing tool, a new mark can start on top of another one; the selected one is still moved.
    if (!grabbable(mark) || event.button !== 0) return;
    // A line rewritten earlier is opened again by a click on its text; a picture picked up earlier is moved again.
    if (editing && mark.kind !== 'text' && mark.kind !== 'picture') return;
    event.stopPropagation();
    event.preventDefault();
    if (typing) finishTyping(typing);
    capture(event);
    onSelect(mark.id);
    setDrag({ kind: 'move', from: pointOf(event), original: mark, draft: mark });
  };

  const onHandleDown = (event: ReactPointerEvent<SVGElement>, mark: Mark, handle: MarkHandle) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    capture(event);
    setDrag({ kind: 'handle', handle, original: mark, draft: mark });
  };

  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const point = pointOf(event);
    if (drag.kind === 'draw') setDrag({ ...drag, draft: { ...drawMark(drag.draft.kind as DrawnKind, style, drag.from, point), id: drag.draft.id } });
    else if (drag.kind === 'move') setDrag({ ...drag, draft: moveMark(drag.original, point.x - drag.from.x, point.y - drag.from.y) });
    else if (drag.kind === 'place') setDrag({ ...drag, drafts: placing ? placed(placing, drag.from, point, drag.ids) : drag.drafts });
    // From the mark as it was when the drag began: nothing adds up along the way.
    else setDrag({ ...drag, draft: resizeMark(drag.original, drag.handle, point, fitText) });
  };

  const onUp = () => {
    if (!drag) return;
    setDrag(null);
    if (drag.kind === 'place') {
      // Words in a script the fonts cannot write go on the page as a picture of them.
      const finished = drag.drafts.map((mark) => (mark.kind === 'text' && !canBeWrittenAsText(mark.text ?? '') ? textAsPicture(mark) : mark));
      const [first] = finished;
      if (!first) return;
      onChange([...marks, ...finished]);
      onPlaced?.(first.id);
    } else if (drag.kind === 'draw') {
      onChange([...marks, drag.draft]);
      onSelect(drag.draft.id);
    } else if (drag.kind !== 'move' || drag.draft.x !== drag.original.x || drag.draft.y !== drag.original.y) {
      onChange(replace(drag.draft));
    }
  };

  const shown = drag && (drag.kind === 'move' || drag.kind === 'handle') ? replace(drag.draft) : marks;
  const selected = shown.find((mark) => mark.id === selectedId && mark.id !== typing?.id) ?? null;
  // Handles keep their size on screen at any zoom.
  const unit = 1 / pixelsPerPoint;

  const handlesOf = (mark: Mark) => {
    const center = centerOf(mark);
    const at = (point: Point) => turnPoint(point, center, mark.rotation);
    const square = (handle: MarkHandle, place: Point, round = false) => (
      <g key={handle} className={styles.handle} data-handle={handle} onPointerDown={(event) => onHandleDown(event, mark, handle)}>
        <circle className={styles.reach} cx={place.x} cy={place.y} r={(HANDLE_REACH * unit) / 2} />
        <rect
          className={styles.knob}
          x={place.x - (HANDLE * unit) / 2}
          y={place.y - (HANDLE * unit) / 2}
          width={HANDLE * unit}
          height={HANDLE * unit}
          rx={round ? HANDLE * unit : 2 * unit}
          strokeWidth={1.5 * unit}
        />
      </g>
    );
    if (isLine(mark)) {
      return [square('start', { x: mark.x, y: mark.y }, true), square('end', { x: mark.x + mark.width, y: mark.y + mark.height }, true)];
    }
    const turnPlace = at({ x: center.x, y: mark.y - TURN_HANDLE_AWAY * unit });
    const topMiddle = at({ x: center.x, y: mark.y });
    // Text is resized by its corners only: its letters grow, they are not stretched.
    // Text and a paper clip are resized by their corners only; a bookmark has one size.
    const byCorners = mark.kind === 'text' || mark.kind === 'attachment';
    const pulled = (Object.keys(BOX_HANDLES) as BoxHandle[]).filter((handle) => mark.kind !== 'bookmark' && (!byCorners || handle.length === 2));
    // A link, a field or a bookmark always lies straight on its page.
    const turned = !isAddition(mark.kind) || mark.kind === 'attachment';
    return [
      <rect
        key="frame"
        className={styles.frame}
        x={mark.x}
        y={mark.y}
        width={mark.width}
        height={mark.height}
        strokeWidth={unit}
        strokeDasharray={`${4 * unit} ${3 * unit}`}
        transform={mark.rotation ? `rotate(${mark.rotation} ${center.x} ${center.y})` : undefined}
      />,
      ...(turned ? [<line key="stem" className={styles.frame} x1={topMiddle.x} y1={topMiddle.y} x2={turnPlace.x} y2={turnPlace.y} strokeWidth={unit} />, square('turn', turnPlace, true)] : []),
      ...pulled.map((handle) => {
        const [pullX, pullY] = BOX_HANDLES[handle];
        return square(handle, at({ x: center.x + (pullX * mark.width) / 2, y: center.y + (pullY * mark.height) / 2 }));
      }),
    ];
  };

  const typingFont = typing ? cssFont(typing) : null;
  const typingSize = typing?.size ?? DEFAULT_STYLE.size;
  const typingLines = (typing?.text ?? '').split('\n');
  /** Centered or right-hand text is typed inside the box it has, so its lines stay where they are. */
  const typingAligned = typing !== null && (typing.align ?? 'left') !== 'left' && typing.width > 0;

  return (
    <svg
      className={styles.layer}
      data-active={active}
      data-tool={placing ? 'place' : (tool ?? undefined)}
      viewBox={`0 0 ${shownWidth} ${shownHeight}`}
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <g ref={gridRef} transform={turnTransform(turn, pageWidth, pageHeight)}>
        {shown
          .filter((mark) => mark.id !== typing?.id)
          .map((mark) => (
            <g
              key={mark.id}
              className={styles.mark}
              data-grabbable={grabbable(mark)}
              onPointerDown={(event) => onMarkDown(event, mark)}
              onDoubleClick={() => grabbable(mark) && mark.kind === 'text' && setTyping(mark)}
              onClick={() => (editing && mark.kind === 'text' ? setTyping(mark) : !active && mark.kind === 'attachment' && onOpenMark?.(mark.id))}
              // A paper clip answers the pointer also while nothing is being drawn: a click shows its file.
              data-opens={!active && mark.kind === 'attachment' && onOpenMark !== undefined}
            >
              <MarkShape mark={mark} grabbable={grabbable(mark)} />
            </g>
          ))}
        {drag?.kind === 'draw' && <MarkShape mark={drag.draft} />}
        {drag?.kind === 'place' && drag.drafts.map((mark) => <MarkShape key={mark.id} mark={mark} />)}
        {/* The pictures that can be picked up: under the lines, so text over a picture is still reached. */}
        {editing &&
          !typing &&
          onTakePicture &&
          pictures
            .filter((picture) => !isTaken(picture, marks))
            .map((picture) => (
              <rect
                key={`picture-${picture.number}`}
                className={styles.picture}
                x={picture.x}
                y={picture.y}
                width={picture.width}
                height={picture.height}
                strokeWidth={unit}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  event.preventDefault();
                  onTakePicture(picture);
                }}
              />
            ))}
        {/* The lines that can be rewritten: outlined, so it shows what a click takes. */}
        {editing &&
          !typing &&
          lines
            .filter((line) => !isRewritten(line, marks))
            .map((line, index) => (
              <rect
                key={index}
                className={styles.line}
                x={line.x}
                y={line.y}
                width={line.width}
                height={line.height}
                strokeWidth={unit}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  event.preventDefault();
                  rewrite(line);
                }}
              />
            ))}
        {active && selected && handlesOf(selected)}
        {typing && typingFont && (
          <foreignObject
            x={typing.x}
            y={typing.y}
            // Room to type into; the box is fitted to the text when typing ends.
            width={typingAligned ? Math.max(typing.width, typingSize * 4) : Math.max(pageWidth - typing.x, typingSize * 4)}
            height={Math.max(typingLines.length + 1, 2) * typingSize * TEXT_LINE_HEIGHT}
            transform={typing.rotation ? `rotate(${typing.rotation} ${centerOf(typing).x} ${centerOf(typing).y})` : undefined}
          >
            <textarea
              className={styles.typing}
              autoFocus
              value={typing.text ?? ''}
              rows={Math.max(typingLines.length, 1)}
              spellCheck={false}
              style={{
                fontFamily: typingFont.family,
                fontSize: typingSize,
                fontWeight: typingFont.weight,
                fontStyle: typingFont.style,
                lineHeight: TEXT_LINE_HEIGHT,
                color: typing.stroke ?? '#000000',
                textAlign: typingAligned ? typing.align : 'left',
                // The frame is as wide as what is typed, and as thin on screen at any zoom.
                width: typingAligned ? '100%' : undefined,
                minWidth: typingSize * 2,
                outlineWidth: unit,
                outlineOffset: 2 * unit,
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => setTyping({ ...typing, text: event.target.value })}
              onBlur={() => finishTyping(typing)}
              onKeyDown={(event) => {
                // Stays in the field: the keys of the page (arrows, Delete) are not meant here.
                event.stopPropagation();
                if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) event.currentTarget.blur();
              }}
            />
          </foreignObject>
        )}
      </g>
    </svg>
  );
}
