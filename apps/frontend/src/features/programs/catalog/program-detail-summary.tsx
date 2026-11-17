import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { useClampedText } from '@/lib/use-clamped-text';
import { cn } from '@/lib/utils';
import { formatProgramEndAt } from '../authoring/program-end-at';
import { formatSeoulDateRange } from './program-detail-format';
import type { ProgramOverview } from './program-overview-dto';
import type { ProgramDetail } from './dto';

interface ProgramFact {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
}

function participationFacts(overview: ProgramOverview): ProgramFact[] {
  const facts: ProgramFact[] = [
    {
      key: 'participants',
      label: '참여 학생',
      value: `${overview.participantCount}명`,
    },
    { key: 'teams', label: '참여 팀', value: String(overview.teamCount) },
    {
      key: 'repositories',
      label: '연결 저장소',
      value: `${overview.connectedRepositoryCount}개`,
    },
  ];
  const documentsTotal = overview.viewerDocumentsTotal ?? 0;
  if (overview.viewerRole === 'STUDENT' && documentsTotal > 0) {
    facts.push({
      key: 'my-submission',
      label: '내 제출',
      value: `${overview.viewerDocumentsCompleted ?? 0} / ${documentsTotal} 서류`,
    });
  }
  if (overview.viewerRole === 'STAFF' && overview.participantCount > 0) {
    const completed = overview.fullySubmittedParticipantCount ?? 0;
    facts.push({
      key: 'submission-rate',
      label: '이번 마일스톤 완주율',
      value: `${Math.round((completed / overview.participantCount) * 100)}%`,
      detail: `(${completed}/${overview.participantCount})`,
    });
  }
  return facts;
}

function programFacts(
  program: ProgramDetail,
  overview: ProgramOverview | null,
): readonly ProgramFact[] {
  const facts: ProgramFact[] = [
    {
      key: 'application-period',
      label: '신청 기간',
      value: formatSeoulDateRange(
        program.applicationPeriod.startsAt,
        program.applicationPeriod.endsAt,
      ),
    },
  ];
  if (program.operatingPeriod) {
    facts.push({
      key: 'operating-period',
      label: '운영 기간',
      value: formatSeoulDateRange(
        program.operatingPeriod.startsAt,
        program.operatingPeriod.endsAt,
        formatProgramEndAt,
      ),
    });
  }
  return overview === null
    ? facts
    : [...facts, ...participationFacts(overview)];
}

function ProgramGuide({ description }: { readonly description: string }) {
  const contentId = useId();
  const { ref, expanded, overflowing, toggle } =
    useClampedText<HTMLParagraphElement>(description);

  return (
    <div
      data-slot="program-guide"
      className="grid min-w-0 content-start justify-items-start gap-2"
    >
      <CardTitle>프로그램 안내</CardTitle>
      <p
        id={contentId}
        ref={ref}
        className={cn(
          'text-sm leading-6 break-keep whitespace-pre-wrap',
          !expanded && 'line-clamp-5',
        )}
      >
        {description}
      </p>
      {overflowing || expanded ? (
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto px-0 text-foreground underline underline-offset-2"
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={
            expanded ? '프로그램 안내 접기' : '프로그램 안내 전체 보기'
          }
          onClick={toggle}
        >
          {expanded ? '접기' : '전체 보기'}
        </Button>
      ) : null}
    </div>
  );
}

export function ProgramSummary({
  program,
  overview,
}: {
  readonly program: ProgramDetail;
  readonly overview: ProgramOverview | null;
}) {
  const guided = program.description !== '';
  return (
    <section data-slot="program-summary" aria-label="프로그램 요약">
      <Card className="@container">
        <CardContent
          className={cn(
            'grid gap-6',
            guided && '@2xl:grid-cols-[minmax(0,1fr)_16.5rem]',
          )}
        >
          {guided ? (
            <ProgramGuide key={program.id} description={program.description} />
          ) : null}
          <dl
            className={cn(
              'grid content-start gap-3',
              guided
                ? '@2xl:border-l @2xl:border-border @2xl:pl-6'
                : '@2xl:grid-cols-2 @2xl:gap-x-12',
            )}
          >
            {programFacts(program, overview).map((fact) => (
              <div
                key={fact.key}
                className="flex items-baseline justify-between gap-4"
              >
                <dt className="text-small text-muted-foreground">
                  {fact.label}
                </dt>
                <dd className="text-right text-sm font-bold tabular-nums">
                  {fact.value}
                  {fact.detail === undefined ? null : (
                    <span className="font-normal text-muted-foreground">
                      {` ${fact.detail}`}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}
