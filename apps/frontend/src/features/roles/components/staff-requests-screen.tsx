'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api-client';

import { decideStaffRoleRequest, fetchStaffRoleRequests } from '../api';
import type {
  StaffRoleRequest,
  StaffRoleRequestDecision,
  StaffRoleRequestStatus,
} from '../types';
import { StaffRequestsView } from './staff-requests-view';

const LIMIT = 20;

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.problem.detail
    : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

export function StaffRequestsScreen() {
  const [items, setItems] = useState<readonly StaffRoleRequest[]>([]);
  const [status, setStatus] = useState<StaffRoleRequestStatus>('PENDING');
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [processingIds, setProcessingIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [rejectingRequest, setRejectingRequest] =
    useState<StaffRoleRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [revokingRequest, setRevokingRequest] =
    useState<StaffRoleRequest | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchStaffRoleRequests({
        status,
        query,
        page,
        limit: LIMIT,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [page, query, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (
    request: StaffRoleRequest,
    decision: StaffRoleRequestDecision,
  ) => {
    const previous = items;
    const optimisticStatus =
      decision.action === 'APPROVE'
        ? 'APPROVED'
        : decision.action === 'REJECT'
          ? 'REJECTED'
          : 'REVOKED';
    setError(null);
    setSuccess(null);
    setProcessingIds((current) => new Set(current).add(request.id));
    setItems((current) =>
      current.map((item) =>
        item.id === request.id
          ? {
              ...item,
              status: optimisticStatus,
              rejectionReason:
                decision.action === 'REJECT' ? decision.reason : null,
            }
          : item,
      ),
    );

    try {
      const updated = await decideStaffRoleRequest(request.id, decision);
      setItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSuccess(
        decision.action === 'APPROVE'
          ? `${request.githubLogin}님의 요청을 승인했습니다.`
          : decision.action === 'REJECT'
            ? `${request.githubLogin}님의 요청을 반려했습니다.`
            : `${request.githubLogin}님의 교직원 역할을 회수했습니다.`,
      );
      setRejectingRequest(null);
      setRevokingRequest(null);
      setRejectionReason('');
    } catch (decisionError) {
      setItems(previous);
      if (
        decisionError instanceof ApiError &&
        decisionError.problem.status === 409
      ) {
        await load();
        setError('다른 관리자가 먼저 처리했습니다. 최신 목록을 불러왔습니다.');
      } else {
        setError(errorMessage(decisionError));
      }
    } finally {
      setProcessingIds((current) => {
        const next = new Set(current);
        next.delete(request.id);
        return next;
      });
    }
  };

  const resetFilters = () => {
    setQueryInput('');
    setQuery('');
    setStatus('PENDING');
    setPage(1);
  };

  return (
    <StaffRequestsView
      items={items}
      status={status}
      query={queryInput}
      page={page}
      limit={LIMIT}
      total={total}
      isLoading={isLoading}
      errorMessage={error}
      successMessage={success}
      processingIds={processingIds}
      rejectingRequest={rejectingRequest}
      revokingRequest={revokingRequest}
      rejectionReason={rejectionReason}
      onStatusChange={(nextStatus) => {
        setStatus(nextStatus);
        setPage(1);
      }}
      onQueryChange={setQueryInput}
      onSearch={() => {
        setQuery(queryInput.trim());
        setPage(1);
      }}
      onPageChange={setPage}
      onApprove={(request) => void decide(request, { action: 'APPROVE' })}
      onOpenReject={(request) => {
        setRejectingRequest(request);
        setRejectionReason('');
      }}
      onCloseReject={() => {
        setRejectingRequest(null);
        setRejectionReason('');
      }}
      onRejectionReasonChange={setRejectionReason}
      onConfirmReject={() => {
        if (rejectingRequest && rejectionReason.trim()) {
          void decide(rejectingRequest, {
            action: 'REJECT',
            reason: rejectionReason.trim(),
          });
        }
      }}
      onOpenRevoke={setRevokingRequest}
      onCloseRevoke={() => setRevokingRequest(null)}
      onConfirmRevoke={() => {
        if (revokingRequest) {
          void decide(revokingRequest, { action: 'REVOKE' });
        }
      }}
      onRetry={() => void load()}
      onResetFilters={resetFilters}
    />
  );
}
