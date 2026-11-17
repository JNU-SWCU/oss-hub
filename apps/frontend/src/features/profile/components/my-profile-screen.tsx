'use client';

import { useEffect } from 'react';
import { classifyProfileApiError } from '../api';
import { useMyProfileQuery } from '../queries';
import { MyProfileView, type MyProfileState } from './my-profile-view';

export function MyProfileScreen() {
  const query = useMyProfileQuery();
  const isSignedOut =
    query.isError && classifyProfileApiError(query.error) === 'unauthorized';

  useEffect(() => {
    if (isSignedOut) window.location.assign('/');
  }, [isSignedOut]);

  const state: MyProfileState =
    query.isPending || isSignedOut || (query.isError && query.isFetching)
      ? { kind: 'loading' }
      : query.isError
        ? { kind: 'error' }
        : { kind: 'ready', profile: query.data };

  return <MyProfileView state={state} onRetry={() => void query.refetch()} />;
}
