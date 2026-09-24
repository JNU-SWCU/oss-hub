import { describe, expect, it } from 'vitest';

import { visibleAuthoringIssueCount } from './program-authoring-validation-helpers';
import type { ProgramAuthoringIssue } from './program-authoring-validation-helpers';
import { visibleProgramEditErrorCount } from './program-edit-flow';

const issue = (
  path: string,
  step: ProgramAuthoringIssue['step'],
): ProgramAuthoringIssue => ({ path, step, message: `${path} 오류` });

describe('visibleAuthoringIssueCount — 화면에 보이는 오류 줄만 센다', () => {
  it('지금 단계의 오류만 센다(최종 검토에서 돌아오면 다른 단계 오류가 섞여 있다)', () => {
    const issues = [
      issue('name', 'basic'),
      issue('organizer', 'basic'),
      issue('applicationStartAt', 'schedule'),
    ];
    expect(visibleAuthoringIssueCount(issues, 'basic')).toBe(2);
  });

  it('같은 칸 오류가 두 번 쌓여도 한 줄로 센다', () => {
    const issues = [
      issue('applicationEndAt', 'schedule'),
      issue('applicationEndAt', 'schedule'),
    ];
    expect(visibleAuthoringIssueCount(issues, 'schedule')).toBe(1);
  });

  it('일정은 시작·종료를 기간 한 줄로 센다', () => {
    const issues = [
      issue('applicationStartAt', 'schedule'),
      issue('applicationEndAt', 'schedule'),
      issue('operationStartAt', 'schedule'),
      issue('operationEndAt', 'schedule'),
    ];
    expect(visibleAuthoringIssueCount(issues, 'schedule')).toBe(2);
  });

  it('마일스톤 단계는 페이지에 보이는 목록 오류 한 줄만 센다(항목 오류는 편집 창 안에 뜬다)', () => {
    const issues = [
      issue('milestones', 'milestones'),
      issue('milestones.a.name', 'milestones'),
      issue('milestones.b.dueAt', 'milestones'),
    ];
    expect(visibleAuthoringIssueCount(issues, 'milestones')).toBe(1);
  });
});

describe('visibleProgramEditErrorCount — 프로그램 정보 폼의 보이는 오류 줄', () => {
  it('저장 버튼 옆에 따로 서는 general 은 세지 않는다', () => {
    expect(visibleProgramEditErrorCount({ name: 'x', general: '실패' })).toBe(
      1,
    );
  });

  it('운영 기간은 시작·종료 오류를 한 줄로 센다', () => {
    expect(
      visibleProgramEditErrorCount({ startAt: 'x', endAt: 'y', period: 'z' }),
    ).toBe(2);
  });

  it('대표 이미지 칸이 스스로 띄운 오류는 한 줄로 더하고, 서버 오류와 겹치면 한 줄이다', () => {
    expect(visibleProgramEditErrorCount({ name: 'x' }, '형식 오류')).toBe(2);
    expect(
      visibleProgramEditErrorCount(
        { name: 'x', coverUploadId: '서버 오류' },
        '형식 오류',
      ),
    ).toBe(2);
  });

  it('필수값 넷이 비면 넷이다', () => {
    expect(
      visibleProgramEditErrorCount({
        name: 'x',
        organizer: 'x',
        trackType: 'x',
        description: 'x',
      }),
    ).toBe(4);
  });
});
