import {
  inspectSubmissionZipMetadata,
  SUBMISSION_ZIP_REJECTION_MESSAGES,
  SubmissionZipRejection,
} from './submission-zip-admission';
import { signatureValidZip } from './submission-zip-test-builder';

const MIB = 1024 * 1024;

const TRADITIONAL_ENCRYPTION_HEADER_BYTES = 12;

const FORBIDDEN_NAME_CHARACTER = String.fromCharCode(0);

const REJECTIONS: ReadonlyArray<
  readonly [string, SubmissionZipRejection, () => Buffer]
> = [
  [
    '안에 또 다른 압축 파일이 있는 경우',
    SubmissionZipRejection.NESTED_ARCHIVE,
    () => signatureValidZip([{ name: 'nested.ZIP' }]),
  ],
  [
    '비밀번호가 걸린 항목이 있는 경우',
    SubmissionZipRejection.PASSWORD_PROTECTED,
    () =>
      signatureValidZip([
        {
          name: 'encrypted.txt',
          flags: 0x0001,
          compressedSize: 1 + TRADITIONAL_ENCRYPTION_HEADER_BYTES,
          uncompressedSize: 1,
        },
      ]),
  ],
  [
    '항목 수가 1,000개를 넘는 경우',
    SubmissionZipRejection.TOO_MANY_ENTRIES,
    () =>
      signatureValidZip(
        Array.from({ length: 1_001 }, (_, index) => ({
          name: `entry-${index}.txt`,
        })),
      ),
  ],
  [
    '항목 하나가 풀었을 때 100 MiB를 넘는 경우',
    SubmissionZipRejection.CONTENT_TOO_LARGE,
    () =>
      signatureValidZip([
        {
          name: 'entry-expansion.txt',
          compressionMethod: 8,
          compressedSize: 2 * MIB,
          uncompressedSize: 100 * MIB + 1,
        },
      ]),
  ],
  [
    '풀었을 때 총합이 200 MiB를 넘는 경우',
    SubmissionZipRejection.CONTENT_TOO_LARGE,
    () =>
      signatureValidZip(
        Array.from({ length: 3 }, (_, index) => ({
          name: `aggregate-${index}.txt`,
          compressionMethod: 8,
          compressedSize: MIB,
          uncompressedSize: 70 * MIB,
        })),
      ),
  ],
  [
    '항목 하나의 압축률이 100배를 넘는 경우',
    SubmissionZipRejection.EXPANDS_TOO_MUCH,
    () =>
      signatureValidZip([
        {
          name: 'entry-ratio.txt',
          compressionMethod: 8,
          compressedSize: 1_024,
          uncompressedSize: 101 * 1_024,
        },
      ]),
  ],
  [
    '압축 방식이 무압축(0)·deflate(8)가 아닌 경우',
    SubmissionZipRejection.UNSUPPORTED_COMPRESSION,
    () =>
      signatureValidZip([{ name: 'unsupported.txt', compressionMethod: 99 }]),
  ],
  [
    '실제 내용이 없는 링크 항목이 있는 경우',
    SubmissionZipRejection.ENTRY_NOT_ALLOWED,
    () =>
      signatureValidZip([
        {
          name: 'link.txt',
          versionMadeBy: 0x0314,
          externalAttributes: 0xa1ff0000,
        },
      ]),
  ],
  [
    '항목 이름에 담을 수 없는 문자가 있는 경우',
    SubmissionZipRejection.ENTRY_NOT_ALLOWED,
    () =>
      signatureValidZip([
        { name: `broken${FORBIDDEN_NAME_CHARACTER}name.txt` },
      ]),
  ],
  [
    '끝이 잘린 경우',
    SubmissionZipRejection.UNREADABLE,
    () => {
      const archive = signatureValidZip([{ name: 'truncated.txt' }]);
      return archive.subarray(0, archive.byteLength - 1);
    },
  ],
  [
    '중앙 디렉터리 위치가 깨진 경우',
    SubmissionZipRejection.UNREADABLE,
    () => {
      const archive = signatureValidZip([{ name: 'malformed.txt' }]);
      archive.writeUInt32LE(0xffffffff, archive.byteLength - 6);
      return archive;
    },
  ],
  [
    '바깥으로 빠져나가는 경로가 있는 경우',
    SubmissionZipRejection.UNREADABLE,
    () => signatureValidZip([{ name: '../outside.txt' }]),
  ],
];

