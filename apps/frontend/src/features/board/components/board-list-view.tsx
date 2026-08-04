'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, MessageSquare, Pin, RotateCcw } from 'lucide-react';
import {
  DataTable,
  EmptyState,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
} from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { createBoardPost, listBoardPosts } from '../api';
import {
  BOARD_CATEGORY_BADGE_VARIANT,
  BOARD_CATEGORY_LABELS,
  boardPostAuthorRoleLabel,
  boardSubtitle,
  boardWriteButtonLabel,
  formatBoardDateTime,
  mapBoardError,
  validateBoardPostInput,
} from '../board-format';
import { boardPostHref } from '../board-paths';
import type { BoardListState, BoardPostSummary } from '../types';

const PAGE_SIZE = 20;

function columnsFor(programId: string): DataTableColumn<BoardPostSummary>[] {
  return [
    {
      id: 'category',
      header: '구분',
      cell: (post) => (
        <StatusBadge variant={BOARD_CATEGORY_BADGE_VARIANT[post.category]}>
          {BOARD_CATEGORY_LABELS[post.category]}
        </StatusBadge>
      ),
      headClassName: 'w-20',
    },
    {
      id: 'title',
      header: '제목',
      cell: (post) => (
        <Link
          href={boardPostHref(programId, post.id)}
          className="flex min-w-0 items-center gap-1.5 font-medium hover:underline"
        >
          {post.pinned ? (
            <Pin
              aria-label="고정된 글"
              className="size-3.5 shrink-0 text-primary"
            />
          ) : null}
          <span className="truncate">{post.title}</span>
        </Link>
      ),
    },
    {
      id: 'author',
      header: '작성자',
      cell: (post) => (
        <span className="text-muted-foreground">
          {boardPostAuthorRoleLabel(post.category)}
        </span>
      ),
      headClassName: 'w-24',
    },
    {
      id: 'createdAt',
      header: '작성일',
      cell: (post) => (
        <span className="text-muted-foreground tabular-nums">
          {formatBoardDateTime(post.createdAt)}
        </span>
      ),
      headClassName: 'w-44',
    },
    {
      id: 'commentCount',
      header: '댓글',
      cell: (post) => (
        <span className="text-muted-foreground tabular-nums">
          {post.commentCount}
        </span>
      ),
      cellClassName: 'text-right',
      headClassName: 'w-16 text-right',
    },
  ];
}

export interface BoardListContentProps {
  readonly programId: string;
  readonly isStaff: boolean;
  readonly state: BoardListState;
  readonly page: number;
  readonly newPostOpen: boolean;
  readonly newPostTitle: string;
  readonly newPostBody: string;
  readonly newPostSubmitting: boolean;
  readonly newPostError: string | null;
  readonly onToggleNewPost: () => void;
  readonly onTitleChange: (value: string) => void;
  readonly onBodyChange: (value: string) => void;
  readonly onSubmitNewPost: () => void;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
}

