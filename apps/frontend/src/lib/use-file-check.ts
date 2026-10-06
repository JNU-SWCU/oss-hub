'use client';

import { useCallback, useState } from 'react';

type FileCheck =
  | { readonly file: File; readonly kind: 'checking' }
  | {
      readonly file: File;
      readonly kind: 'rejected';
      readonly message: string;
    };

export function useFileCheck(selectedFile: File | null) {
  const [check, setCheck] = useState<FileCheck | null>(null);

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