describe('inspectSubmissionZipMetadata — 거절 사유를 갈래별로 돌려준다', () => {
  it('중첩·비밀번호 없이 한도 안에 있는 .zip은 통과한다', async () => {
    const archive = signatureValidZip([{ name: 'valid.txt' }]);

    const rejection = await inspectSubmissionZipMetadata(archive);

    expect(rejection).toBeNull();
  });

  it.each(REJECTIONS)(
    '%s는 %s로 돌려준다',
    async (_scenario, expected, build) => {
      const archive = build();

      const rejection = await inspectSubmissionZipMetadata(archive);

      expect(rejection).toBe(expected);
    },
  );
});

describe('막는 기준은 그대로다', () => {
  it('항목 1,000개까지는 통과하고 1,001개부터 막는다', async () => {
    const build = (count: number) =>
      signatureValidZip(
        Array.from({ length: count }, (_, index) => ({
          name: `entry-${index}.txt`,
        })),
      );

    expect(await inspectSubmissionZipMetadata(build(1_000))).toBeNull();
    expect(await inspectSubmissionZipMetadata(build(1_001))).toBe(
      SubmissionZipRejection.TOO_MANY_ENTRIES,
    );
  });

  it('항목 하나가 100 MiB까지는 통과하고 1바이트만 넘어도 막는다', async () => {
    const build = (uncompressedSize: number) =>
      signatureValidZip([
        {
          name: 'entry.txt',
          compressionMethod: 8,
          compressedSize: MIB,
          uncompressedSize,
        },
      ]);

    expect(await inspectSubmissionZipMetadata(build(100 * MIB))).toBeNull();
    expect(await inspectSubmissionZipMetadata(build(100 * MIB + 1))).toBe(
      SubmissionZipRejection.CONTENT_TOO_LARGE,
    );
  });

  it('총합 200 MiB까지는 통과하고 넘으면 막는다', async () => {
    const build = (uncompressedSize: number) =>
      signatureValidZip(
        Array.from({ length: 2 }, (_, index) => ({
          name: `entry-${index}.txt`,
          compressionMethod: 8,
          compressedSize: MIB,
          uncompressedSize,
        })),
      );

    expect(await inspectSubmissionZipMetadata(build(100 * MIB))).toBeNull();
    expect(await inspectSubmissionZipMetadata(build(100 * MIB + 1))).toBe(
      SubmissionZipRejection.CONTENT_TOO_LARGE,
    );
  });

  it('압축률 100배까지는 통과하고 넘으면 막는다', async () => {
    const build = (uncompressedSize: number) =>
      signatureValidZip([
        {
          name: 'entry.txt',
          compressionMethod: 8,
          compressedSize: 1_024,
          uncompressedSize,
        },
      ]);

    expect(await inspectSubmissionZipMetadata(build(100 * 1_024))).toBeNull();
    expect(await inspectSubmissionZipMetadata(build(100 * 1_024 + 1))).toBe(
      SubmissionZipRejection.EXPANDS_TOO_MUCH,
    );
  });

  it.each([0, 8])('압축 방식 %i은 그대로 받는다', async (compressionMethod) => {
    const archive = signatureValidZip([
      { name: 'entry.txt', compressionMethod },
    ]);

    expect(await inspectSubmissionZipMetadata(archive)).toBeNull();
  });
});

describe('학생이 읽는 문장', () => {
  const messages = Object.values(SUBMISSION_ZIP_REJECTION_MESSAGES);

  it('갈래마다 다른 문장을 준다', () => {
    expect(new Set(messages).size).toBe(messages.length);
  });

  it.each(['압축률', '엔트리', 'deflate', '메타데이터'])(
    '내부 용어 「%s」를 그대로 내보내지 않는다',
    (term) => {
      for (const message of messages) {
        expect(message.toLowerCase()).not.toContain(term.toLowerCase());
      }
    },
  );

  it('무엇을 하면 되는지가 문장에 있다', () => {
    for (const message of messages) {
      expect(message).toMatch(/주세요\.$/);
    }
  });

  it('압축 안 항목의 이름을 밖으로 내보내지 않는다', async () => {
    const archive = signatureValidZip([{ name: '개인정보-동의서-원본.ZIP' }]);

    const rejection = await inspectSubmissionZipMetadata(archive);

    expect(rejection).toBe(SubmissionZipRejection.NESTED_ARCHIVE);
    expect(
      SUBMISSION_ZIP_REJECTION_MESSAGES[SubmissionZipRejection.NESTED_ARCHIVE],
    ).not.toContain('개인정보-동의서-원본');
  });
});
