import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachCosmosInteraction } from './cosmos-interaction';

const ROTATE_PER_PX = 0.0045;

interface PointerInit {
  readonly x: number;
  readonly y: number;
  readonly pointerType?: 'mouse' | 'touch';
  readonly pointerId?: number;
  readonly button?: number;
}

function pointer(type: string, init: PointerInit): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.x,
    clientY: init.y,
    pointerType: init.pointerType ?? 'mouse',
    pointerId: init.pointerId ?? 1,
    button: init.button ?? 0,
  });
}

function wheel(
  deltaY: number,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {},
): WheelEvent {
  const event = new WheelEvent('wheel', { deltaY, cancelable: true });
  Object.defineProperties(event, {
    ctrlKey: { value: modifiers.ctrlKey ?? false },
    metaKey: { value: modifiers.metaKey ?? false },
  });
  return event;
}

function setup(
  overrides: {
    pick?: (x: number, y: number) => number | null;
    canOpen?: (index: number) => boolean;
  } = {},
) {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  let clock = 0;
  const open = vi.fn<(index: number) => void>();
  const interaction = attachCosmosInteraction({
    canvas,
    pick: overrides.pick ?? (() => null),
    canOpen: overrides.canOpen ?? (() => true),
    open,
    now: () => clock,
  });
  const tick = (ms: number): void => {
    clock += ms;
  };
  const press = (x: number, y: number, init: Partial<PointerInit> = {}) =>
    canvas.dispatchEvent(pointer('pointerdown', { x, y, ...init }));
  const move = (x: number, y: number, init: Partial<PointerInit> = {}) =>
    window.dispatchEvent(pointer('pointermove', { x, y, ...init }));
  const release = (x: number, y: number, init: Partial<PointerInit> = {}) =>
    window.dispatchEvent(pointer('pointerup', { x, y, ...init }));
  return { canvas, interaction, open, tick, press, move, release };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('attachCosmosInteraction', () => {
  it('rotates the orbit by the horizontal drag distance', () => {
    const { interaction, press, move, release, tick } = setup();
    const { yaw, pitch } = interaction.orbit();

    press(100, 100);
    tick(16);
    move(160, 120);
    tick(16);
    release(160, 120);

    expect(interaction.orbit().yaw - yaw).toBeCloseTo(60 * ROTATE_PER_PX, 6);
    expect(interaction.orbit().pitch - pitch).toBeCloseTo(
      20 * ROTATE_PER_PX,
      6,
    );
  });

  it('keeps coasting after a fast release and pauses auto-rotation meanwhile', () => {
    const { interaction, press, move, release, tick } = setup();
    interaction.advance();

    press(100, 100);
    tick(16);
    move(140, 100);
    tick(10);
    release(140, 100);
    const released = interaction.orbit().yaw;

    tick(16);
    interaction.advance();
    const coasted = interaction.orbit().yaw;
    expect(coasted).toBeGreaterThan(released);

    tick(16);
    interaction.advance();
    expect(interaction.orbit().yaw).toBeGreaterThan(coasted);
  });

  it('advances the yaw on its own while idle and holds it still during a drag', () => {
    const { interaction, press, tick } = setup();
    interaction.advance();
    const start = interaction.orbit().yaw;

    tick(16);
    interaction.advance();
    const idle = interaction.orbit().yaw;
    expect(idle).toBeGreaterThan(start);

    press(100, 100);
    tick(16);
    interaction.advance();

    expect(interaction.orbit().yaw).toBe(idle);
  });

  it('lets a plain wheel scroll the page and zooms only with ctrl or meta held', () => {
    const { canvas, interaction } = setup();

    const plain = wheel(120);
    canvas.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(interaction.orbit().zoom).toBe(1);

    const pinch = wheel(-120, { ctrlKey: true });
    canvas.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);
    expect(interaction.orbit().zoom).toBeGreaterThan(1);

    const meta = wheel(4000, { metaKey: true });
    canvas.dispatchEvent(meta);
    expect(meta.defaultPrevented).toBe(true);
    expect(interaction.orbit().zoom).toBe(0.65);
  });

  it('opens the node under a settled click and never after a drag', () => {
    const { open, press, release, move, tick } = setup({
      pick: (x) => (x === 300 ? 3 : null),
    });

    press(300, 200);
    tick(50);
    release(300, 200);
    expect(open).toHaveBeenCalledWith(3);

    open.mockClear();
    press(260, 200);
    tick(16);
    move(300, 200);
    tick(16);
    release(300, 200);
    expect(open).not.toHaveBeenCalled();
  });

  it('ignores clicks on nodes that cannot be opened', () => {
    const { open, press, release, tick } = setup({
      pick: () => 7,
      canOpen: () => false,
    });

    press(10, 10);
    tick(10);
    release(10, 10);

    expect(open).not.toHaveBeenCalled();
  });

  it('tracks the hovered node under the mouse and reports a pointer cursor only for openable nodes', () => {
    const { canvas, interaction } = setup({
      pick: (x) => (x < 100 ? 2 : null),
      canOpen: (index) => index === 2,
    });

    canvas.dispatchEvent(pointer('pointermove', { x: 50, y: 50 }));
    expect(interaction.hovered()).toBe(2);
    expect(canvas.style.cursor).toBe('pointer');

    canvas.dispatchEvent(pointer('pointermove', { x: 150, y: 50 }));
    expect(interaction.hovered()).toBeNull();
    expect(canvas.style.cursor).toBe('');

    canvas.dispatchEvent(pointer('pointermove', { x: 50, y: 50 }));
    canvas.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }));
    expect(interaction.hovered()).toBeNull();
  });

  it('rotates only around the vertical axis for touch drags', () => {
    const { interaction, press, move, release, tick } = setup();
    const { yaw, pitch } = interaction.orbit();

    press(100, 100, { pointerType: 'touch' });
    tick(16);
    move(140, 180, { pointerType: 'touch' });
    tick(16);
    release(140, 180, { pointerType: 'touch' });

    expect(interaction.orbit().yaw - yaw).toBeCloseTo(40 * ROTATE_PER_PX, 6);
    expect(interaction.orbit().pitch).toBe(pitch);
  });

  it('stops listening after dispose', () => {
    const { interaction, press, move, release, tick } = setup();
    const { yaw } = interaction.orbit();

    interaction.dispose();
    press(100, 100);
    tick(16);
    move(200, 100);
    release(200, 100);

    expect(interaction.orbit().yaw).toBe(yaw);
  });
});
