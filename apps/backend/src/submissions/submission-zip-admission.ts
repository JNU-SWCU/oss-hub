import { fromBufferPromise, type Entry } from 'yauzl';

const MAX_ENTRY_COUNT = 1_000;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;
const UNIX_HOST_SYSTEM = 3;
const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_SYMLINK_TYPE = 0xa000;

/**
 * 압축 파일 입장 검사가 거절한 이유(#1108).
 *
 * 이 검사는 참/거짓 하나만 돌려주고 있었고, 호출부는 그 거짓을 확장자·서명 실패와 **같은**
 * 코드로 던졌다. 그래서 허용 형식인 `.zip`을 낸 학생이 「지원하지 않는 파일 형식입니다」를
 * 읽었다 — 형식은 맞는데 형식 탓이라고 답하니 학생은 고칠 곳을 찾을 수 없었다.
 *
 * ⚠ 막는 조건과 그 값은 이 티켓에서 하나도 바뀌지 않았다(중첩 금지·항목 1,000개·항목
 *   100 MiB·총합 200 MiB·압축률 100배·압축 방식 0·8). 바뀐 것은 **알리는 방식**뿐이다.
 *
 * 갈래를 나눈 기준은 「학생이 다음에 할 일이 달라지는가」 하나다. 그래서
 * - 항목 하나가 큰 것과 총합이 큰 것은 한 갈래다 — 둘 다 담긴 내용을 줄여야 한다.
 * - 항목 하나의 압축률과 총 압축률도 한 갈래다.
 * - 반대로 「다시 압축해 주세요」로 끝나는 셋(중첩·비밀번호·압축 방식)은 가른다.
 *   할 일이 같아 보여도 **무엇을 바꿔 다시 압축해야 하는지**가 서로 다르다.
 */
export const SubmissionZipRejection = {
  /** 압축 파일 자체를 읽지 못했다 — 손상·잘림, 또는 읽기가 거부하는 항목 이름. */
  UNREADABLE: 'UNREADABLE',
  /** 실제 내용이 없는 항목(바로가기·링크)이나 담을 수 없는 이름의 항목이 있다. */
  ENTRY_NOT_ALLOWED: 'ENTRY_NOT_ALLOWED',
  /** 압축 파일 안에 또 다른 압축 파일이 있다. */
  NESTED_ARCHIVE: 'NESTED_ARCHIVE',
  /** 비밀번호가 걸린 항목이 있다. */
  PASSWORD_PROTECTED: 'PASSWORD_PROTECTED',
  /** 무압축(0)·deflate(8) 밖의 압축 방식으로 만든 항목이 있다. */
  UNSUPPORTED_COMPRESSION: 'UNSUPPORTED_COMPRESSION',
  /** 담긴 항목 수가 한도를 넘는다. */
  TOO_MANY_ENTRIES: 'TOO_MANY_ENTRIES',
  /** 풀었을 때의 크기가 항목 단위 또는 총합 한도를 넘는다. */
  CONTENT_TOO_LARGE: 'CONTENT_TOO_LARGE',
  /** 풀었을 때 압축 파일보다 지나치게 커진다(항목 단위 또는 총합). */
  EXPANDS_TOO_MUCH: 'EXPANDS_TOO_MUCH',
} as const;

export type SubmissionZipRejection =
  (typeof SubmissionZipRejection)[keyof typeof SubmissionZipRejection];

/**
 * 갈래별로 학생이 읽는 문장. **제출 경로와 서류 경로가 같은 문장을 쓴다** — 두 경로는
 * 오류 코드 체계가 따로지만(SUB_*·MSD_*) 같은 입력에는 같은 말을 해야 한다. 문장을 각
 * 레지스트리에 따로 적으면 그 순간 두 경로의 안내가 갈라진다.
 *
 * 문구 규칙 두 가지:
 * 1. 학생이 **다음에 무엇을 하면 되는지**가 문장에서 읽혀야 한다.
 * 2. 내부 개념(압축률·엔트리·deflate·메타데이터)을 그대로 내보내지 않는다.
 *    한도 숫자는 내부 용어가 아니라 학생이 맞춰야 할 값이므로 적는다 — 숫자 없는 안내로는
 *    무엇을 얼마나 줄여야 하는지 알 수 없다(#1107에서 같은 판단을 했다).
 *
 * ⚠ 압축 안 항목의 이름·경로는 어떤 갈래에서도 문장에 넣지 않는다(#1108 금지 조항).
 *   무엇이 걸렸는지는 알려 주되 그것이 무슨 파일인지는 밖으로 내보내지 않는다.
 */
export const SUBMISSION_ZIP_REJECTION_MESSAGES: Readonly<
  Record<SubmissionZipRejection, string>
