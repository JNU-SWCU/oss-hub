/**
 * 교직원 서류 **일괄 내려받기(ZIP)** 의 업무 규칙 — 무엇을 담고, ZIP 안 어디에 놓고,
 * 동봉하는 `제출현황.csv`가 무엇을 말하는가.
 *
 * `domain/milestone-document-collection-page.ts`와 같은 자리에 같은 이유로 둔다(ADR-003):
 * 스트리밍·스토리지·HTTP를 아는 쪽과 「무엇을 담을 것인가」를 정하는 쪽을 갈라 둬야,
 * 압축 방식을 바꾸다가 담기는 목록이 함께 바뀌는 일이 없다. 순수 함수라 Prisma·Nest·yazl
 * 어디에도 기대지 않는다.
 *
 * ⚠ **수합 표와 달리 페이지를 자르지 않는다.** 이 기능의 요구 자체가 「전체를 한 번에」다 —
 * 화면의 빠른 필터·페이지는 보는 사람의 편의이고, 받아서 보관하는 쪽은 전체가 필요하다.
 */
import { MilestoneSubmissionType, SubmissionStatus } from '@prisma/client';
import {
  milestoneDocumentArchiveFolderName,
  milestoneDocumentDownloadFileName,
  milestoneDocumentTextEntryFileName,
} from '../milestone-document-download-file-name';
import { readMilestoneDocumentSubmittedContent } from './milestone-document-content';

/**
 * ZIP 안 폴더를 무엇으로 묶는가. 담는 파일은 **완전히 같고 경로만 뒤집힌다** —
 * 「팀별로 한 팀이 낸 것을 다 본다」와 「서류별로 같은 서류를 나란히 본다」는 마감 때
 * 둘 다 필요한 작업이라 한쪽만 내면 나머지 한쪽은 손으로 폴더를 다시 짠다.
 *
 * ⚠ 이건 **바깥으로 열어 둔 값**이다(`groupBy` 쿼리). 안쪽 배치는 `…ArchiveLayout` 이 정하며
 * 거기에는 `FLAT` 이 하나 더 있다 — 서류 하나만 받을 때는 폴더 자체가 뜻이 없어서다.
 */
export type MilestoneDocumentArchiveGrouping = 'TEAM' | 'DOCUMENT';

export const MILESTONE_DOCUMENT_ARCHIVE_GROUPINGS: readonly MilestoneDocumentArchiveGrouping[] =
  ['TEAM', 'DOCUMENT'];

/**
 * ZIP 안 배치. `FLAT` 은 **폴더 없이 뿌리에** 늘어놓는다.
 *
 * 서류 한 종류만 받을 때 쓴다 — 팀별로 묶으면 폴더 47개가 각각 파일 하나씩 안고 있고,
 * 서류별로 묶으면 뿌리에 폴더 하나가 서서 전부를 안는다. 둘 다 한 겹이 헛돈다.
 *
 * 바깥 계약(`groupBy`)에 `FLAT` 을 넣지 않는 이유: 「전체를 평평하게」는 팀·서류가 뒤섞여
 * 이름만으로 구분해야 하는 상태라 아무도 원하지 않는다. 서류가 하나로 좁혀졌을 때만 뜻이 있다.
 */
export type MilestoneDocumentArchiveLayout =
  | MilestoneDocumentArchiveGrouping
  | 'FLAT';

/** 동봉하는 현황표의 이름. ZIP 뿌리에 놓는다. */
export const MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME = '제출현황.csv';

/** 표의 열 — 이 마일스톤이 요구하는 서류 항목. `sortOrder` 오름차순으로 받는다. */
export interface MilestoneDocumentArchiveDocument {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly submissionType: MilestoneSubmissionType;
}

/** 표의 행 — 승인된 신청(= 팀) 하나. 팀 이름 asc → id asc로 받는다. */
export interface MilestoneDocumentArchiveTeam {
  readonly applicationId: string;
  readonly teamName: string;
  readonly applicantName: string | null;
  readonly memberNicknames: readonly string[];
}

