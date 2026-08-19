'use client';

import { Suspense } from 'react';
import { RankingScreen } from '@/features/ranking';
import { useSessionRole } from '../_shell/use-session-role';

/**
 * 공개 랭킹 — 게이트를 붙이지 않는다(비로그인도 본다).
 *
 * 역할을 여기서 읽어 화면에 넘기는 이유는 두 가지다. (1) 의존 방향이 app →
 * features 단방향이라 feature 가 `_shell` 훅을 부를 수 없다. (2) 이 화면은 공통
 * 셸(`AppFrame`) 아래에 있어 `useSessionRole()` 이 셸이 이미 읽은 스냅샷을 그대로
 * 물려받는다 — 조회가 한 번 더 나가지 않는다.
 *
 * 역할은 **열 구성**에만 쓴다. 실명은 서버가 교직원·관리자 응답에만 실어 보내므로
 * 화면이 값을 가리는 일은 없다 — 안 온 값을 지울 수는 없다.
 */
export default function RankingPage() {
  const { status, role } = useSessionRole();
  const viewerRole = status === 'assigned' ? role : null;

  return (
    <Suspense fallback={null}>
      <RankingScreen viewerRole={viewerRole} />
    </Suspense>
  );
}
