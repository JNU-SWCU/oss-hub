import { cn } from '@/lib/utils';

export const ADMIN_ACCESS_OVERLAY_BREAKPOINT_PX = 768;

export type AdminAccessOverlayVariant = 'sheet' | 'inspector';

export function selectAdminAccessOverlayVariant(
  viewportWidthPx: number,
): AdminAccessOverlayVariant {
  return viewportWidthPx >= ADMIN_ACCESS_OVERLAY_BREAKPOINT_PX
    ? 'inspector'
    : 'sheet';
}

const OVERLAY_BASE_CLASS_NAME =
  'fixed inset-0 z-50 bg-foreground/40 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=open]:fade-in-0 motion-reduce:transition-none motion-reduce:animate-none';

export function adminAccessOverlayScrimClassName(): string {
  return OVERLAY_BASE_CLASS_NAME;
}

const CONTENT_BASE_CLASS_NAME =
  'fixed z-50 flex flex-col gap-4 overflow-y-auto border-border bg-background shadow-lg focus:outline-none motion-reduce:transition-none motion-reduce:animate-none';

const SHEET_CONTENT_CLASS_NAME =
  'inset-x-0 bottom-0 top-auto right-auto left-0 max-h-[85dvh] w-full rounded-t-2xl border-t p-5 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:slide-out-to-bottom motion-safe:data-[state=open]:slide-in-from-bottom';

const INSPECTOR_CONTENT_CLASS_NAME =
  'inset-y-0 right-0 left-auto bottom-auto h-full w-full max-w-md border-l p-6 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:slide-out-to-right motion-safe:data-[state=open]:slide-in-from-right';

export function adminAccessOverlayContentClassName(
  variant: AdminAccessOverlayVariant,
): string {
  return cn(
    CONTENT_BASE_CLASS_NAME,
    variant === 'sheet'
      ? SHEET_CONTENT_CLASS_NAME
      : INSPECTOR_CONTENT_CLASS_NAME,
  );
}
