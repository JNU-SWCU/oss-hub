'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ApiError } from '@/lib/api-client';

import { fetchAdminUsers, updateAdminUserRole } from '../api';
import {
  requiresRoleChangeConfirmation,
  roleChangeDestination,
} from '../role-change-policy';
import type { AdminUser, UserRole } from '../types';
import {
  AdminUsersView,
  type RoleChangeConfirmation,
} from './admin-users-view';

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.problem.detail
    : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

export function AdminUsersScreen() {
  const router = useRouter();
  const [items, setItems] = useState<readonly AdminUser[]>([]);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<RoleChangeConfirmation | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setItems(await fetchAdminUsers({ query, role }));
      return true;
    } catch (loadError) {
      setError(errorMessage(loadError));
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [query, role]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!success) return;
    const timeout = window.setTimeout(() => setSuccess(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [success]);

  const changeRole = async (user: AdminUser, nextRole: UserRole) => {
    setError(null);
    setSuccess(null);
    setProcessingId(user.id);
    try {
      const updated = await updateAdminUserRole(user.id, nextRole);
      const destination = roleChangeDestination(updated, nextRole);
      let refreshed = true;
      if (destination) {
        router.replace(destination);
      } else {
        refreshed = await load();
      }
      if (refreshed) {
        setSuccess(`${user.githubLogin}님의 역할을 변경했습니다.`);
      }
      setConfirmation(null);
    } catch (changeError) {
      setError(errorMessage(changeError));
    } finally {
      setProcessingId(null);
    }
  };

  const requestRoleChange = (user: AdminUser, nextRole: UserRole) => {
    if (user.role === nextRole) return;
    if (requiresRoleChangeConfirmation(user, nextRole)) {
      setConfirmation({ user, role: nextRole });
      return;
    }
    void changeRole(user, nextRole);
  };

  const resetFilters = () => {
    setQueryInput('');
    setQuery('');
    setRole('');
  };

  return (
    <AdminUsersView
      items={items}
      query={queryInput}
      role={role}
      isLoading={isLoading}
      errorMessage={error}
      successMessage={success}
      processingId={processingId}
      confirmation={confirmation}
      onQueryChange={setQueryInput}
      onRoleChange={setRole}
      onSearch={() => setQuery(queryInput.trim())}
      onRequestRoleChange={requestRoleChange}
      onCancelConfirmation={() => setConfirmation(null)}
      onConfirmRoleChange={() => {
        if (confirmation) {
          void changeRole(confirmation.user, confirmation.role);
        }
      }}
      onRetry={() => void load()}
      onResetFilters={resetFilters}
    />
  );
}
