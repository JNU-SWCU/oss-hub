'use client';

import { useEffect, type MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  githubLoginPath,
  githubAccountChoicePath,
} from '@/features/auth/login-paths';
import {
  getLoginDestinationStorage,
  rememberLoginDestination,
} from '@/features/auth/login-destination';
import { GITHUB_LOGOUT_URL } from '@/features/auth/logout-notice';
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

export function SignupInviteView() {
  function rememberDestination(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    rememberLoginDestination(
      getLoginDestinationStorage(),
      new URLSearchParams(window.location.search).get('returnTo'),
    );
  }
  return (
    <SignupStage>
      <SignupEyebrow>로그인</SignupEyebrow>
      <SignupTitle>GitHub으로 시작하기</SignupTitle>
      <SignupLede>
        처음이라면 가입을, 이용 중이라면 로그인을 진행합니다.
      </SignupLede>
      <div className="flex flex-col items-start gap-5 break-keep">
        <Button asChild className={signupPrimaryClassName} size="lg">
          <a href={githubLoginPath} onClick={rememberDestination}>
            GitHub으로 계속하기
            <ArrowRight aria-hidden="true" />
          </a>
        </Button>
        <a
          className="inline-flex min-h-11 items-center text-sm text-cosmos-repository underline underline-offset-4"
          href={githubAccountChoicePath}
          onClick={rememberDestination}
        >
          다른 GitHub 계정으로 로그인
        </a>
        <p className="text-sm text-muted-foreground">
          GitHub 계정이 없나요?{' '}
          <Button
            asChild
            size="lg"
            variant="link"
            className="text-cosmos-repository underline"
          >
            <a
              href={GITHUB_SIGNUP_URL}
              rel="noreferrer noopener"
              target="_blank"
            >
              계정 만들기<span className="sr-only"> (새 탭)</span>
            </a>
          </Button>
        </p>
        <details
          id="account-help"
          className="max-w-prose text-sm text-muted-foreground"
        >
          <summary className="cursor-pointer py-2">
            원하는 계정이 보이지 않나요?
          </summary>
          <p className="pt-2">
            <a
              className="text-cosmos-repository underline underline-offset-4"
              href={GITHUB_LOGOUT_URL}
              rel="noreferrer noopener"
              target="_blank"
            >
              GitHub에서 로그아웃<span className="sr-only"> (새 탭)</span>
            </a>
            한 뒤 이 탭에서 다시{' '}
            <span className="whitespace-nowrap">로그인해 주세요.</span>
          </p>
        </details>
      </div>
    </SignupStage>
  );
}

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
      <SignupTitle>이어서 진행합니다</SignupTitle>
      <SignupLede>로그인한 계정으로 이어갑니다.</SignupLede>
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

export function SignupEntryScreen() {
  const router = useRouter();
  const {
    status,
    memberKind,
    hasStaffAccess,
    hasAdminAccess,
    isProfileComplete,
  } = useSessionRole();
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
