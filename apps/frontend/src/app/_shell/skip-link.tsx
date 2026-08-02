export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only z-50 rounded-md bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-md focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:outline-2 focus:outline-offset-2 focus:outline-primary"
    >
      본문으로 건너뛰기
    </a>
  );
}
