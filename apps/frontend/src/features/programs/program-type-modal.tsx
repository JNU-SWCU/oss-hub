'use client';

import { Dialog } from 'radix-ui';
import type { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { FormRenderer } from './form-renderer';
import type { ProgramTemplateDefinition } from './program-templates';

export function ProgramTypeModal({
  definitions,
  selected,
  onSelect,
  onContinue,
  onCancel,
  returnFocusRef,
}: {
  readonly definitions: readonly ProgramTemplateDefinition[];
  readonly selected: ProgramTemplateDefinition | null;
  readonly onSelect: (definition: ProgramTemplateDefinition) => void;
  readonly onContinue: () => void;
  readonly onCancel: () => void;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 gap-6 overflow-y-auto rounded-card bg-background p-card shadow-lg outline-none md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"
          onCloseAutoFocus={(event) => {
            const returnTarget = returnFocusRef.current;
            if (returnTarget === null) return;
            event.preventDefault();
            returnTarget.focus();
          }}
        >
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <Dialog.Title asChild>
                <h2 className="font-heading text-section font-semibold tracking-[-0.02em]">
                  프로그램 유형 선택
                </h2>
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost">
                  닫기
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              만들 프로그램의 유형을 선택하고 신청 양식을 미리 확인하세요.
            </Dialog.Description>
            <div
              className="space-y-2"
              role="radiogroup"
              aria-label="프로그램 유형"
            >
              {definitions.map((definition) => (
                <label
                  key={definition.category}
                  className="flex min-h-control cursor-pointer items-center gap-2 rounded-control border border-border px-4 py-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <input
                    checked={selected?.category === definition.category}
                    name="program-category"
                    type="radio"
                    value={definition.category}
                    onChange={() => onSelect(definition)}
                  />
                  <span className="font-medium">{definition.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex min-h-64 flex-col justify-between rounded-card border border-border p-card">
            {selected ? (
              <FormRenderer template={selected.template} mode="preview" />
            ) : (
              <p className="text-small text-muted-foreground">
                유형을 선택하면 고정 신청 템플릿을 미리 볼 수 있습니다.
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline">
                  취소
                </Button>
              </Dialog.Close>
              <Button type="button" disabled={!selected} onClick={onContinue}>
                이 유형으로 계속
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