/** 제출 한 건과 그 첨부. 첨부는 ATTACHED이고 만료되지 않은 것만 채워져 온다. */
export interface MilestoneDocumentArchiveSubmission {
  readonly applicationId: string;
  readonly milestoneDocumentId: string;
  readonly submittedAt: Date;
  readonly status: SubmissionStatus;
  /** `MilestoneDocumentSubmission.content` 원문. 해석은 이 모듈이 도메인 파서로 한다. */
  readonly content: unknown;
  readonly file: {
    readonly storageKey: string;
    readonly originalFileName: string;
    readonly sizeBytes: number;
  } | null;
}

/**
 * ZIP에 담을 것 하나.
 *
 * `STORED_FILE`은 스토리지에서 **흘려 보내는** 항목이라 내용이 아니라 열쇠와 크기만 갖는다 —
 * 도메인이 파일 본문을 손에 쥐면 그 순간 전체를 메모리에 올리는 설계가 된다.
 */
export type MilestoneDocumentArchiveEntry =
  | {
      readonly kind: 'STORED_FILE';
      readonly path: string;
      /**
       * 압축 안에 기록할 수정 시각 — **학생이 낸 시각**을 쓴다. 압축을 푼 폴더를 시각순으로
       * 정렬하는 것이 마감 정리의 실제 동선이라, 여기에 내려받은 시각을 쓰면 모든 파일이
       * 같은 시각이 되어 그 정렬이 통째로 뜻을 잃는다.
       *
       * ⚠ **이 시각이 KST로 보이는 것은 컨테이너의 `TZ` 덕이다.** ZIP은 시각을 두 벌 적는데
       * 옛 DOS 필드는 「만든 쪽의 로컬 시각」이라 타임존을 안 담는다(Info-ZIP 확장 필드만 참
       * UTC를 담는다). Windows 탐색기는 **DOS 필드만 보므로**, 프로세스가 UTC로 돌면 제출
       * 시각이 9시간 이르게 보이고 마감 직후 제출이 전날 제출로 읽힌다.
       *
       * 그래서 여기서 시각을 밀어 맞추지 **않는다** — 그러면 DOS 필드가 맞는 대신 확장 필드가
       * 틀려 7-Zip·unzip·macOS 쪽이 깨진다. 지킬 자리는 `apps/backend/Dockerfile`의
       * `ENV TZ=Asia/Seoul` 하나이고, 그 값을 지우면
       * `milestone-document-archive-timezone.spec.ts`가 깨진다.
       */
      readonly modifiedAt: Date;
      readonly storageKey: string;
      readonly sizeBytes: number;
    }
  | {
      readonly kind: 'INLINE_TEXT';
      readonly path: string;
      readonly modifiedAt: Date;
      readonly body: string;
    };

/** 표의 다섯 갈래. 프런트 `milestone-document-review.ts`의 같은 이름·같은 규칙이다. */
export type MilestoneDocumentArchiveCellState =
  'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

/**
 * 제출은 있는데 ZIP에 담기지 않은 이유. 담겼거나 미제출이면 `null`이다.
 *
 * ⚠ 이 값이 없으면 **CSV와 ZIP이 서로 다른 말을 한다** — 「승인」이라고 적힌 팀의 폴더에
 * 파일이 없고, 받은 사람은 압축이 깨진 것으로 읽는다.
 */
