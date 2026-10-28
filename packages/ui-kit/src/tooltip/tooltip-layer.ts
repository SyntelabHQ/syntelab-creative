import { placeTooltip } from './place-tooltip';
import type { TooltipSide } from './tooltip';

/** How long the pointer rests on a control before its tooltip shows, unless another wait is asked for. */
const WAIT = 500;
/** After a tooltip was shown, the next one shows at once for this long. */
const WARM = 600;

/**
 * Shows the tooltips of every element that carries `data-tooltip` (see
 * `tooltip.ts`). One box for the whole window, drawn above everything else
 * (open dialogs included) and kept inside the window, so no bar, panel or
 * dialog can cut a tooltip off. Call once at startup; returns how to undo it.
 * `wait` is how long the pointer rests on a control before its tooltip
 * shows, in milliseconds: none for a tooltip that shows at once.
 */
export function installTooltips(wait: number = WAIT): () => void {
  const box = document.createElement('div');
  box.className = 'sc-tooltip';
  box.setAttribute('popover', 'manual');
  box.setAttribute('role', 'tooltip');
  document.body.append(box);

  let shownFor: Element | null = null;
  /** The control whose tooltip is waiting to show. */
  let pending: Element | null = null;
  let waiting: ReturnType<typeof setTimeout> | undefined;
  let lastShown = 0;
  /** The control under the pointer, if it has a tooltip. */
  let hovered: Element | null = null;

  const hide = () => {
    clearTimeout(waiting);
    pending = null;
    if (!shownFor) return;
    shownFor = null;
    lastShown = performance.now();
    if (box.matches(':popover-open')) box.hidePopover();
  };

  const show = (control: Element) => {
    const text = control.getAttribute('data-tooltip');
    if (!text || !control.isConnected) return;
    box.textContent = text;
    box.dir = getComputedStyle(control).direction;
    // Showing it again puts it above a dialog opened since.
    if (box.matches(':popover-open')) box.hidePopover();
    box.showPopover();
    const side = (control.getAttribute('data-tooltip-side') ?? 'bottom') as TooltipSide;
    const place = placeTooltip(
      control.getBoundingClientRect(),
      box.getBoundingClientRect(),
      side,
      { width: window.innerWidth, height: window.innerHeight },
      box.dir === 'rtl',
    );
    box.style.left = `${place.left}px`;
    box.style.top = `${place.top}px`;
    shownFor = control;
  };

  const ask = (control: Element | null) => {
    // Moving over the parts of the same control (the lines of its icon) does not start the wait again.
    if (control === shownFor || (control !== null && control === pending)) return;
    hide();
    if (!control) return;
    if (wait <= 0 || performance.now() - lastShown < WARM) show(control);
    else {
      pending = control;
      waiting = setTimeout(() => {
        pending = null;
        show(control);
      }, wait);
    }
  };

  const controlOf = (target: EventTarget | null) => (target instanceof Element ? target.closest('[data-tooltip]') : null);
  const onPointerOver = (event: PointerEvent) => {
    // Touch has no hover: a tooltip would show on every tap.
    if (event.pointerType !== 'touch') {
      hovered = controlOf(event.target);
      ask(hovered);
    }
  };
  // Focus leaving a control puts away the tooltip it showed by the keyboard, not one the pointer rests on: focus
  // moving elsewhere (a page that takes it as it loads, a field) kept the tooltips of the pointer from showing.
  const onFocusOut = (event: FocusEvent) => {
    const control = controlOf(event.target);
    if (control !== null && control !== hovered && (control === shownFor || control === pending)) hide();
  };
  const onFocusIn = (event: FocusEvent) => {
    const control = controlOf(event.target);
    if (control?.matches(':focus-visible')) ask(control);
  };
  const forget = () => {
    hide();
    // The tooltip of a control that was just used does not come back by itself.
    lastShown = 0;
  };
  // Only a scroll that moves the control puts its tooltip away: something else scrolling (a page drawn
  // beside it) does not keep it from showing.
  const onScroll = (event: Event) => {
    const control = shownFor ?? pending;
    if (!control) return;
    const scrolled = event.target;
    if (scrolled === document || scrolled === window || (scrolled instanceof Node && scrolled.contains(control))) forget();
  };

  const events: readonly [string, EventListener, boolean][] = [
    ['pointerover', onPointerOver as EventListener, false],
    ['focusin', onFocusIn as EventListener, false],
    ['focusout', onFocusOut as EventListener, false],
    ['pointerdown', forget, true],
    ['keydown', forget, true],
    ['scroll', onScroll, true],
    ['wheel', forget, true],
  ];
  for (const [name, listener, capture] of events) document.addEventListener(name, listener, { capture, passive: true });
  document.documentElement.addEventListener('pointerleave', hide);
  window.addEventListener('blur', hide);

  return () => {
    hide();
    for (const [name, listener, capture] of events) document.removeEventListener(name, listener, { capture });
    document.documentElement.removeEventListener('pointerleave', hide);
    window.removeEventListener('blur', hide);
    box.remove();
  };
}
