import { describe, expect, it } from 'vitest';

import ApplicantQueueModalDefault from './default';

describe('ApplicantQueueModalDefault — @modal 슬롯 기본값', () => {
  it('아무것도 렌더링하지 않는다(null)', () => {
    expect(ApplicantQueueModalDefault()).toBeNull();
  });
});
