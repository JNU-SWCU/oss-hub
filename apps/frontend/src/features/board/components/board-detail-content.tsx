'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { AlertCircle, ChevronLeft, Pin, PinOff, RotateCcw } from 'lucide-react';
import { PageHeader, StatusBadge } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  BOARD_CATEGORY_BADGE_VARIANT,
  BOARD_CATEGORY_LABELS,
  BOARD_COMMENT_AUTHOR_LABEL,
  BOARD_COMMENT_AUTHOR_ROLE_VARIANT,
  boardCommentAuthorRoleLabel,
  boardPostAuthorRoleLabel,
  formatBoardDateTime,
  type BoardPostInputErrors,
} from '../board-format';
import { boardListHref } from '../board-paths';
import type { BoardDetailState, BoardPostDetail } from '../types';

const EDIT_TITLE_ERROR_ID = 'board-edit-title-error';

const EDIT_BODY_ERROR_ID = 'board-edit-body-error';

const COMMENT_ERROR_ID = 'board-comment-error';

export interface BoardDetailContentProps {
  readonly programId: string;
  readonly isStaff: boolean;
  readonly state: BoardDetailState;
  readonly editing: boolean;
  readonly editTitle: string;
  readonly editBody: string;
  readonly editSubmitting: boolean;

  readonly editErrors: BoardPostInputErrors;

  readonly editShowFieldErrors: boolean;

  readonly editSubmitError: string | null;
  readonly pinSubmitting: boolean;
  readonly pinError: string | null;
  readonly deleteSubmitting: boolean;
  readonly deleteError: string | null;
  readonly commentDraft: string;
  readonly commentSubmitting: boolean;
  readonly commentDraftError: string | null;
  readonly commentShowDraftError: boolean;

  readonly commentSubmitError: string | null;
  readonly deletingCommentId: string | null;
  readonly onRetry: () => void;
  readonly onToggleEdit: () => void;
  readonly onEditTitleChange: (value: string) => void;
  readonly onEditBodyChange: (value: string) => void;
  readonly onSubmitEdit: () => void;
  readonly onDeletePost: () => void;
  readonly onTogglePin: () => void;
  readonly onCommentDraftChange: (value: string) => void;
  readonly onSubmitComment: () => void;
  readonly onDeleteComment: (commentId: string) => void;
}

function PostBody({ post }: { readonly post: BoardPostDetail }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="max-w-[70ch] whitespace-pre-wrap text-sm leading-7 text-foreground [overflow-wrap:anywhere]">
          {post.body}
        </p>
      </CardContent>
    </Card>
  );
}

