'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { PageBody, PageHeader } from '@/components';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { githubLoginPath } from '@/features/landing/api';
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
    <PageBody className="max-w-4xl">
      <PageHeader
        title="회원가입 / 로그인"
        description="OSS Hub는 GitHub 계정으로만 들어옵니다. 그래서 처음 오신 분의 가입과 다시 오신 분의 로그인이 같은 동작이고, 아래 버튼 하나가 둘 다 처리합니다."
      />

      <div className="flex flex-col gap-8 break-keep">
        <Card>
          <CardHeader>
            <CardTitle>GitHub 계정으로 계속합니다</CardTitle>
            <CardDescription>
              GitHub 인증 화면으로 이동했다가 다시 이곳으로 돌아옵니다. 돌아오면
              다음 화면에서 약관에 동의하고 가입을 마칩니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <p className="text-body">
              이 서비스를 쓰신 적이 있다면{' '}
              <strong>쓰시던 계정으로 그대로</strong> 들어옵니다. 같은 GitHub
              계정으로 계정이 하나 더 만들어지지 않습니다.
            </p>
            <Button asChild className="self-start" size="lg">
              <a href={githubLoginPath}>
                GitHub으로 계속하기
                <ArrowRight aria-hidden="true" />
              </a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>GitHub 계정이 없으신가요?</CardTitle>
            <CardDescription>
              계정을 먼저 만들어야 이 서비스에 들어올 수 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <p className="text-body">
              GitHub에서 계정을 만드는 것은 무료입니다. 계정을 만든 뒤 이
              화면으로 돌아와 위의 “GitHub으로 계속하기”를 눌러 주세요. 아래
              링크는 새 탭에서 열리므로 이 화면은 그대로 남아 있습니다.
            </p>
            <Button asChild className="self-start" size="lg" variant="outline">
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
          </CardContent>
        </Card>
      </div>
    </PageBody>
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
    <PageBody className="max-w-4xl">
      <PageHeader
        title="이미 로그인되어 있습니다"
        description="가입을 다시 할 필요가 없습니다. 멈춘 자리로 이동합니다."
      />
      <div>
        <Button asChild size="lg">
          <Link href={href}>
            {label}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </PageBody>
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
        <p
          className="flex min-h-[50svh] items-center justify-center px-6 py-16 text-sm text-muted-foreground"
          role="status"
        >
          확인 중…
        </p>
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
  const { status, role, isProfileComplete } = useSessionRole();
  const decision = signupEntryDecision(status, role, isProfileComplete);
  const resumeHref = decision.kind === 'resume' ? decision.href : null;

  useEffect(() => {
    if (resumeHref) {
      router.replace(resumeHref);
    }
  }, [resumeHref, router]);

  return <SignupEntryView decision={decision} />;
}
