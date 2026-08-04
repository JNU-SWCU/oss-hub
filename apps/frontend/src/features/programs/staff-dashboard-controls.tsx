import type { FormEvent, ReactElement } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { parseStaffDashboardStatus } from './staff-dashboard-filters';
import type { ProgramListStatus } from './types';

interface StaffDashboardControlsProps {
  readonly search: string;
  readonly status: ProgramListStatus;
  readonly onSearchChange: (value: string) => void;
  readonly onStatusChange: (value: ProgramListStatus) => void;
  readonly onSubmit: () => void;
}

export function StaffDashboardControls({
  search,
  status,
  onSearchChange,
  onStatusChange,
  onSubmit,
}: StaffDashboardControlsProps): ReactElement {
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
      onSubmit={submit}
    >
      <label className="grid min-w-48 flex-1 gap-1 text-sm">
        <span className="text-muted-foreground">검색</span>
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="프로그램 이름, 유형"
          aria-label="프로그램 검색"
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="text-muted-foreground">모집 상태</span>
        <Select
          value={status}
          onChange={(event) =>
            onStatusChange(parseStaffDashboardStatus(event.target.value))
          }
          aria-label="모집 상태 필터"
        >
          <option value="all">전체</option>
          <option value="recruiting">모집중</option>
          <option value="in_progress">진행중</option>
          <option value="upcoming">접수대기</option>
          <option value="ended">종료</option>
        </Select>
      </label>
    </form>
  );
}