export type MilestoneDocumentArchiveOmission =
  /**
   * 파일 제출인데 담을 첨부가 없다.
   *
   * ⚠ **왜 그런지까지는 모른다.** 첨부가 안 실려 오는 조건은 「ATTACHED이고 만료 전」 하나이고,
   * 거기 걸리지 않는 이유는 보존 기한 만료 · 삭제 대기 · 삭제 완료 여러 가지다. 이 값을 「만료」로
   * 읽어 문구를 붙이면 교직원이 **되살릴 수 있는 건을 포기한다** — 실제 원인이 정리 작업이면
   * 학생에게 다시 올리라고 하면 되는 건이다.
   */
  | 'FILE_UNAVAILABLE'
  /** 글·저장소 릴리스 제출인데 본문을 읽을 수 없다(계약상 없어야 하는 상태). */
  | 'CONTENT_UNAVAILABLE';

/** 현황표의 한 칸 — (팀, 서류) 하나. 미제출도 칸이 비지 않는다. */
export interface MilestoneDocumentArchiveCell {
  readonly documentId: string;
  readonly state: MilestoneDocumentArchiveCellState;
  readonly submittedAt: Date | null;
  /** ZIP 안 경로. 담기지 않았으면 `null`. */
  readonly path: string | null;
  readonly omission: MilestoneDocumentArchiveOmission | null;
}

/** 현황표의 한 행 — `cells[i]`는 `documents[i]`에 대응한다(열 순서가 계약이다). */
export interface MilestoneDocumentArchiveManifestRow {
  readonly team: MilestoneDocumentArchiveTeam;
  readonly cells: readonly MilestoneDocumentArchiveCell[];
}

export interface MilestoneDocumentArchivePlan {
  /** 동봉 CSV를 제외한, 담을 것 전부. 넣는 순서가 곧 ZIP 안 순서다. */
  readonly entries: readonly MilestoneDocumentArchiveEntry[];
  readonly manifest: readonly MilestoneDocumentArchiveManifestRow[];
  /** 스토리지에서 흘려 보낼 바이트 합계. */
  readonly storedBytes: number;
  /**
   * 그 자리에서 만들어 담는 바이트 합계(글·저장소 릴리스 본문).
   *
   * 파일과 갈라 세지만 **상한 판단에는 둘을 더한다** — 글 제출은 한 건이 최대 10,000자라
   * 작아 보여도 (팀 수 × 서류 수)만큼 쌓이면 수백 MB가 된다. 파일만 세면 글로만 이루어진
   * 마일스톤은 상한이 아예 없는 것과 같다.
   */
  readonly inlineBytes: number;
}

export interface BuildMilestoneDocumentArchivePlanInput {
  readonly documents: readonly MilestoneDocumentArchiveDocument[];
  readonly teams: readonly MilestoneDocumentArchiveTeam[];
  readonly submissions: readonly MilestoneDocumentArchiveSubmission[];
  readonly layout: MilestoneDocumentArchiveLayout;
}

/**
 * 담을 것과 그 경로를 정한다.
 *
 * 순서 규칙: 팀 → 서류(둘 다 받은 순서 그대로)다. `grouping`은 **경로만** 뒤집고 순서는
 * 건드리지 않는다 — 압축을 푸는 쪽은 폴더로 보고, 흘려 보내는 쪽은 순서대로 읽으므로
 * 두 관심사를 섞으면 같은 ZIP이 두 벌의 정렬을 갖게 된다.
 *
 * **한 장도 안 낸 팀은 폴더를 만들지 않는다.** 빈 디렉터리는 압축을 푸는 프로그램에 따라
 * 조용히 사라져 「폴더가 있는데 비었다」를 신호로 쓸 수 없기 때문이다. 그 팀이 사라지는
 * 것은 아니다 — 동봉 CSV에는 미제출로 그대로 남는다.
 */
