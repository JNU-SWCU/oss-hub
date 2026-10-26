import type { CosmosOrbit } from './cosmos-camera';
import { clamp } from './cosmos-theme';

export interface CosmosInteractionOptions {
  readonly canvas: HTMLCanvasElement;
  readonly pick: (x: number, y: number) => number | null;
  readonly canOpen: (index: number) => boolean;
  readonly open: (index: number) => void;
  readonly now?: () => number;
}

export interface CosmosInteraction {
  readonly orbit: () => CosmosOrbit;
  readonly hovered: () => number | null;
  readonly advance: () => void;
  readonly dispose: () => void;
}

interface DragState {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startAt: number;
  lastMoveAt: number;
  moved: boolean;
  touch: boolean;
}

const AUTO_SPEED = (Math.PI * 2) / 150_000;
const ROTATE_PER_PX = 0.0045;
const PITCH_MIN = -0.9;
const PITCH_MAX = 0.9;
const INITIAL_YAW = 0.6;
const INITIAL_PITCH = 0.36;
const ZOOM_MIN = 0.65;
const ZOOM_MAX = 2.2;
const WHEEL_ZOOM_RATE = 0.0025;
const FRICTION_MS = 320;
const VELOCITY_CAP = 0.012;
const REST_BEFORE_RELEASE_MS = 80;
const AUTO_FADE_MS = 200;
const RESUME_DELAY_MS = 700;
const RESUME_EASE_MS = 900;
const CLICK_SLOP_PX = 4;
const CLICK_MAX_MS = 600;
const MAX_STEP_MS = 50;

export function attachCosmosInteraction({
  canvas,
  pick,
  canOpen,
  open,
  now = () => performance.now(),
}: CosmosInteractionOptions): CosmosInteraction {
  let yaw = INITIAL_YAW;
  let pitch = INITIAL_PITCH;
  let zoom = 1;
  let yawVel = 0;
  let pitchVel = 0;
  let autoWeight = 1;
  let lastNow: number | null = null;
  let releasedAt = -Infinity;
  let hovered: number | null = null;
  let mouse: { x: number; y: number } | null = null;
  let drag: DragState | null = null;
  let pinchDistance: number | null = null;
  const pointers = new Map<number, { x: number; y: number }>();

  const local = (event: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const pinchSpan = (): number => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const refreshHover = (): void => {
    if (drag || !mouse) return;
    hovered = pick(mouse.x, mouse.y);
    canvas.style.cursor = hovered !== null && canOpen(hovered) ? 'pointer' : '';
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const { x, y } = local(event);
    pointers.set(event.pointerId, { x, y });
    if (pointers.size === 1) {
      const at = now();
      drag = {
        id: event.pointerId,
        x,
        y,
        startX: x,
        startY: y,
        startAt: at,
        lastMoveAt: at,
        moved: false,
        touch: event.pointerType !== 'mouse',
      };
      yawVel = 0;
      pitchVel = 0;
      hovered = null;
      canvas.style.cursor = 'grabbing';
      return;
    }
    pinchDistance = pinchSpan();
    if (drag) drag.moved = true;
  };

  const onWindowMove = (event: PointerEvent): void => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    const { x, y } = local(event);
    pointer.x = x;
    pointer.y = y;
    if (pointers.size >= 2 && pinchDistance !== null) {
      const span = pinchSpan();
      if (span > 0 && pinchDistance > 0) {
        zoom = clamp(zoom * (span / pinchDistance), ZOOM_MIN, ZOOM_MAX);
      }
      pinchDistance = span;
      return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const at = now();
    const dt = Math.max(1, at - drag.lastMoveAt);
    const dx = x - drag.x;
    const dy = y - drag.y;
    drag.x = x;
    drag.y = y;
    drag.lastMoveAt = at;
    if (
      !drag.moved &&
      Math.hypot(x - drag.startX, y - drag.startY) > CLICK_SLOP_PX
    ) {
      drag.moved = true;
    }
    const dYaw = dx * ROTATE_PER_PX;
    yaw += dYaw;
    yawVel = clamp(
      yawVel * 0.4 + (dYaw / dt) * 0.6,
      -VELOCITY_CAP,
      VELOCITY_CAP,
    );
    if (drag.touch) return;
    const dPitch = dy * ROTATE_PER_PX;
    pitch = clamp(pitch + dPitch, PITCH_MIN, PITCH_MAX);
    pitchVel = clamp(
      pitchVel * 0.4 + (dPitch / dt) * 0.6,
      -VELOCITY_CAP,
      VELOCITY_CAP,
    );
  };

  const endDrag = (event: PointerEvent, click: boolean): void => {
    if (!drag || drag.id !== event.pointerId) return;
    const at = now();
    const settled = !drag.moved && at - drag.startAt < CLICK_MAX_MS;
    if (at - drag.lastMoveAt > REST_BEFORE_RELEASE_MS) {
      yawVel = 0;
      pitchVel = 0;
    }
    drag = null;
    releasedAt = at;
    canvas.style.cursor = '';
    if (click && settled) {
      const { x, y } = local(event);
      const index = pick(x, y);
      if (index !== null && canOpen(index)) open(index);
    }
    refreshHover();
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size < 2) pinchDistance = null;
    endDrag(event, true);
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size < 2) pinchDistance = null;
    yawVel = 0;
    pitchVel = 0;
    endDrag(event, false);
  };

  const onCanvasMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    mouse = local(event);
    refreshHover();
  };

  const onCanvasLeave = (): void => {
    mouse = null;
    if (drag) return;
    hovered = null;
    canvas.style.cursor = '';
  };

  const onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoom = clamp(
      zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE),
      ZOOM_MIN,
      ZOOM_MAX,
    );
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onCanvasMove);
  canvas.addEventListener('pointerleave', onCanvasLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('pointermove', onWindowMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);

  return {
    orbit: () => ({ yaw, pitch, zoom }),
    hovered: () => hovered,
    advance(): void {
      const at = now();
      const dt = lastNow === null ? 0 : clamp(at - lastNow, 0, MAX_STEP_MS);
      lastNow = at;
      if (dt === 0) return;
      if (drag) {
        autoWeight = Math.max(0, autoWeight - dt / AUTO_FADE_MS);
        return;
      }
      const decay = Math.exp(-dt / FRICTION_MS);
      yaw += yawVel * dt;
      pitch = clamp(pitch + pitchVel * dt, PITCH_MIN, PITCH_MAX);
      yawVel = Math.abs(yawVel) < 1e-6 ? 0 : yawVel * decay;
      pitchVel = Math.abs(pitchVel) < 1e-6 ? 0 : pitchVel * decay;
      const coasting = yawVel !== 0 || pitchVel !== 0;
      if (coasting || at - releasedAt < RESUME_DELAY_MS) {
        autoWeight = Math.max(0, autoWeight - dt / AUTO_FADE_MS);
      } else {
        autoWeight += (1 - autoWeight) * (1 - Math.exp(-dt / RESUME_EASE_MS));
      }
      yaw += AUTO_SPEED * dt * autoWeight;
      refreshHover();
    },
    dispose(): void {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onCanvasMove);
      canvas.removeEventListener('pointerleave', onCanvasLeave);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      canvas.style.cursor = '';
      pointers.clear();
      drag = null;
    },
  };
}
