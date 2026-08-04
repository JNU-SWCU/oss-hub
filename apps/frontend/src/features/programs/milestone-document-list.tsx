'use client';

import { Download, Pencil, Upload } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import {
  listMilestoneDocuments,
  milestoneDocumentTemplateHref,
  submitMilestoneDocument,
  uploadMilestoneDocumentFile,
  uploadMilestoneDocumentTemplate,
  type MilestoneDocument,
  type MilestoneDocumentSubmissionContent,
} from './milestone-document-api';
import { formatSeoulShortDateTime } from './program-detail-format';
import type { ViewerRole } from './types';

export type MilestoneDocumentSectionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'ready';
      readonly documents: readonly MilestoneDocument[];
    };

function isStaffRole(role: ViewerRole): role is 'STAFF' | 'ADMIN' {
  return role === 'STAFF' || role === 'ADMIN';
}

/** 순수 렌더 본문 — 컨테이너의 fetch/상태 관리와 분리해 정적 렌더로 테스트한다. */
export function MilestoneDocumentSectionBody({
  state,
  viewerRole,
  closed,
  onRetry,
  onDocumentChange,
}: {
  readonly state: MilestoneDocumentSectionState;
  readonly viewerRole: 'STUDENT' | 'STAFF' | 'ADMIN';
  readonly closed: boolean;
  readonly onRetry: () => void;
  readonly onDocumentChange: (document: MilestoneDocument) => void;
}) {
  if (state.kind === 'loading') return null;
  if (state.kind === 'failed') {
    return (
      <div className="grid gap-2 border-t border-border/50 pt-3 text-small text-muted-foreground">
        <p>제출 서류를 불러오지 못했습니다.</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          onClick={onRetry}
        >
          다시 시도
        </Button>
      </div>
    );
  }
  if (state.documents.length === 0) return null;

  const staff = isStaffRole(viewerRole);
  const total = state.documents.length;
  const completed = state.documents.filter(
    (document) => document.viewerSubmission?.submitted,
  ).length;
  const headerLabel = staff
    ? `${closed ? '마감' : '접수중'} · ${total}개 항목`
    : `제출 ${completed}/${total} 완료`;

  return (
    <div className="grid gap-3 border-t border-border/50 pt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-small font-bold text-muted-foreground">
          제출 서류
        </h3>
        <span className="text-small text-muted-foreground">{headerLabel}</span>
      </div>
      <ul className="grid gap-3" data-testid="milestone-document-rows">
        {state.documents.map((document) =>
          staff ? (
            <StaffDocumentRow
              key={document.id}
              document={document}
              onChange={onDocumentChange}
            />
          ) : (
            <StudentDocumentRow
              key={document.id}
              document={document}
              closed={closed}
              onChange={onDocumentChange}
            />
          ),
        )}
      </ul>
    </div>
  );
}

/** 마일스톤 하나의 "제출 서류" 블록 — role null/PENDING이거나 서류가 없으면 아무것도 그리지 않는다. */
export function MilestoneDocumentSection({
  milestoneId,
  viewerRole,
  closed,
}: {
  readonly milestoneId: string;
  readonly viewerRole: ViewerRole;
  readonly closed: boolean;
}) {
  const [state, setState] = useState<MilestoneDocumentSectionState>({
    kind: 'loading',
  });
  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({
        kind: 'ready',
        documents: await listMilestoneDocuments(milestoneId),
      });
    } catch {
      setState({ kind: 'failed' });
    }
  }, [milestoneId]);
  useEffect(() => {
    if (viewerRole === null || viewerRole === 'PENDING') return;
    void load();
  }, [load, viewerRole]);

  if (viewerRole === null || viewerRole === 'PENDING') return null;

  return (
    <MilestoneDocumentSectionBody
      state={state}
      viewerRole={viewerRole}
      closed={closed}
      onRetry={() => void load()}
      onDocumentChange={(updated) => {
        setState((previous) =>
          previous.kind === 'ready'
            ? {
                kind: 'ready',
                documents: previous.documents.map((document) =>
                  document.id === updated.id ? updated : document,
                ),
              }
            : previous,
        );
      }}
    />
  );
}

function DocumentName({ document }: { readonly document: MilestoneDocument }) {
  return (
    <span className="min-w-0 flex-1 truncate text-small">
      {document.name}
      {document.required ? (
        <span aria-label="필수" className="ml-0.5 text-destructive">
          *
        </span>
      ) : null}
    </span>
  );
}

function submitErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.problem.detail : fallback;
}

