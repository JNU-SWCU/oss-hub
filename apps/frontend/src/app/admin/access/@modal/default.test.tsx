import { describe, expect, it } from 'vitest';

import AdminAccessModalDefault from './default';

describe('AdminAccessModalDefault — @modal 슬롯 기본값(PR04F)', () => {
  it('아무것도 렌더링하지 않는다(null)', () => {
    expect(AdminAccessModalDefault()).toBeNull();
  });
});
