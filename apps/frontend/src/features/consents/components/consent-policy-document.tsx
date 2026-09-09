'use client';

import { useEffect, useRef, type ComponentProps } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ConsentRequiredItem } from '../api';

export const CONSENT_POLICY_DOCUMENT_ID = 'consent-policy-document';

export function ConsentPolicyInline({
  item,
  onClose,
}: {
  readonly item: ConsentRequiredItem;
  readonly onClose: () => void;
}) {
  const regionRef = useRef<HTMLElement>(null);
  const titleId = `${CONSENT_POLICY_DOCUMENT_ID}-title`;

  useEffect(() => {
    regionRef.current?.focus();
  }, [item.key]);

  return (
    <section
      ref={regionRef}
      id={CONSENT_POLICY_DOCUMENT_ID}
      data-slot="consent-policy-inline"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="flex w-full max-w-[808px] min-h-0 min-w-0 flex-1 flex-col gap-3 focus:outline-none"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="flex items-center justify-between gap-3 px-5">
        <h2
          id={titleId}
          className="font-heading text-lg font-semibold text-cosmos-copy"
        >
          {item.label} 전문
        </h2>
        <ConsentPolicyCloseButton onClick={onClose} />
      </div>
      <ConsentPolicyDocumentFrame item={item} className="min-h-0 flex-1" />
    </section>
  );
}

export function ConsentPolicyCloseButton(props: ComponentProps<'button'>) {
  return (
    <Button
      data-slot="consent-policy-close"
      className="shrink-0 text-cosmos-copy hover:bg-cosmos-muted/10 hover:text-cosmos-copy"
      type="button"
      variant="ghost"
      size="icon"
      aria-label="전문 닫기"
      {...props}
    >
      <X aria-hidden="true" />
    </Button>
  );
}

export function ConsentPolicyDocumentFrame({
  item,
  className,
}: {
  readonly item: ConsentRequiredItem;
  readonly className?: string;
}) {
  return (
    <iframe
      className={cn('w-full rounded-card bg-cosmos-near', className)}
      sandbox=""
      src={item.documentUrl}
      title={`${item.label} 전문`}
    />
  );
}
