import Link from 'next/link';

// 정책 링크 중 실제 라우트가 있는 것만 노출한다.
// "GitHub 활동 수집"과 "Org 저장소 운영 약관"은 원본 디자인에는 있으나
// 이 repo에 대응 라우트가 없어 죽은 앵커(href="#")를 만들지 않도록 생략했다.
// 후속 Issue로 라우트 추가 후 다시 채운다.
interface FooterLink {
  label: string;
  href: string;
}

const POLICY_LINKS: FooterLink[] = [
  { label: '개인정보 수집·이용', href: '/consent' },
];

export function LandingFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-8 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center">
        <span>
          © 2026 전남대학교 SW중심대학사업단 ·{' '}
          {/* 푸터 링크도 손가락으로 누르는 조작 요소다. 글자 크기(12px)만 따라
              높이가 16~20px에 머물면 눌러야 할 자리를 빗맞힌다. 글자 크기는 그대로
              두고 세로 여백만 얹어 조작 높이(44px) 기준을 맞춘다. */}
          <a
            href="https://github.com/JNU-SWCU"
            target="_blank"
            rel="noreferrer noopener"
            className="ml-1 inline-flex min-h-control items-center hover:text-primary"
          >
            github.com/JNU-SWCU
          </a>
        </span>

        <div className="flex items-center gap-3">
          {POLICY_LINKS.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              className="inline-flex min-h-control items-center hover:text-primary"
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
