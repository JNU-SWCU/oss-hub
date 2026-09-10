'use client';

import { use, useMemo } from 'react';
import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { useSession } from '@/features/auth/use-session';
import { ProgramMyTeamPage } from '@/features/programs/program-my-team-page';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { SubmissionChecklistPage } from '@/features/submissions/submission-checklist-page';

/**
 * 이 라우트가 client component인 이유는 두 가지다.
 *
 * 1. 세션은 여기서만 읽는다. `features/programs`는 `features/submissions`도
 *    `features/auth`도 직접 import할 수 없다(feature 간 직접 의존 금지,
 *    `eslint.config.mjs`). 그래서 로그인 신원과 제출 현황 조각은 **조합 계층인
 *    이 파일이 만들어** 화면에 내려 준다 — 신청 화면이 `sessionUser`를 내려
 *    주는 것과 같은 방식이다(`apply/program-apply-route.tsx`).
 * 2. 새 SSR 조회를 만들지 않는다. 팀·프로그램·신청은 모두 세션 쿠키가 필요한
 *    브라우저 경계(`lib/api-client`)를 통해서만 읽는다.
 *
 * 접근 판정과 프로필 완료 가드는 `RolePanelShell`(→ `RoleGate`)이 이미 한다.
 * 자식은 「역할이 학생이고 프로필을 마친 세션」에서만 그려지지만, 그래도 화면은
 * 세션 사용자가 손에 잡히기 전에는 비공개 API를 부르지 않는다.
 */
function ProgramMyTeamWorkspace({ programId }: { readonly programId: string }) {
  const session = useSession();
  const user = session.status === 'authenticated' ? session.user : null;
  const sessionUser = useMemo(
    () => (user === null ? null : { nickname: user.nickname, name: user.name }),
    [user],
  );

  return (
    <ProgramMyTeamPage
      programId={programId}
      sessionUser={sessionUser}
      // 승인된 신청에서만 실제로 그려진다 — element를 만들어 두는 것만으로는
      // 아무 요청도 나가지 않고, 화면이 트리에 넣는 순간 제출 현황이 조회된다.
      submissionContent={
        <SubmissionChecklistPage programId={programId} milestoneId={null} />
      }
    />
  );
}

// #1269 「우리 팀」(URL: /programs/[id]/my-team) — 접근: STUDENT.
// 이 프로그램에서 내가 속한 팀 하나를 보는 학생 전용 작업 공간이다. 좌측 패널
// (`_shell/sidebar-menu.ts`)과 대시보드가 같은 경로(`programMyTeamHref`)로 들어온다.
export default function ProgramMyTeamRoutePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = use(params);
  return (
    <RolePanelShell allow={['student']}>
      <ProgramMyTeamWorkspace programId={decodeRouteProgramId(id)} />
    </RolePanelShell>
  );
}
