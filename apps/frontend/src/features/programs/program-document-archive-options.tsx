import { Select } from '@/components/ui/select';
import type {
  ProgramDetail,
  ProgramMilestone,
  StaffProgramTeam,
} from './types';
import type {
  ProgramDocumentArchiveGrouping,
  ProgramDocumentArchiveScope,
} from './program-document-archive-api';

export function ProgramDocumentArchiveOptions({
  program,
  teams,
  kind,
  grouping,
  selectedMilestone,
  selectedTeam,
  busy,
  onKindChange,
  onMilestoneChange,
  onTeamChange,
  onGroupingChange,
}: {
  readonly program: ProgramDetail;
  readonly teams: readonly StaffProgramTeam[];
  readonly kind: ProgramDocumentArchiveScope['kind'];
  readonly grouping: ProgramDocumentArchiveGrouping;
  readonly selectedMilestone: ProgramMilestone | undefined;
  readonly selectedTeam: StaffProgramTeam | undefined;
  readonly busy: boolean;
  readonly onKindChange: (value: ProgramDocumentArchiveScope['kind']) => void;
  readonly onMilestoneChange: (value: string) => void;
  readonly onTeamChange: (value: string) => void;
  readonly onGroupingChange: (value: ProgramDocumentArchiveGrouping) => void;
}) {
  return (
    <>
      <fieldset className="flex flex-wrap gap-4" disabled={busy}>
        <legend className="sr-only">다운로드 범위</legend>
        {(
          [
            ['PROGRAM', '프로그램 전체'],
            ['MILESTONE', '마일스톤 하나'],
            ['TEAM', '팀 하나'],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className="flex min-h-11 items-center gap-2 text-small"
          >
            <input
              type="radio"
              name="archive-scope"
              value={value}
              checked={kind === value}
              onChange={() => {
                onKindChange(value);
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {kind === 'MILESTONE' ? (
          <label className="grid min-w-0 gap-2 text-small">
            마일스톤
            <Select
              value={selectedMilestone?.id ?? ''}
              disabled={busy}
              onChange={(event) => onMilestoneChange(event.target.value)}
            >
              {selectedMilestone === undefined &&
              program.milestones.length > 0 ? (
                <option value="">마일스톤을 선택해 주세요</option>
              ) : null}
              {program.milestones.length === 0 ? (
                <option value="">마일스톤 없음</option>
              ) : (
                program.milestones.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))
              )}
            </Select>
          </label>
        ) : null}
        {kind === 'TEAM' ? (
          <label className="grid min-w-0 gap-2 text-small">
            팀
            <Select
              value={selectedTeam?.teamId ?? ''}
              disabled={busy}
              onChange={(event) => onTeamChange(event.target.value)}
            >
              {selectedTeam === undefined && teams.length > 0 ? (
                <option value="">팀을 선택해 주세요</option>
              ) : null}
              {teams.length === 0 ? (
                <option value="">팀 없음</option>
              ) : (
                teams.map((item) => (
                  <option key={item.teamId} value={item.teamId}>
                    {item.name}
                  </option>
                ))
              )}
            </Select>
          </label>
        ) : null}
        <label className="grid min-w-0 gap-2 text-small">
          ZIP 폴더 묶기
          <Select
            value={grouping}
            disabled={busy}
            onChange={(event) =>
              onGroupingChange(
                event.target.value === 'DOCUMENT' ? 'DOCUMENT' : 'TEAM',
              )
            }
          >
            <option value="TEAM">팀별로 묶기</option>
            <option value="DOCUMENT">서류별로 묶기</option>
          </Select>
        </label>
      </div>
      <div
        className="grid gap-2 rounded-control bg-muted p-4 text-small"
        data-testid="program-document-archive-summary"
      >
        <strong className="break-words">
          {program.name} ·{' '}
          {kind === 'PROGRAM'
            ? '프로그램 전체'
            : kind === 'MILESTONE'
              ? (selectedMilestone?.name ??
                (program.milestones.length === 0
                  ? '선택 가능한 마일스톤 없음'
                  : '마일스톤을 선택해 주세요'))
              : (selectedTeam?.name ??
                (teams.length === 0
                  ? '선택 가능한 팀 없음'
                  : '팀을 선택해 주세요'))}
        </strong>
        <p className="break-keep">
          각 항목의 현재 제출 글과 파일을 내려받습니다. 이전 제출 이력은
          포함하지 않습니다.
        </p>
        <p>
          {grouping === 'TEAM' ? '팀별 폴더' : '서류별 폴더'}로 묶습니다.
          {kind === 'TEAM'
            ? ' 선택한 팀의 모든 마일스톤을 포함합니다.'
            : ' 선택한 범위의 모든 승인 팀을 포함합니다.'}
        </p>
      </div>
    </>
  );
}
