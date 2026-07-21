'use client';

import { Button } from '@/components/ui/button';
import { FormRenderer } from './form-renderer';
import type { ProgramTemplateDefinition } from './program-templates';

export function ProgramTypeModal({
  definitions,
  selected,
  onSelect,
  onContinue,
  onCancel,
}: {
  readonly definitions: readonly ProgramTemplateDefinition[];
  readonly selected: ProgramTemplateDefinition | null;
  readonly onSelect: (definition: ProgramTemplateDefinition) => void;
  readonly onContinue: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="presentation">
      <section aria-modal="true" aria-labelledby="program-type-title" className="grid w-full max-w-4xl gap-6 rounded-lg bg-background p-6 shadow-lg md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]" role="dialog">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <h2 id="program-type-title" className="text-xl font-semibold">프로그램 유형 선택</h2>
            <Button type="button" variant="ghost" onClick={onCancel}>닫기</Button>
          </div>
          <div className="space-y-2" role="radiogroup" aria-label="프로그램 유형">
            {definitions.map((definition) => (
              <label key={definition.category} className="flex cursor-pointer items-center gap-2 rounded-md border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input checked={selected?.category === definition.category} name="program-category" type="radio" value={definition.category} onChange={() => onSelect(definition)} />
                <span className="text-sm font-medium">{definition.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex min-h-64 flex-col justify-between rounded-md border border-border p-4">
          {selected ? <FormRenderer template={selected.template} /> : <p className="text-sm text-muted-foreground">유형을 선택하면 고정 신청 템플릿을 미리 볼 수 있습니다.</p>}
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>취소</Button>
            <Button type="button" disabled={!selected} onClick={onContinue}>이 유형으로 계속</Button>
          </div>
        </div>
      </section>
    </div>
  );
}
