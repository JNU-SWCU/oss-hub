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

function FormSection({
  title,
  description,
  className,
  children,
  ...props
}: FormSectionProps) {
  return (
    <FieldSet className={cn('gap-6', className)} {...props}>
      <FieldLegend className="font-heading leading-tight break-keep text-pretty">
        {title}
      </FieldLegend>
      {description ? (
        <FieldDescription className="break-keep text-pretty">
          {description}
        </FieldDescription>
      ) : null}
      <FieldGroup>{children}</FieldGroup>
    </FieldSet>
  );
}

export { FormSection };
export type { FormSectionProps };