/** 교직원 행 — 팀 제출 카운트 + 양식 올리기/교체. */
function StaffDocumentRow({
  document,
  onChange,
}: {
  readonly document: MilestoneDocument;
  readonly onChange: (document: MilestoneDocument) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadMilestoneDocumentTemplate(
        document.milestoneId,
        document.id,
        file,
      );
      onChange({ ...document, hasTemplateFile: true });
    } catch (uploadError: unknown) {
      setError(submitErrorMessage(uploadError, '양식 업로드에 실패했습니다.'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <li className="grid gap-1" data-testid="milestone-document-row">
      <div className="flex flex-wrap items-center gap-3">
        <DocumentName document={document} />
        {document.teamSubmissionCount ? (
          <StatusBadge variant="recruiting">
            {document.teamSubmissionCount.submitted} /{' '}
            {document.teamSubmissionCount.total}팀 제출
          </StatusBadge>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload aria-hidden />
          {document.hasTemplateFile ? '양식 교체' : '양식 올리기'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          aria-label={`${document.name} 양식 파일 선택`}
          onChange={(event) => void handleFile(event)}
        />
      </div>
      {error ? <p className="text-small text-destructive">{error}</p> : null}
    </li>
  );
}

/** 학생 행 — 상태 표시 + 양식 다운로드 + 제출/재제출. */
function StudentDocumentRow({
  document,
  closed,
  onChange,
}: {
  readonly document: MilestoneDocument;
  readonly closed: boolean;
  readonly onChange: (document: MilestoneDocument) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [releaseUrl, setReleaseUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submitted = document.viewerSubmission?.submitted ?? false;
  const submittedAt = document.viewerSubmission?.submittedAt ?? null;

  const finish = useCallback(
    async (content: MilestoneDocumentSubmissionContent) => {
      setSubmitting(true);
      setError(null);
      try {
        const result = await submitMilestoneDocument(
          document.milestoneId,
          document.id,
          content,
        );
        onChange({
          ...document,
          viewerSubmission: {
            submitted: true,
            submittedAt: result.submittedAt,
          },
        });
        setEditing(false);
        setText('');
        setReleaseUrl('');
      } catch (submitError: unknown) {
        setError(submitErrorMessage(submitError, '제출에 실패했습니다.'));
      } finally {
        setSubmitting(false);
      }
    },
    [document, onChange],
  );

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setSubmitting(true);
    setError(null);
    try {
      const uploaded = await uploadMilestoneDocumentFile(
        document.milestoneId,
        document.id,
        file,
      );
      await finish({ type: 'FILE', fileId: uploaded.fileId });
    } catch (uploadError: unknown) {
      setError(submitErrorMessage(uploadError, '파일 업로드에 실패했습니다.'));
      setSubmitting(false);
    }
  }

  const actionLabel = submitted ? '수정' : '올리기';
  const actionIcon = submitted ? (
    <Pencil aria-hidden />
  ) : (
    <Upload aria-hidden />
  );

  return (
    <li className="grid gap-2" data-testid="milestone-document-row">
      <div className="flex flex-wrap items-center gap-3">
        <DocumentName document={document} />
        <StatusBadge variant={submitted ? 'approved' : 'closed'}>
          {submitted && submittedAt
            ? `제출함 · ${formatSeoulShortDateTime(submittedAt)}`
            : '미제출'}
        </StatusBadge>
        {document.hasTemplateFile ? (
          <Button asChild size="sm" variant="ghost">
            <a
              href={milestoneDocumentTemplateHref(
                document.milestoneId,
                document.id,
              )}
              target="_blank"
              rel="noreferrer"
            >
              <Download aria-hidden /> 양식
            </a>
          </Button>
        ) : null}
        {document.submissionType === 'FILE' ? (
          <>
            <Button
              type="button"
              size="sm"
              variant={submitted ? 'ghost' : 'default'}
              disabled={closed || submitting}
              onClick={() => fileInputRef.current?.click()}
            >
              {actionIcon} {actionLabel}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              aria-label={`${document.name} 제출 파일 선택`}
              onChange={(event) => void handleFile(event)}
            />
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant={submitted ? 'ghost' : 'default'}
            disabled={closed}
            onClick={() => setEditing((value) => !value)}
          >
            {actionIcon} {actionLabel}
          </Button>
        )}
      </div>
      {editing && document.submissionType === 'TEXT' ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = text.trim();
            if (value.length === 0) return;
            void finish({ type: 'TEXT', text: value });
          }}
        >
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="제출 내용"
            className="min-w-0 flex-1"
          />
          <Button type="submit" size="sm" disabled={submitting}>
            제출
          </Button>
        </form>
      ) : null}
      {editing && document.submissionType === 'REPOSITORY_RELEASE' ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = releaseUrl.trim();
            if (value.length === 0) return;
            void finish({ type: 'REPOSITORY_RELEASE', releaseUrl: value });
          }}
        >
          <Input
            value={releaseUrl}
            onChange={(event) => setReleaseUrl(event.target.value)}
            placeholder="릴리스 URL"
            className="min-w-0 flex-1"
          />
          <Button type="submit" size="sm" disabled={submitting}>
            제출
          </Button>
        </form>
      ) : null}
      {error ? <p className="text-small text-destructive">{error}</p> : null}
    </li>
  );
}
