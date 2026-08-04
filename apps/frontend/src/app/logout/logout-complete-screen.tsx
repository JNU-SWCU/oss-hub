'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  GITHUB_LOGOUT_URL,
  resolveLogoutReturnTo,
} from '@/features/auth/logout-notice';

/**
 * 로그아웃 완료 화면의 본문. 세션을 읽지 않는 순수 표현이라 그대로 렌더해 검증한다.
 *
 * ## 이 화면이 따로 있는 이유
 *
 * 예전에는 랜딩 주소에 `?loggedOut=1`을 붙여 안내를 얹었다. 그 표식은 새로고침·
 * 뒤로가기·주소 정리 한 번에 사라지고, 사라지면 사용자는 계정을 바꾸려면 무엇이 더
 * 필요한지 들을 자리를 잃는다. 로그아웃은 그 자체로 하나의 결과이므로 자기 주소를
 * 갖는다 — 그래야 새로고침해도, 나중에 다시 열어도 같은 안내가 그대로 있다.
 *
 * ## 왜 "GitHub 로그아웃"이 새 탭인가
 *
 * GitHub OAuth에는 계정 선택 화면을 강제하는 파라미터가 없다. `prompt` 류를 붙여도
 * GitHub은 무시한다. 그래서 계정을 바꾸는 유일한 길은 GitHub에서도 로그아웃하고
 * 오는 것이고, 이 화면은 그 바깥 구간을 거쳐 **돌아올 길**을 마련해 두어야 한다.
 *
 * 예전 안내는 같은 탭에서 `github.com/logout`으로 나가 버렸다. GitHub은 로그아웃
 * 뒤 자기 홈으로 갈 뿐 우리에게 돌려보내 주지 않으므로(외부 주소로 되돌려 보내는
 * 공개 수단이 없다) 사용자는 GitHub에 남겨졌고, 돌아오려면 주소를 기억해야 했다.
 *
 * 그래서 바깥 구간만 새 탭으로 떼어 내고 이 탭을 복귀 지점으로 남긴다. 돌아올 길이
 * 남의 서비스 동작에 기대지 않고 브라우저 안에 확보된다 — GitHub이 로그아웃 뒤
 * 어디로 보내든 이 화면은 그대로 있다.
 */
export function LogoutCompleteView({
  returnTo,
}: {
  /** 왕복이 끝난 뒤 우리 서비스에서 다시 시작할 주소. 반드시 검증된 내부 경로. */
  readonly returnTo: string;
}) {
  return (
    <section
      aria-labelledby="logout-complete-heading"
      className="mx-auto flex min-h-[60svh] w-full max-w-2xl flex-col justify-center gap-6 px-6 py-16 break-keep"
    >
      <div className="space-y-2">
        <h1
          id="logout-complete-heading"
          className="font-heading text-3xl font-bold tracking-tight"
        >
          로그아웃되었습니다
        </h1>
        {/*
          `role="status"`로 알린다 — 로그아웃은 사용자가 방금 요청한 일의 결과이고,
          화면을 보지 않는 사람에게도 그 결과가 전달되어야 한다.
        */}
        <p role="status" className="text-sm text-muted-foreground">
          이 서비스에서는 로그아웃됐습니다. 다만{' '}
          <strong>GitHub에는 아직 로그인된 상태</strong>라, 지금 바로 다시
          로그인하면 계정을 고르는 화면 없이 같은 계정으로 들어옵니다.
        </p>
      </div>

      <ol className="flex flex-col gap-6">
        <li className="flex flex-col items-start gap-2">
          <p className="text-sm font-semibold">1. GitHub에서 로그아웃합니다</p>
          <Button asChild size="lg">
            <a
              href={GITHUB_LOGOUT_URL}
              rel="noreferrer noopener"
              target="_blank"
            >
              GitHub에서 로그아웃
              <ExternalLink aria-hidden="true" />
              <span className="sr-only">(새 탭에서 열립니다)</span>
            </a>
          </Button>
          <p className="text-sm text-muted-foreground">
            새 탭에서 열리므로 이 화면은 그대로 남아 있습니다. GitHub 쪽을
            마치면 이 탭으로 돌아와 아래 2번을 누르세요.
          </p>
        </li>

        <li className="flex flex-col items-start gap-2">
          <p className="text-sm font-semibold">2. 다른 계정으로 들어옵니다</p>
          <Button asChild size="lg" variant="outline">
            <Link href={returnTo}>
              다른 계정으로 로그인
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <p className="text-sm text-muted-foreground">
            GitHub 로그아웃을 건너뛰고 눌러도 됩니다. 그때는 직전과 같은
            계정으로 들어옵니다.
          </p>
        </li>
      </ol>

      <p className="text-sm text-muted-foreground">
        계정을 바꿀 생각이 아니라면{' '}
        <Link href="/" className="underline underline-offset-2">
          홈으로 돌아가기
        </Link>
        .
      </p>
    </section>
  );
}

/**
 * 복귀 주소를 주소창에서 읽어 본문에 넘긴다.
 *
 * 첫 렌더에서 빈 문자열로 시작하는 것은 서버 렌더와 클라이언트의 첫 마크업을 맞추기
 * 위해서다(랜딩 `app/page.tsx`가 쓰는 방식과 같다). 빈 입력의 결과는 기본 복귀
 * 주소이므로, 값을 읽기 전에도 2번 버튼은 유효한 목적지를 가리킨다.
 */
export function LogoutCompleteScreen() {
  const [serializedSearchParams, setSerializedSearchParams] = useState('');

  useEffect(() => {
    setSerializedSearchParams(window.location.search);
  }, []);

  return (
    <LogoutCompleteView
      returnTo={resolveLogoutReturnTo(serializedSearchParams)}
    />
  );
}