export function buildMilestoneDocumentArchivePlan(
  input: BuildMilestoneDocumentArchivePlanInput,
): MilestoneDocumentArchivePlan {
  const { documents, teams, submissions, layout } = input;

  // N+1 금지 — 수합 표(`buildMilestoneDocumentCollectionPage`)와 같은 (신청, 서류) 색인이다.
  const cellIndex = new Map<string, MilestoneDocumentArchiveSubmission>();
  for (const submission of submissions) {
    cellIndex.set(
      cellKey(submission.applicationId, submission.milestoneDocumentId),
      submission,
    );
  }

  const takenPaths = new Set<string>([
    collisionKey(MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME),
  ]);
  const entries: MilestoneDocumentArchiveEntry[] = [];
  let storedBytes = 0;
  let inlineBytes = 0;

  const manifest = teams.map((team) => ({
    team,
    cells: documents.map((document) => {
      const submission =
        cellIndex.get(cellKey(team.applicationId, document.id)) ?? null;
      if (submission === null) {
        return {
          documentId: document.id,
          state: 'NOT_SUBMITTED' as const,
          submittedAt: null,
          path: null,
          omission: null,
        };
      }

      const state = submittedState(submission.status);
      const entry = buildEntry({ team, document, submission, layout });
      if (entry === null) {
        return {
          documentId: document.id,
          state,
          submittedAt: submission.submittedAt,
          path: null,
          omission:
            document.submissionType === MilestoneSubmissionType.FILE
              ? ('FILE_UNAVAILABLE' as const)
              : ('CONTENT_UNAVAILABLE' as const),
        };
      }

      const path = uniquePath(entry.path, takenPaths);
      const placed = { ...entry, path };
      entries.push(placed);
      if (placed.kind === 'STORED_FILE') storedBytes += placed.sizeBytes;
      else inlineBytes += Buffer.byteLength(placed.body, 'utf8');
      return {
        documentId: document.id,
        state,
        submittedAt: submission.submittedAt,
        path,
        omission: null,
      };
    }),
  }));

  return { entries, manifest, storedBytes, inlineBytes };
}

function cellKey(applicationId: string, documentId: string): string {
  return `${applicationId}::${documentId}`;
}

/**
 * 제출이 있는 자리의 상태. 프런트 `submittedDisplay`와 같은 규칙이다 — 재제출이 상태를
 * `SUBMITTED`로 되돌리므로 「검토 대기」는 「아직 아무도 안 봤다」와 「보완 요청에 응해 다시
 * 냈다」 둘 다를 뜻한다. 두 화면이 같은 제출을 다른 말로 부르면 안 된다.
 */
function submittedState(
  status: SubmissionStatus,
): MilestoneDocumentArchiveCellState {
  return status === SubmissionStatus.SUBMITTED ? 'PENDING' : status;
}

/**
 * 이 (팀, 서류) 칸을 ZIP에 담을 수 있는가, 담는다면 무엇으로.
 *
 * **저장된 값이 스스로 무엇인지 말하는 것을 따른다** — 파일 첨부가 살아 있으면 파일,
 * 아니면 글·릴리스 본문. 서류 항목의 `submissionType`을 근거로 삼지 않는 이유는
 * `milestone-document-content.ts`에 적힌 것과 같다(둘이 어긋나는 날, 실제로 낸 것이 아닌
 * 것을 담게 된다).
 */
function buildEntry(input: {
  readonly team: MilestoneDocumentArchiveTeam;
  readonly document: MilestoneDocumentArchiveDocument;
  readonly submission: MilestoneDocumentArchiveSubmission;
  readonly layout: MilestoneDocumentArchiveLayout;
}): MilestoneDocumentArchiveEntry | null {
  const { team, document, submission, layout } = input;
  // `FLAT` 은 폴더가 없다 — 앞에 붙일 것이 없으니 빈 접두사가 된다.
  const prefix =
    layout === 'FLAT'
      ? ''
      : `${archiveFolderPath(layout === 'TEAM' ? team.teamName : document.name)}/`;

  if (submission.file !== null) {
    const fileName = milestoneDocumentDownloadFileName({
      teamName: team.teamName,
      documentName: document.name,
      originalFileName: submission.file.originalFileName,
    });
    return {
      kind: 'STORED_FILE',
      path: `${prefix}${fileName}`,
      modifiedAt: submission.submittedAt,
      storageKey: submission.file.storageKey,
      sizeBytes: submission.file.sizeBytes,
    };
  }

  const content = readMilestoneDocumentSubmittedContent(submission.content);
  if (content === null) return null;
  return {
    kind: 'INLINE_TEXT',
    path: `${prefix}${milestoneDocumentTextEntryFileName({
      teamName: team.teamName,
      documentName: document.name,
    })}`,
    modifiedAt: submission.submittedAt,
    body:
      content.type === MilestoneSubmissionType.TEXT
        ? content.text
        : content.releaseUrl,
  };
}

