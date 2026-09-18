import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { previewProgramNotice } from './program-notice-api';
import {
  createInitialProgramAuthoringState,
  programAuthoringReducer,
} from './program-authoring-model';
import { buildProgramAuthoringManifest } from './program-authoring-manifest';
import {
  createProgramSubmissionRuntime,
  ensureUploads,
} from './program-authoring-submit';

vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  apiClient: vi.fn(),
}));

const externalCover = {
  sourceUrl: 'https://sojoong.kr/notice/?uid=42&mod=document',
  imageUrl:
    'https://sojoong.kr/wp-content/uploads/kboard_attached/1/209901/synthetic.jpg',
};

describe('notice import authoring contract', () => {
  it('uses the existing API boundary and forwards cancellation', async () => {
    const controller = new AbortController();
    const result = {
      sourceUrl: externalCover.sourceUrl,
      name: '합성 행사',
      description: '첫 문단\n\n둘째 문단',
      coverImages: [externalCover.imageUrl],
      warnings: [],
    };
    vi.mocked(apiClient).mockResolvedValueOnce(result);
    expect(
      await previewProgramNotice(externalCover.sourceUrl, controller.signal),
    ).toEqual(result);
    expect(apiClient).toHaveBeenCalledWith('program-authoring/notice-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: externalCover.sourceUrl }),
      signal: controller.signal,
    });
  });

  it('applies only selected notice fields and preserves manual operational settings', () => {
    const initial = {
      ...createInitialProgramAuthoringState({
        idempotencyKey: 'draft',
        milestoneId: 'milestone',
      }),
      name: '직접 입력한 이름',
      organizer: '합성 운영팀',
      description: '직접 쓴 설명',
      applicationStartAt: '2099-01-01T09:00',
      applicationEndAt: '2099-01-02T18:00',
      operationStartAt: '2099-01-03T09:00',
      operationEndAt: '2099-01-04T18:00',
      teamMaxSize: '3',
      milestones: [
        {
          id: 'manual',
          name: '직접 만든 제출 단계',
          startAt: '2099-01-03T09:00',
          dueAt: '2099-01-04T18:00',
          instructions: '',
          requirements: [
            {
              id: 'file',
              name: '필수 보고서',
              required: true,
              templateFile: null,
            },
          ],
        },
      ],
    };
    const updated = programAuthoringReducer(initial, {
      type: 'apply_notice',
      patch: {
        description: '첫 문단\n\n- 항목 하나\n- 항목 둘',
        externalCover,
      },
    });
    expect(updated).toEqual({
      ...initial,
      description: '첫 문단\n\n- 항목 하나\n- 항목 둘',
      coverFile: null,
      externalCover,
    });
    const manifest = buildProgramAuthoringManifest(
      updated,
      new Map([['program-cover', 'stale-upload']]),
    );
    expect(manifest.externalCover).toEqual(externalCover);
    expect(manifest).not.toHaveProperty('coverUploadId');
    const removed = programAuthoringReducer(updated, {
      type: 'set_cover_file',
      file: null,
    });
    expect(
      buildProgramAuthoringManifest(removed, new Map()),
    ).not.toHaveProperty('externalCover');
  });

  it('does not upload a remote poster and cleans an obsolete owned upload', async () => {
    const state = {
      ...createInitialProgramAuthoringState({
        idempotencyKey: 'draft',
        milestoneId: 'milestone',
      }),
      externalCover,
    };
    const runtime = createProgramSubmissionRuntime();
    runtime.uploads.set('program-cover', { id: 'obsolete' });
    const api = {
      uploadCoverFile: vi.fn(),
      uploadFile: vi.fn(),
      deleteUpload: vi.fn().mockResolvedValue(undefined),
      createProgram: vi.fn(),
    };
    expect(
      await ensureUploads({ state, files: new Map(), runtime, api }),
    ).toBeNull();
    expect(api.uploadCoverFile).not.toHaveBeenCalled();
    expect(api.deleteUpload).toHaveBeenCalledWith('obsolete');
  });
});
