import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const radixState = vi.hoisted(() => ({
  onOpenChange: null as ((open: boolean) => void) | null,
}));

vi.mock('radix-ui', () => ({
  AlertDialog: {
    Root: ({
      children,
      onOpenChange,
    }: {
      readonly children: ReactNode;
      readonly onOpenChange: (open: boolean) => void;
    }) => {
      radixState.onOpenChange = onOpenChange;
      return children;
    },
    Overlay: () => <div data-radix-overlay="" />,
    Content: ({ children }: { readonly children: ReactNode }) => (
      <section data-radix-content="">{children}</section>
    ),
    Title: ({ children }: { readonly children: ReactNode }) => (
      <h2>{children}</h2>
    ),
    Description: ({ children }: { readonly children: ReactNode }) => (
      <p>{children}</p>
    ),
    Cancel: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
    Action: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
  },
}));

import { ApplicationConfirmationDialog } from './application-confirmation-dialog';

describe('ApplicationConfirmationDialog', () => {
  it('Radix AlertDialog? ???? ?? ??? ????', () => {
    const onClose = vi.fn();

    const html = renderToStaticMarkup(
      <ApplicationConfirmationDialog
        kind="save"
        submitting={false}
        onClose={onClose}
        onConfirm={() => undefined}
      />,
    );
    radixState.onOpenChange?.(false);

    expect(html).toContain('data-radix-content');
    expect(radixState.onOpenChange).not.toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
