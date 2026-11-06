import type { EditableRequirement } from '../authoring/dto';
import { requirementTemplateHref } from './requirement-api';

export function RequirementRow({
  milestoneId,
  document,
}: {
  readonly milestoneId: string;
  readonly document: EditableRequirement;
}) {
  return (
    <li className="flex flex-wrap gap-x-1 text-small text-muted-foreground">
      <span>
        {document.name} · {document.required ? '필수' : '선택'}
      </span>
      {document.templateFileName ? (
        <a
          className="underline underline-offset-2"
          href={requirementTemplateHref(milestoneId, document.id)}
          download={document.templateFileName}
        >
          {document.templateFileName}
        </a>
      ) : null}
    </li>
  );
}