/**
 * 폴더 한 칸의 이름. **동봉 CSV와 같은 이름은 피한다** — 팀 이름(또는 서류 이름)이 하필
 * `제출현황.csv`면 압축을 풀 때 그 자리에 폴더와 파일이 동시에 서고, 대부분의 압축 프로그램은
 * 둘 중 하나를 만들지 못한 채 오류를 내거나 조용히 하나를 버린다.
 */
function archiveFolderPath(name: string): string {
  const folder = milestoneDocumentArchiveFolderName(name);
  // 대소문자를 접어 비교한다 — `제출현황.CSV` 폴더도 Windows·macOS에서는 동봉 CSV와 같은 자리다.
  return collisionKey(folder) ===
    collisionKey(MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME)
    ? `${folder} (2)`
    : folder;
}

/**
 * 이미 쓴 경로면 ` (2)`·` (3)`… 을 확장자 **앞에** 붙여 비킨다.
 *
 * ⚠ 이름이 겹치는 것은 이상한 경우가 아니라 **흔한 경우**다 — 팀 이름은 유일하지 않고
 * 한 마일스톤에 같은 이름의 서류 항목을 둘 수 있다. 그대로 두면 ZIP 안에 같은 경로가 두 번
 * 들어가고, 압축을 푸는 프로그램은 대개 **아무 말 없이 뒤엣것으로 덮어쓴다.** 그러면 받은
 * 사람은 파일이 하나 사라진 것을 영영 모른다.
 */
function uniquePath(path: string, taken: Set<string>): string {
  if (!taken.has(collisionKey(path))) {
    taken.add(collisionKey(path));
    return path;
  }
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  // 확장자로 볼 수 있는 것은 마지막 `/` 뒤에 오면서 이름 첫 글자가 아닌 `.` 뿐이다.
  const hasExtension = dot > slash + 1;
  const stem = hasExtension ? path.slice(0, dot) : path;
  const extension = hasExtension ? path.slice(dot) : '';
  for (let ordinal = 2; ; ordinal += 1) {
    const candidate = `${stem} (${ordinal})${extension}`;
    if (!taken.has(collisionKey(candidate))) {
      taken.add(collisionKey(candidate));
      return candidate;
    }
  }
}

/**
 * 겹침을 판정할 때 쓰는 열쇠 — 글자가 **같아 보이면** 같은 것으로 친다.
 *
 * 바이트가 같은지로만 보면 이 함수가 막으려던 덮어쓰기가 그대로 일어난다. 압축을 푸는 쪽의
 * 파일 시스템은 대체로 대소문자를 안 가리고(Windows·기본 macOS), 한글은 같은 글자를 두 가지
 * 방식(NFC·NFD)으로 적을 수 있어 **바이트가 다른데 같은 자리에 떨어진다.** 팀 이름은 학생이
 * 정하므로 `Alpha`/`alpha`나 NFC/NFD 짝은 만들려면 만들 수 있고, 그때 한 팀의 제출물이
 * 조용히 사라진다.
 *
 * ⚠ 열쇠만 접는다 — **실제 경로는 접지 않는다.** 교직원이 보는 이름은 학생이 적은 그대로여야 한다.
 */
function collisionKey(path: string): string {
  return path.normalize('NFC').toLowerCase();
}
