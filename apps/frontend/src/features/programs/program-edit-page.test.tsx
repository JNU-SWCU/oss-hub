import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type { EditableProgram } from './api';
import {
  buildProgramEditInput,
  mapMilestoneDeleteError,
  mapMilestoneError,
  mapProgramEditError,
  toProgramEditForm,
} from './program-edit-flow';
import { PROGRAM_END_AT_UNDECIDED } from './program-end-at';

const editableProgram: EditableProgram = {
  id: 'program-1',
  name: 'OSS',
  organizer: 'Center',
  category: 'OSS_CONTEST',
  lifecycle: 'PUBLISHED',
  applicationTemplateKey: 'oss-contest',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  categoryLocked: {
    locked: false,
    byApplications: false,
    byTeams: false,
    applicationCount: 0,
    teamCount: 0,
  },
  applicationStartAt: '2026-08-01T09:30:59.000Z',
  applicationEndAt: '2026-08-15T09:30:59.000Z',
  endAt: '2026-08-31T09:30:59.000Z',
  repositoryProvisioningEnabled: false,
  notifyOnDeadline: false,
  description: 'overview',
  teamMinSize: 2,
  teamMaxSize: 4,
  milestones: [],
};

describe('ProgramEditPage save payload', () => {
  it('preserves unchanged ISO timestamps with non-zero seconds when STAFF saves by canonical id', () => {
    // Given
    const form = toProgramEditForm(editableProgram);

    // When
    const input = buildProgramEditInput(form, true, []);

    // Then
    expect(input).toMatchObject({
      category: 'OSS_CONTEST',
      applicationStartAt: editableProgram.applicationStartAt,
      applicationEndAt: editableProgram.applicationEndAt,
      endAt: editableProgram.endAt,
      teamMinSize: 2,
      teamMaxSize: 4,
      notifyOnDeadline: false,
    });
  });

  it('submits a new ISO timestamp when STAFF edits the minute-precision datetime field', () => {
    // Given
    const form = {
      ...toProgramEditForm(editableProgram),
      applicationStartAt: '2026-08-01T19:45',
    };

    // When
    const input = buildProgramEditInput(form, true, ['applicationStartAt']);

    // Then
    expect(input.applicationStartAt).toBe(
      new Date(2026, 7, 1, 19, 45).toISOString(),
    );
    expect(input.applicationEndAt).toBe(editableProgram.applicationEndAt);
  });
  // 종료일 없음을 뜻하는 표현이 하나로 모였다 — `null` 과 센티널은 같은 뜻이고
  // 폼은 그것을 「미정」 체크박스로 나르며, 저장은 언제나 센티널로 되돌린다.
  // 예전에는 이 자리에서 payload 가 `null` 로 나갔는데, 그 값을 받은 서버는
  // `new Date(null)` 로 Invalid Date 를 만든다(program-editor.service.ts).
  it('종료일 없는 프로그램은 센티널로 왕복하고, 날짜를 고르면 ISO 로 나간다', () => {
    expect(
      buildProgramEditInput(
        toProgramEditForm({ ...editableProgram, endAt: null }),
        true,
        [],
      ).endAt,
    ).toBe(PROGRAM_END_AT_UNDECIDED);

    const input = buildProgramEditInput(
      {
        ...toProgramEditForm(editableProgram),
        endAt: '2026-09-01T19:45',
      },
      true,
      ['endAt'],
    );

    expect(input.endAt).toBe(new Date(2026, 8, 1, 19, 45).toISOString());
  });
});

// #355 — 마일스톤 실패 안내는 "입력이 남아 있는지"와 "다음에 무엇을 할지"를 말해야 한다.
describe('마일스톤 실패 안내', () => {
  function apiError(code: string, status: number): ApiError {
    return new ApiError({
      type: 'about:blank',
      title: 'Error',
      status,
      detail: '',
      code,
      instance: '/programs/program-1/milestones',
    });
  }

  it('저장 실패는 편집기에 남은 입력을 단언하고 다시 저장하라고 말한다', () => {
    expect(mapMilestoneError(new TypeError('network')).general).toBe(
      '마일스톤을 저장하지 못했습니다. 입력한 내용은 그대로 남아 있으니 잠시 후 다시 저장해 주세요.',
    );
  });

  it('삭제 실패는 입력 보존을 단언하지 않고 목록 새로고침을 권한다', () => {
    const message = mapMilestoneDeleteError(new TypeError('network'));
    expect(message).toBe(
      '마일스톤을 삭제하지 못했습니다. 목록을 새로고침해 현재 상태를 확인한 뒤 다시 시도해 주세요.',
    );
    expect(message).not.toContain('입력한 내용은 그대로 남아');
  });

  it('제출물 충돌은 기존 안내를 유지한다', () => {
    expect(mapMilestoneDeleteError(apiError('PRG_009', 409))).toBe(
      '제출물이 있는 마일스톤은 삭제할 수 없습니다.',
    );
  });

  // PRG_010 의 실제 서버 규칙은 저장소 자동 생성 설정이며 팀 여부와 무관하다.
  // 화면이 "팀 프로그램" 을 원인으로 지목하면 교직원이 엉뚱한 곳을 고치게 된다.
  it('PRG_010 은 팀이 아니라 저장소 자동 생성 설정을 원인으로 지목한다', () => {
    const onSave = mapMilestoneError(apiError('PRG_010', 422)).general ?? '';
    expect(onSave).toBe(
      '저장소 자동 생성을 켜려면 마일스톤이 1개 이상 있어야 합니다. 마일스톤을 추가한 뒤 다시 저장해 주세요.',
    );
    expect(onSave).not.toContain('팀 프로그램');

    const onProgramSave =
      mapProgramEditError(apiError('PRG_010', 422)).general ?? '';
    expect(onProgramSave).toBe(onSave);

    const onDelete = mapMilestoneDeleteError(apiError('PRG_010', 422));
    expect(onDelete).toBe(
      '저장소 자동 생성이 켜져 있어 마지막 마일스톤은 삭제할 수 없습니다. 다른 마일스톤을 먼저 추가하거나 저장소 자동 생성을 꺼 주세요.',
    );
    expect(onDelete).not.toContain('팀 프로그램');
  });
});
