import type { EditableMilestoneDocument } from './api';
import { milestoneDocumentTemplateHref } from './milestone-document-api';

export function MilestoneDocumentRow({
  milestoneId,
  document,
}: {
  readonly milestoneId: string;
  readonly document: EditableMilestoneDocument;
}) {
  return (
    <li className="flex flex-wrap gap-x-1 text-small text-muted-foreground">
      <span>
        {document.name} · {document.required ? '필수' : '선택'}
      </span>
      {document.templateFileName ? (
        <a
          className="underline underline-offset-2"
          href={milestoneDocumentTemplateHref(milestoneId, document.id)}
          download={document.templateFileName}
        >
          {document.templateFileName}
        </a>
      ) : null}
    </li>
  );
}
