'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { githubLoginPath } from '@/features/landing/api';
import {
  signupPrimaryClassName,
  SignupEyebrow,
  SignupLede,
  SignupTitle,
} from '@/components';
import { SignupStage } from '../_shell/signup-stage';
import { useSessionRole } from '../_shell/use-session-role';
import {
  GITHUB_SIGNUP_URL,
  signupEntryDecision,
  type SignupEntryDecision,
} from './signup-entry';

/**
 * 가입·로그인 안내 본문. 세션을 읽지 않는 순수 표현이라 그대로 렌더해 검증한다.
 *
 * 이 화면은 **여기가 아니면 아무도 말해 주지 않는 것만** 말한다. 수집 항목·목적·
 * 보유 기간·거부권은 바로 다음 화면(`/consent`)이 항목별로, 전문 링크까지 붙여
 * 다시 묻는다. 그걸 여기서 미리 늘어놓으면 같은 얘기를 두 번 하는 셈이고, 정작
 * 이 화면이 존재하는 이유인 "GitHub 계정이 없는 사람 안내"가 그 아래로 밀린다.
 *
 * 다만 "계정이 하나 더 생기지 않는다"는 한 줄은 남긴다. 로그인 수단이 GitHub
 * 하나뿐이라 이 화면이 가입과 로그인을 겸하는데, 그 사실을 말해 주는 자리가
 * 제품에 여기밖에 없다 — 동의 화면은 이미 들어온 사람에게 말하는 자리라 늦다.
 */
export function SignupInviteView() {
  return (
    <SignupStage>
      <SignupEyebrow>회원가입</SignupEyebrow>
      <SignupTitle>
        GitHub 계정으로
        <br />
        시작합니다
      </SignupTitle>
      <SignupLede>
        OSS Hub는 GitHub 계정으로만 들어옵니다. 그래서 처음 오신 분의 가입과
        다시 오신 분의 로그인이 같은 동작이고, 아래 버튼 하나가 둘 다
        처리합니다.
      </SignupLede>

      <div className="flex flex-col gap-5 break-keep">
        <p className="max-w-prose text-body text-muted-foreground">
          이 서비스를 쓰신 적이 있다면 <strong>쓰시던 계정으로 그대로</strong>{' '}
          들어옵니다. 같은 GitHub 계정으로 계정이 하나 더 만들어지지 않습니다.
        </p>
        <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
          <Button asChild className={signupPrimaryClassName} size="lg">
            <a href={githubLoginPath}>
              GitHub으로 계속하기
              <ArrowRight aria-hidden="true" />
            </a>
          </Button>
          {/* 계정이 없는 사람 안내는 카드를 하나 더 쌓지 않고 주 버튼 옆에 둔다.
              카드가 둘이면 무게가 비슷해져 "둘 중 무엇을 눌러야 하나"가 되는데,
              이 화면의 주 행동은 하나다.

              `variant="link"`의 `text-primary`(남색)는 이 우주 바탕에서 1.68:1이라
              읽히지 않는다 — 반전 스코프가 되돌리지 않는 토큰이라 여기서 랜딩의
              초록 강조색을 지정한다(8.56:1). 토큰 자체를 고치지 않는 이유는 바로
              옆 주 버튼(`signupPrimaryClassName`)이 흰 바탕 + `--primary` 글자라
              그쪽이 되레 무너지기 때문이다. 색만으로 링크임을 알리지 않도록
              밑줄을 항상 켠다. */}
          <Button
            asChild
            className="text-cosmos-repository underline"
            size="lg"
            variant="link"
          >
            <a
              href={GITHUB_SIGNUP_URL}
              rel="noreferrer noopener"
              target="_blank"
            >
              GitHub 계정 만들기
              <ExternalLink aria-hidden="true" />
              <span className="sr-only">(새 탭에서 열립니다)</span>
            </a>
          </Button>
        </div>
        <p className="max-w-prose text-small text-muted-foreground">
          GitHub 인증 화면으로 이동했다가 다시 이곳으로 돌아옵니다. 돌아오면
          약관 동의부터 이어집니다. 계정이 없다면 GitHub에서 무료로 만들 수
          있고, 위 링크는 새 탭에서 열리므로 이 화면은 그대로 남아 있습니다.
        </p>
      </div>
    </SignupStage>
  );
}

/**
 * 이동 중 화면. 자동 이동이 늦거나 막혀도 손으로 갈 수 있게 링크를 함께 둔다 —
 * 안내 문구만 남고 아무 일도 일어나지 않는 화면이 사용자에게 가장 나쁘다.
 */
function SignupResumeView({
  href,
  label,
}: {
  readonly href: string;
  readonly label: string;
}) {
  return (
    <SignupStage>
      <SignupEyebrow>이어서 하기</SignupEyebrow>
      <SignupTitle>멈춘 자리로 돌아갑니다</SignupTitle>
      <SignupLede>
        이미 로그인되어 있습니다. 가입을 처음부터 다시 할 필요는 없습니다.
      </SignupLede>
      <div>
        <Button asChild size="lg">
          <Link href={href}>
            {label}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </SignupStage>
  );
}

export function SignupEntryView({
  decision,
}: {
  readonly decision: SignupEntryDecision;
}) {
  switch (decision.kind) {
    case 'invite':
      return <SignupInviteView />;
    case 'checking':
      return (
        <SignupStage>
          <p className="text-body text-cosmos-muted" role="status">
            확인 중…
          </p>
        </SignupStage>
      );
    case 'resume':
      return <SignupResumeView href={decision.href} label={decision.label} />;
    default: {
      const exhaustive: never = decision;
      return exhaustive;
    }
  }
}

/**
 * `/signup` 화면.
 *
 * 사용자가 스스로 들어온 경로에서만 이동시킨다 — 랜딩은 누구에게나 열려 있어야
 * 하므로 거기서는 절대 되돌리지 않고(#144 → #147의 뒤로가기 함정), 재개는 이
 * 화면 안에서만 일어난다. `replace`를 쓰는 것도 같은 이유다: `push`면 뒤로가기가
 * 이 화면으로 돌아와 다시 앞으로 튕겨 나가는 고리가 생긴다.
 */
export function SignupEntryScreen() {
  const router = useRouter();
  const { status, memberKind, hasStaffAccess, hasAdminAccess, isProfileComplete } =
    useSessionRole();
  const decision = signupEntryDecision(
    status,
    { memberKind, hasStaffAccess, hasAdminAccess },
    isProfileComplete,
  );
  const resumeHref = decision.kind === 'resume' ? decision.href : null;

  useEffect(() => {
    if (resumeHref) {
      router.replace(resumeHref);
    }
  }, [resumeHref, router]);

  return <SignupEntryView decision={decision} />;
}
