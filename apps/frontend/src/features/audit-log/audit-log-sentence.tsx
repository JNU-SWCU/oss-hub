import type { AuditLogSentenceSegment } from './describe';

// describe.ts는 문장을 데이터(조각 목록)로만 표현한다. 조각을 실제 강조 스타일로
// 바꾸는 책임은 여기 — actor/target은 굵게, target 중 GitHub 로그인 형태만 '@'을
// 접두해 사람 이름처럼 읽히게 하고, 폴백(`targetType / targetId`)이나 미등록 action
// 원본 문자열은 코드체로 남겨 "사람이 읽을 수 없는 값"이라는 신호를 유지한다.
export function AuditLogSentence({
  segments,
}: {
  readonly segments: readonly AuditLogSentenceSegment[];
}) {
  return (
    <>
      {segments.map((segment, index) => {
        const key = `${segment.kind}-${index}`;
        if (segment.kind === 'text') {
          return <span key={key}>{segment.value}</span>;
        }
        if (segment.kind === 'actor') {
          return (
            <span key={key} className="font-medium">
              {segment.value}
            </span>
          );
        }
        if (segment.kind === 'target') {
          return segment.isHandle ? (
            <span key={key} className="font-medium">
              @{segment.value}
            </span>
          ) : (
            <code
              key={key}
              className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]"
            >
              {segment.value}
            </code>
          );
        }
        return (
          <code
            key={key}
            className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]"
          >
            {segment.value}
          </code>
        );
      })}
    </>
  );
}
