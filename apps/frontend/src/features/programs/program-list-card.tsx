import { ProgramCard, StatusBadge } from '@/components';
import { buttonVariants } from '@/components/ui/button';
import { getProgramRecruitmentState } from './program-list';
import { programHref } from './program-paths';
import type { ProgramCategory } from './program-templates';
import type { ProgramListItem } from './types';

const CATEGORY_LABELS = {
  BASIC: '기본',
  SW_VALUE_SPREAD: 'SW 가치확산',
  OSS_CONTEST: 'OSS 경진대회',
  CAPSTONE: '캡스톤',
  SW_CONVERGENCE: 'SW 융합',
  GLOBAL_MAKERTHON: '글로벌 메이커톤',
  CORPORATE_INTERNSHIP: '기업 인턴십',
} satisfies Readonly<Record<ProgramCategory, string>>;

const RECRUITMENT_BADGES = {
  scheduled: { label: '모집 예정', variant: 'pending' },
  recruiting: { label: '모집중', variant: 'recruiting' },
  closed: { label: '마감', variant: 'closed' },
} as const;

function formatApplicationPeriod(program: ProgramListItem): string {
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  });
  return (
    formatter.format(new Date(program.applicationStartAt)) +
    ' ~ ' +
    formatter.format(new Date(program.applicationEndAt))
  );
}

function ProgramListCard({
  now,
  program,
}: {
  readonly now: Date;
  readonly program: ProgramListItem;
}) {
  const badge = RECRUITMENT_BADGES[getProgramRecruitmentState(program, now)];
  return (
    <ProgramCard
      category={CATEGORY_LABELS[program.category]}
      footer={
        <span className={buttonVariants({ variant: 'outline' })}>
          자세히 보기
        </span>
      }
      href={programHref(program.id)}
      period={formatApplicationPeriod(program)}
      statusPlacement="body-center"
      status={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge size="lg" variant={badge.variant}>
            {badge.label}
          </StatusBadge>
          {program.applicationStatus != null ? (
            <StatusBadge size="lg" variant="approved">
              신청 완료
            </StatusBadge>
          ) : null}
        </div>
      }
      title={program.name}
    >
      <span>{program.organizer}</span>
    </ProgramCard>
  );
}

export { ProgramListCard };