export function BoardDetailContent({
  programId,
  isStaff,
  state,
  editing,
  editTitle,
  editBody,
  editSubmitting,
  editErrors,
  editShowFieldErrors,
  editSubmitError,
  pinSubmitting,
  pinError,
  deleteSubmitting,
  deleteError,
  commentDraft,
  commentSubmitting,
  commentDraftError,
  commentShowDraftError,
  commentSubmitError,
  deletingCommentId,
  onRetry,
  onToggleEdit,
  onEditTitleChange,
  onEditBodyChange,
  onSubmitEdit,
  onDeletePost,
  onTogglePin,
  onCommentDraftChange,
  onSubmitComment,
  onDeleteComment,
}: BoardDetailContentProps) {
  const editTitleRef = useRef<HTMLInputElement>(null);
  const editBodyRef = useRef<HTMLTextAreaElement>(null);
  const commentRef = useRef<HTMLInputElement>(null);
  const showEditTitleError = editShowFieldErrors && editErrors.title !== null;
  const showEditBodyError = editShowFieldErrors && editErrors.body !== null;
  const showCommentError = commentShowDraftError && commentDraftError !== null;

  function handleSubmitEdit(): void {
    onSubmitEdit();
    if (editErrors.title !== null) editTitleRef.current?.focus();
    else if (editErrors.body !== null) editBodyRef.current?.focus();
  }

  function handleSubmitComment(): void {
    onSubmitComment();
    if (commentDraftError !== null) commentRef.current?.focus();
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-5 sm:p-8">
      <Link
        href={boardListHref(programId)}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        게시판 목록
      </Link>

      {state.kind === 'loading' ? (
        <p
          role="status"
          aria-label="게시글을 불러오는 중"
          className="text-sm text-muted-foreground"
        >
          게시글을 불러오는 중…
        </p>
      ) : state.kind === 'not-found' ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>게시글을 찾을 수 없습니다</AlertTitle>
          <AlertDescription>
            삭제되었거나 존재하지 않는 게시글입니다.
          </AlertDescription>
        </Alert>
      ) : state.kind === 'error' ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>게시글을 불러오지 못했습니다</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{state.message}</span>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw aria-hidden="true" />
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : editing ? (
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <Field data-invalid={showEditTitleError || undefined}>
              <FieldLabel htmlFor="board-edit-title">제목</FieldLabel>
              <Input
                id="board-edit-title"
                ref={editTitleRef}
                value={editTitle}
                maxLength={200}
                disabled={editSubmitting}
                aria-invalid={showEditTitleError}
                aria-describedby={
                  showEditTitleError ? EDIT_TITLE_ERROR_ID : undefined
                }
                onChange={(event) => onEditTitleChange(event.target.value)}
                placeholder="제목"
              />
              {showEditTitleError ? (
                <FieldError id={EDIT_TITLE_ERROR_ID}>
                  {editErrors.title}
                </FieldError>
              ) : null}
            </Field>
            <Field data-invalid={showEditBodyError || undefined}>
              <FieldLabel htmlFor="board-edit-body">내용</FieldLabel>
              <Textarea
                id="board-edit-body"
                ref={editBodyRef}
                value={editBody}
                maxLength={10000}
                rows={6}
                disabled={editSubmitting}
                aria-invalid={showEditBodyError}
                aria-describedby={
                  showEditBodyError ? EDIT_BODY_ERROR_ID : undefined
                }
                onChange={(event) => onEditBodyChange(event.target.value)}
                placeholder="내용"
                className="min-h-28"
              />
              {showEditBodyError ? (
                <FieldError id={EDIT_BODY_ERROR_ID}>
                  {editErrors.body}
                </FieldError>
              ) : null}
            </Field>
            {editSubmitError ? (
              <Alert variant="destructive">
                <AlertDescription>{editSubmitError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                disabled={editSubmitting}
                onClick={handleSubmitEdit}
              >
                {editSubmitting ? '저장 중…' : '저장'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={editSubmitting}
                onClick={onToggleEdit}
              >
                취소
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <PageHeader
            title={state.post.title}
            description={`${state.post.authorName ?? boardPostAuthorRoleLabel(state.post.category)} · ${boardPostAuthorRoleLabel(state.post.category)} · ${formatBoardDateTime(state.post.createdAt)}`}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  variant={BOARD_CATEGORY_BADGE_VARIANT[state.post.category]}
                >
                  {BOARD_CATEGORY_LABELS[state.post.category]}
                </StatusBadge>
                {isStaff ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pinSubmitting}
                    onClick={onTogglePin}
                  >
                    {state.post.pinned ? (
                      <PinOff aria-hidden="true" />
                    ) : (
                      <Pin aria-hidden="true" />
                    )}
                    {state.post.pinned ? '고정 해제' : '고정'}
                  </Button>
                ) : null}
                {state.post.canEdit ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onToggleEdit}
                  >
                    수정
                  </Button>
                ) : null}
                {state.post.canDelete ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={deleteSubmitting}
                    onClick={onDeletePost}
                  >
                    {deleteSubmitting ? '삭제 중…' : '삭제'}
                  </Button>
                ) : null}
              </div>
            }
          />
          {pinError ? (
            <Alert variant="destructive">
              <AlertDescription>{pinError}</AlertDescription>
            </Alert>
          ) : null}
          {deleteError ? (
            <Alert variant="destructive">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          ) : null}
          <PostBody post={state.post} />

          <h2 className="text-base font-bold text-foreground">
            댓글 {state.post.commentCount}
          </h2>
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              {state.post.comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  아직 댓글이 없습니다.
                </p>
              ) : (
                state.post.comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="flex flex-wrap items-baseline gap-2 border-b border-border py-2.5 text-sm last:border-b-0"
                  >
                    <span className="font-bold">
                      {comment.authorName ?? BOARD_COMMENT_AUTHOR_LABEL}
                    </span>
                    <StatusBadge
                      variant={
                        BOARD_COMMENT_AUTHOR_ROLE_VARIANT[comment.authorRole]
                      }
                      aria-label={`${boardCommentAuthorRoleLabel(comment.authorRole)} 역할`}
                    >
                      {boardCommentAuthorRoleLabel(comment.authorRole)}
                    </StatusBadge>

                    <span className="min-w-0 flex-1 leading-6 text-foreground [overflow-wrap:anywhere]">
                      {comment.body}
                    </span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {formatBoardDateTime(comment.createdAt)}
                    </span>
                    {comment.canDelete ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={deletingCommentId === comment.id}
                        onClick={() => onDeleteComment(comment.id)}
                      >
                        삭제
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
              {commentSubmitError ? (
                <Alert variant="destructive">
                  <AlertDescription>{commentSubmitError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="mt-2 flex items-start gap-2">
                <Field
                  className="min-w-0 flex-1"
                  data-invalid={showCommentError || undefined}
                >
                  <Input
                    aria-label="댓글 내용"
                    ref={commentRef}
                    value={commentDraft}
                    maxLength={2000}
                    disabled={commentSubmitting}
                    aria-invalid={showCommentError}
                    aria-describedby={
                      showCommentError ? COMMENT_ERROR_ID : undefined
                    }
                    onChange={(event) =>
                      onCommentDraftChange(event.target.value)
                    }
                    placeholder="댓글을 입력하세요"
                  />
                  {showCommentError ? (
                    <FieldError id={COMMENT_ERROR_ID}>
                      {commentDraftError}
                    </FieldError>
                  ) : null}
                </Field>
                <Button
                  type="button"
                  disabled={commentSubmitting}
                  onClick={handleSubmitComment}
                >
                  댓글 달기
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
