'use client';

import { useCallback, useState } from 'react';

type FileCheck =
  | { readonly file: File; readonly kind: 'checking' }
  | {
      readonly file: File;
      readonly kind: 'rejected';
      readonly message: string;
    };

/**
 * 고른 파일을 제출 전에 서버 판정에 묻는 자리(#1108) — 제출을 눌러야 보이던 거절 사유를
 * 고르는 순간으로 당긴다. 무엇을 물을지·어떤 문장을 보일지는 부르는 feature가 정한다.
 *
 * 결과는 판정을 받은 **그 파일**에 묶인다. 다른 파일을 고르거나 선택이 비면 지난 결과는
 * 보이지 않는다 — 늦게 도착한 응답이 새로 고른 파일에 붙지 않는다.
 */
export function useFileCheck(selectedFile: File | null) {
  const [check, setCheck] = useState<FileCheck | null>(null);

  /**
   * `verdict`는 거절이면 보일 문장을, 통과면 `null`을 돌려준다. 판정이 아닌 실패(세션 만료·
   * 네트워크)도 `null`이다 — 그때는 아무 말도 붙이지 않고 제출 때의 검사에 맡긴다.
   * `verdict` 없이 부르면 물을 파일이 아니라는 뜻이라 지난 결과만 걷는다.
   */
  const start = useCallback(
    (file: File | null, verdict?: (file: File) => Promise<string | null>) => {
      if (file === null || verdict === undefined) {
        setCheck(null);
        return;
      }
      setCheck({ file, kind: 'checking' });
      const settle = (message: string | null) =>
        setCheck((current) =>
          current?.file !== file
            ? current
            : message === null
              ? null
              : { file, kind: 'rejected', message },
        );
      verdict(file).then(settle, () => settle(null));
    },
    [],
  );

  const current = check?.file === selectedFile ? check : null;
  return {
    start,
    checking: current?.kind === 'checking',
    message: current?.kind === 'rejected' ? current.message : null,
  };
}