> = {
  [SubmissionZipRejection.UNREADABLE]:
    '압축 파일을 열 수 없습니다. 파일이 손상되지 않았는지 확인하고 다시 압축해 제출해 주세요.',
  [SubmissionZipRejection.ENTRY_NOT_ALLOWED]:
    '압축 파일에 담을 수 없는 항목이 있습니다. 바로가기 대신 실제 파일만 담아 다시 압축해 주세요.',
  [SubmissionZipRejection.NESTED_ARCHIVE]:
    '압축 파일 안에 또 다른 압축 파일이 있습니다. 안쪽 압축을 풀고 다시 압축해 주세요.',
  [SubmissionZipRejection.PASSWORD_PROTECTED]:
    '비밀번호가 걸린 압축 파일은 제출할 수 없습니다. 비밀번호 없이 다시 압축해 주세요.',
  [SubmissionZipRejection.UNSUPPORTED_COMPRESSION]:
    '이 압축 방식은 제출할 수 없습니다. 컴퓨터에 기본으로 있는 압축 기능으로 다시 압축해 주세요.',
  [SubmissionZipRejection.TOO_MANY_ENTRIES]: `압축 파일에 담긴 파일이 너무 많습니다. ${MAX_ENTRY_COUNT.toLocaleString('en-US')}개 이하로 줄여 다시 압축해 주세요.`,
  [SubmissionZipRejection.CONTENT_TOO_LARGE]: `압축을 풀었을 때의 크기가 너무 큽니다. 파일 하나는 ${MAX_ENTRY_UNCOMPRESSED_BYTES / 1024 / 1024} MB, 전체는 ${MAX_TOTAL_UNCOMPRESSED_BYTES / 1024 / 1024} MB 이하가 되도록 줄여 주세요.`,
  [SubmissionZipRejection.EXPANDS_TOO_MUCH]:
    '압축을 풀면 크기가 지나치게 불어나는 파일이 들어 있습니다. 그 파일을 빼고 다시 압축하거나 담당 교직원에게 문의해 주세요.',
};

/**
 * 통과하면 `null`, 막히면 그 이유를 돌려준다.
 *
 * 참/거짓으로 접지 않는 것이 이 함수의 존재 이유다 — 호출부(제출·서류)가 갈래마다 다른
 * 오류 코드로 응답해야 학생이 무엇을 고쳐야 하는지 알 수 있다.
 *
 * 검사 순서는 예전 `isSafeSubmissionZipMetadata`의 `&&` 사슬 순서를 그대로 지킨다.
 * 통과·거절 판정 자체는 순서와 무관하지만 **어느 갈래로 답하는지**는 순서가 정하므로,
 * 여러 조건에 한꺼번에 걸린 압축 파일이 매번 다른 말을 듣지 않게 못 박아 둔다.
 */
export async function inspectSubmissionZipMetadata(
  buffer: Buffer,
): Promise<SubmissionZipRejection | null> {
  try {
    const zipFile = await fromBufferPromise(buffer, {
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    if (zipFile.entryCount > MAX_ENTRY_COUNT) {
      return SubmissionZipRejection.TOO_MANY_ENTRIES;
    }

    let entryCount = 0;
    let totalCompressedBytes = 0;
    let totalUncompressedBytes = 0;
    for await (const entry of zipFile.eachEntry()) {
      entryCount += 1;
      const entryRejection = inspectEntry(entry);
      if (entryRejection !== null) return entryRejection;

      totalCompressedBytes += entry.compressedSize;
      totalUncompressedBytes += entry.uncompressedSize;
      if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        return SubmissionZipRejection.CONTENT_TOO_LARGE;
      }
      if (
        exceedsCompressionRatio(totalUncompressedBytes, totalCompressedBytes)
      ) {
        return SubmissionZipRejection.EXPANDS_TOO_MUCH;
      }
    }
    // 중앙 디렉터리가 약속한 개수만큼 실제로 읽히지 않았다 — 읽어 낸 것만 믿지 않는다.
    return entryCount === zipFile.entryCount
      ? null
      : SubmissionZipRejection.UNREADABLE;
  } catch {
    return SubmissionZipRejection.UNREADABLE;
  }
}

function inspectEntry(entry: Entry): SubmissionZipRejection | null {
  const fileName = entry.fileName.toLowerCase();
  if (entry.fileName.includes('\u0000')) {
    return SubmissionZipRejection.ENTRY_NOT_ALLOWED;
  }
  if (fileName.endsWith('.zip')) return SubmissionZipRejection.NESTED_ARCHIVE;
  if (isUnixSymlink(entry)) return SubmissionZipRejection.ENTRY_NOT_ALLOWED;
  if (entry.isEncrypted()) return SubmissionZipRejection.PASSWORD_PROTECTED;
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    return SubmissionZipRejection.UNSUPPORTED_COMPRESSION;
  }
  if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
    return SubmissionZipRejection.CONTENT_TOO_LARGE;
  }
  if (exceedsCompressionRatio(entry.uncompressedSize, entry.compressedSize)) {
    return SubmissionZipRejection.EXPANDS_TOO_MUCH;
  }
  return null;
}

function isUnixSymlink(entry: Entry): boolean {
  const hostSystem = entry.versionMadeBy >>> 8;
  const unixFileType =
    (entry.externalFileAttributes >>> 16) & UNIX_FILE_TYPE_MASK;
  return hostSystem === UNIX_HOST_SYSTEM && unixFileType === UNIX_SYMLINK_TYPE;
}

function exceedsCompressionRatio(
  uncompressedBytes: number,
  compressedBytes: number,
): boolean {
  return uncompressedBytes > compressedBytes * MAX_COMPRESSION_RATIO;
}
