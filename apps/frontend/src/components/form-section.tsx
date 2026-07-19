import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';

interface FormSectionProps extends Omit<
  React.ComponentProps<'fieldset'>,
  'title'
> {
  title: React.ReactNode;
  description?: React.ReactNode;
}

// 생성·편집·신청 다단 폼에서 여러 필드를 구역(제목+설명+필드 슬롯)으로 묶는 레이어.
// B-5 프리미티브(Field/FieldSet/FieldLegend/FieldGroup) 조합으로만 구성한다.
function FormSection({
  title,
  description,
  className,
  children,
  ...props
}: FormSectionProps) {
  return (
    <FieldSet className={cn(className)} {...props}>
      <FieldLegend>{title}</FieldLegend>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldGroup>{children}</FieldGroup>
    </FieldSet>
  );
}

export { FormSection };
export type { FormSectionProps };
