import { cn } from '@/lib/utils';

interface FooterLink {
  label: string;
  href: string;
}

const POLICY_LINKS: FooterLink[] = [
  { label: '개인정보 수집·이용', href: '/policies/privacy/2026-08-11.html' },
];

export function LandingFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div
        className={cn(
          'mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-8 py-4',
          'text-xs text-muted-foreground sm:flex-row sm:items-center',
        )}
      >
        <span>
          © 2026 전남대학교 SW중심대학사업단 ·{' '}
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
            <a
              key={href}
              href={href}
              className="inline-flex min-h-control items-center hover:text-primary"
            >
              {label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