export function BoardListContent({
  programId,
  isStaff,
  state,
  page,
  newPostOpen,
  newPostTitle,
  newPostBody,
  newPostSubmitting,
  newPostError,
  onToggleNewPost,
  onTitleChange,
  onBodyChange,
  onSubmitNewPost,
  onPageChange,
  onRetry,
}: BoardListContentProps) {
  const columns = columnsFor(programId);
  const items = state.kind === 'ready' ? state.page.items : [];
  const total = state.kind === 'ready' ? state.page.total : 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-5 sm:p-8">
      <PageHeader
        title="게시판"
        description={boardSubtitle(isStaff)}
        actions={
          <Button type="button" onClick={onToggleNewPost}>
            {boardWriteButtonLabel(isStaff)}
          </Button>
        }
      />
      {newPostOpen ? (
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <Field>
              <FieldLabel htmlFor="board-new-post-title">제목</FieldLabel>
              <Input
                id="board-new-post-title"
                value={newPostTitle}
                maxLength={200}
                disabled={newPostSubmitting}
                onChange={(event) => onTitleChange(event.target.value)}
                placeholder="제목"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="board-new-post-body">내용</FieldLabel>
              <textarea
                id="board-new-post-body"
                value={newPostBody}
                maxLength={10000}
                rows={4}
                disabled={newPostSubmitting}
                onChange={(event) => onBodyChange(event.target.value)}
                placeholder="내용"
                className="min-h-28 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </Field>
            {newPostError ? (
              <Alert variant="destructive">
                <AlertDescription>{newPostError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={newPostSubmitting}
                onClick={onSubmitNewPost}
              >
                {newPostSubmitting ? '올리는 중…' : '올리기'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={newPostSubmitting}
                onClick={onToggleNewPost}
              >
                취소
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {state.kind === 'error' ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>게시판을 불러오지 못했습니다</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{state.message}</span>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw aria-hidden="true" />
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : state.kind === 'ready' && items.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="size-8" />}
          title="아직 등록된 글이 없습니다"
          description="첫 글을 남겨 보세요."
        />
      ) : (
        <DataTable
          columns={columns}
          data={[...items]}
          rowKey={(post) => post.id}
          isLoading={state.kind === 'loading'}
          loadingSlot="게시판을 불러오는 중…"
        />
      )}
      {state.kind === 'ready' && total > PAGE_SIZE ? (
        <nav
          aria-label="게시판 페이지"
          className="flex items-center justify-center gap-3"
        >
          <Button
            type="button"
            variant="outline"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            이전
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            다음
          </Button>
        </nav>
      ) : null}
    </main>
  );
}

export function BoardListView({
  programId,
  isStaff,
}: {
  readonly programId: string;
  readonly isStaff: boolean;
}) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<BoardListState>({ kind: 'loading' });
  const [newPostOpen, setNewPostOpen] = useState(false);
  const [newPostTitle, setNewPostTitle] = useState('');
  const [newPostBody, setNewPostBody] = useState('');
  const [newPostSubmitting, setNewPostSubmitting] = useState(false);
  const [newPostError, setNewPostError] = useState<string | null>(null);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    listBoardPosts(programId, { page, limit: PAGE_SIZE })
      .then((result) => {
        if (active) setState({ kind: 'ready', page: result });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message =
          error instanceof ApiError
            ? mapBoardError(error.problem)
            : '잠시 후 다시 시도해 주세요.';
        setState({ kind: 'error', message });
      });
    return () => {
      active = false;
    };
  }, [programId, page, attempt]);

  const toggleNewPost = useCallback(() => {
    setNewPostOpen((open) => !open);
    setNewPostTitle('');
    setNewPostBody('');
    setNewPostError(null);
  }, []);

  const submitNewPost = useCallback(() => {
    const validationError = validateBoardPostInput({
      title: newPostTitle,
      body: newPostBody,
    });
    if (validationError) {
      setNewPostError(validationError);
      return;
    }
    setNewPostSubmitting(true);
    setNewPostError(null);
    createBoardPost(programId, { title: newPostTitle, body: newPostBody })
      .then((post) => {
        router.push(boardPostHref(programId, post.id));
      })
      .catch((error: unknown) => {
        setNewPostSubmitting(false);
        setNewPostError(
          error instanceof ApiError
            ? mapBoardError(error.problem)
            : '잠시 후 다시 시도해 주세요.',
        );
      });
  }, [programId, newPostTitle, newPostBody, router]);

  return (
    <BoardListContent
      programId={programId}
      isStaff={isStaff}
      state={state}
      page={page}
      newPostOpen={newPostOpen}
      newPostTitle={newPostTitle}
      newPostBody={newPostBody}
      newPostSubmitting={newPostSubmitting}
      newPostError={newPostError}
      onToggleNewPost={toggleNewPost}
      onTitleChange={setNewPostTitle}
      onBodyChange={setNewPostBody}
      onSubmitNewPost={submitNewPost}
      onPageChange={setPage}
      onRetry={retry}
    />
  );
}
