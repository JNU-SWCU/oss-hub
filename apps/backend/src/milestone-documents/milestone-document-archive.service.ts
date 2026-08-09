import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import { DomainException } from '../common/error-code';
import {
  SUBMISSION_FILE_STORAGE,
  type SubmissionFileStoragePort,
} from '../submissions/submission-file-storage.port';
import {
  buildMilestoneDocumentArchivePlan,
  MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME,
  type MilestoneDocumentArchiveGrouping,
  type MilestoneDocumentArchiveLayout,
} from './domain/milestone-document-archive';
import { milestoneDocumentArchiveManifestCsv } from './domain/milestone-document-archive-manifest-csv';
import { milestoneDocumentArchiveFolderName } from './milestone-document-download-file-name';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.enum';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';

/**
 * 한 번에 흘려 보낼 수 있는 최대 크기. 제출 파일 한 건은 5MB로 막혀 있지만 (팀 수 × 서류 수)는
 * 막혀 있지 않아, 상한이 없으면 마일스톤 하나가 서버 대역과 교직원의 인내를 통째로 가져간다.
 * 2GiB는 「팀 100 × 서류 4 × 5MB」를 넉넉히 넘겨 잡은 값이라 정상 사용에서는 닿지 않는다.
 */
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * `@types/yazl`의 `end` 선언이 런타임보다 낡았다 — 실제 구현(`index.js`의
 * `calculatedTotalSizeCallback`)은 콜백에 **최종 크기**를 넘기는데 타입에는 인자가 없다.
 * 좁힌 선언을 여기 한 곳에만 두고, 왜 단언이 필요한지도 여기서만 설명한다.
 */
interface ZipFileFinalSize {
  end(
    options: { forceZip64Format: boolean; comment: string },
    onFinalSize: (finalSize: number) => void,
  ): void;
}

/**
 * 무엇을 담을 것인가.
 *
 * `ALL` 은 마일스톤 전체이고 `groupBy` 로 폴더를 뒤집는다. `DOCUMENT` 는 **서류 한 종류만**
 * 전 팀 것으로 좁힌 것이다 — 「사업계획서만 모아 심사위원에게」가 실제 동선인데, 좁히는 길이
 * 없으면 교직원이 47팀을 한 칸씩 눌러야 한다. 좁힌 ZIP 은 폴더 없이 평평하다(`FLAT`).
 */
export type MilestoneDocumentArchiveScope =
  | { readonly kind: 'ALL'; readonly grouping: MilestoneDocumentArchiveGrouping }
  | { readonly kind: 'DOCUMENT'; readonly documentId: string };

export interface MilestoneDocumentArchive {
  readonly body: Readable;
  readonly fileName: string;
  readonly contentType: 'application/zip';
  /**
   * 압축을 **시작하기 전에** 확정한 정확한 바이트 수. 셀 수 없으면 `null`이고 청크 전송이 된다.
   *
   * 이 값을 굳이 구하는 이유: 흘려 보내는 중에 스토리지가 끊기면 이미 200과 헤더가 나간 뒤라
   * 오류 응답으로 바꿀 수 없다. 길이를 미리 알려 두면 **브라우저가 잘린 내려받기를 실패로
   * 판정한다** — 그 값이 없으면 교직원은 반쯤 받다 만 ZIP을 성공한 것으로 안다.
   */
  readonly contentLength: number | null;
}

/**
 * 교직원 서류 **일괄 내려받기(ZIP)**. 무엇을 담고 어디에 놓을지는 도메인
 * (`domain/milestone-document-archive.ts`)이 정하고, 여기서는 **흘려 보내기만** 한다.
 *
 * 압축은 `yazl`을 쓴다. 직접 짜면 의존성은 안 늘지만 한글 파일명을 위한 UTF-8 플래그
 * (general purpose bit 11)를 손으로 다뤄야 하고, 그것을 빠뜨리면 macOS에서는 멀쩡하고
 * **Windows 탐색기에서만** 이름이 깨진다 — 받는 사람 대부분이 Windows다.
 *
 * ⚠ 모든 항목이 `compress: false`다. 제출 파일은 이미 압축된 형식(pdf·hwp·jpg·png·zip)이라
 * 다시 압축해도 거의 줄지 않고, 무압축이라야 **최종 크기를 미리 셀 수 있다**(`contentLength`).
 */
@Injectable()
export class MilestoneDocumentArchiveService {
  constructor(
    private readonly repository: MilestoneDocumentsRepository,
    @Inject(SUBMISSION_FILE_STORAGE)
    private readonly storage: SubmissionFileStoragePort,
  ) {}

  async archiveForStaff(
    milestoneId: string,
    scope: MilestoneDocumentArchiveScope,
    now: Date = new Date(),
  ): Promise<MilestoneDocumentArchive> {
    const milestone = await this.repository.findMilestone(milestoneId);
    if (milestone === null) {
      throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
    }

    const [allDocuments, teams] = await Promise.all([
      this.repository.findByMilestoneId(milestoneId),
      this.repository.findApprovedApplicationsForCollection(
        milestone.programId,
      ),
    ]);

    /*
     * 좁히기는 **이 마일스톤이 요구하는 서류 목록 안에서만** 한다. 경로로 남의 마일스톤 서류
     * id 를 넣어도 여기서 못 찾아 404 로 끝난다 — 조용히 빈 ZIP 을 주면 교직원은 「아무도 안
     * 냈구나」로 읽는다. 없는 것과 안 낸 것은 다른 사실이다.
     */
    const documents =
      scope.kind === 'DOCUMENT'
        ? allDocuments.filter((document) => document.id === scope.documentId)
        : allDocuments;
    if (scope.kind === 'DOCUMENT' && documents.length === 0) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }

    const submissions = await this.repository.findSubmissionsForArchive(
      documents.map((document) => document.id),
      now,
    );

    const plan = buildMilestoneDocumentArchivePlan({
      documents,
      teams,
      submissions,
      layout: layoutOf(scope),
    });
    // 파일과 글 본문을 **함께** 센다 — 파일만 세면 글로만 이루어진 마일스톤은 상한이 없다.
    if (plan.storedBytes + plan.inlineBytes > MAX_ARCHIVE_BYTES) {
      throw this.error(MilestoneDocumentsErrorCode.ARCHIVE_TOO_LARGE);
    }

    const zip = new ZipFile();
    // yazl의 `outputStream`은 실제로 PassThrough지만 타입은 `NodeJS.ReadableStream`이라
    // `destroyed`·`destroy`가 없다. 한 번만 좁혀 두고 아래에서 이것만 쓴다.
    const output = zip.outputStream as Readable;
    /*
     * ⚠ **이 핸들러가 없으면 프로세스가 죽는다.** yazl은 파일을 여는 데 실패하면 자기 자신에
     * `error`를 emit하는데(EventEmitter), 듣는 사람이 없는 `error`는 Node에서 throw다.
     * 게다가 yazl은 그때 출력 스트림을 끝내지 않으므로, 여기서 끊어 주지 않으면 교직원의
     * 내려받기는 **영원히 끝나지 않는다**.
     */
    zip.on('error', (error: unknown) => {
      output.destroy(error instanceof Error ? error : new Error(String(error)));
    });
    /*
     * 출력 스트림에도 듣는 사람을 하나 세워 둔다. 스트림의 `error`도 듣는 사람이 없으면
     * Node에서 throw이고, 여기서 오류가 나는 시점은 **응답이 이 스트림을 받아 가기 전**일 수
     * 있다 — DB에 적힌 크기와 스토리지의 실제 객체 크기가 다르면 yazl이 바로 그 자리에서
     * 오류를 낸다(파일이 밖에서 바뀌면 실제로 일어난다).
     *
     * 여기서 삼키는 것이 아니다: 스트림은 이미 오류 상태로 파괴돼 있어서, 나중에 읽으러 오는
     * 쪽은 첫 읽기에서 같은 오류를 그대로 받는다. 이 줄은 「아무도 없는 사이에 난 오류가
     * 프로세스를 죽이는 것」만 막는다.
     */
    output.on('error', () => undefined);

    /*
     * 지금 스토리지에서 읽고 있는 파일. 출력이 끊기면(교직원이 취소하거나 연결이 죽으면)
     * 이것도 함께 끊어야 한다 — 안 끊으면 아무도 받지 않는 응답을 스토리지에서 끝까지 끌어와
     * 연결과 대역을 붙들고 있는다.
     */
    let activeBody: Readable | null = null;
    output.once('close', () => {
      activeBody?.destroy();
      activeBody = null;
    });

    /*
     * 현황표를 **맨 앞에** 넣는다. 압축을 푸는 프로그램 대부분이 넣은 순서대로 보여 주므로,
     * 뒤에 두면 팀 폴더 수십 개 밑으로 밀려 「누가 안 냈는가」가 눈에 안 띈다.
     */
    zip.addBuffer(
      Buffer.from(
        milestoneDocumentArchiveManifestCsv({
          documents,
          rows: plan.manifest,
        }),
        'utf8',
      ),
      MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME,
      { mtime: now, compress: false },
    );

    for (const entry of plan.entries) {
      if (entry.kind === 'INLINE_TEXT') {
        zip.addBuffer(Buffer.from(entry.body, 'utf8'), entry.path, {
          mtime: entry.modifiedAt,
          compress: false,
        });
        continue;
      }
      /*
       * `addReadStream`이 아니라 **Lazy**를 쓴다. 먼저 열어 두면 파일 수만큼의 스토리지 연결이
       * 한꺼번에 서고, 뒤쪽 것들은 자기 차례가 올 때까지 한 바이트도 읽지 않은 채 기다리다
       * 끊긴다. Lazy는 yazl이 그 항목을 쓸 차례가 됐을 때 비로소 부르므로 **연결이 언제나 하나**다.
       */
      zip.addReadStreamLazy(
        entry.path,
        { mtime: entry.modifiedAt, size: entry.sizeBytes, compress: false },
        (openStream) => {
          /*
           * 교직원이 내려받기를 취소하면 컨트롤러가 이 출력 스트림을 끊는다. 그때도 남은
           * 파일을 계속 스토리지에서 끌어오면 아무도 받지 않는 바이트를 끝까지 나른다 —
           * 취소가 취소로 동작하지 않는다.
           */
          if (output.destroyed) {
            openStream(new Error('archive stream closed'), undefined as never);
            return;
          }
          this.storage.get(entry.storageKey).then(
            (body) => {
              /*
               * ⚠ **여기서 한 번 더 본다.** 위의 검사는 `get()`을 *부르기 전*의 상태이고, 그
               * 사이에 교직원이 취소했으면 출력의 `close`는 **붙들고 있는 스트림이 없는 채로**
               * 이미 지나갔다. 그때 도착한 이 스트림을 그대로 yazl에 넘기면 닫힌 압축으로 들어가
               * 아무도 안 끊는다 — 느린 스토리지 + 성급한 취소가 반복되면 연결 풀이 마른다.
               */
              if (output.destroyed) {
                body.destroy();
                openStream(
                  new Error('archive stream closed'),
                  undefined as never,
                );
                return;
              }
              /*
               * ⚠ **여는 데 성공한 것과 끝까지 읽는 데 성공한 것은 다르다.** S3 연결이 읽는
               * 중에 끊기면 이 스트림이 `error`를 내는데, yazl은 `pipe`로만 이어 붙이므로
               * 그 오류를 **자기 것으로 옮기지 않는다**(`zip.on('error')`가 아예 안 불린다).
               * 여기서 잡지 않으면 듣는 사람 없는 `error`가 되어 프로세스가 죽거나, 더 흔하게는
               * **압축이 영원히 끝나지 않아** 교직원의 내려받기가 멈춘 채로 남는다.
               * (실측으로 후자를 확인했다 — 20초 넘게 아무것도 끝나지 않았다.)
               */
              body.once('error', (error: unknown) => {
                output.destroy(
                  error instanceof Error ? error : new Error(String(error)),
                );
              });
              activeBody = body;
              body.once('close', () => {
                if (activeBody === body) activeBody = null;
              });
              openStream(null, body);
            },
            (error: unknown) => openStream(error, undefined as never),
          );
        },
      );
    }

    /*
     * `end()`는 「더 넣을 것이 없다」는 선언이고, 그 자리에서 최종 크기를 되돌려 준다 —
     * 항목의 크기를 전부 알고 무압축일 때만 셀 수 있어서(모르면 부르지 않는다) 위의
     * `compress: false`와 한 벌이다. 아직 아무 파일도 열지 않은 시점이라 헤더를 먼저 확정할 수 있다.
     */
    let contentLength: number | null = null;
    (zip as unknown as ZipFileFinalSize).end(
      {
        forceZip64Format: needsZip64Eocd([
          MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME,
          ...plan.entries.map((entry) => entry.path),
        ]),
        comment: '',
      },
      (finalSize) => {
        contentLength = finalSize;
      },
    );

    return {
      body: output,
      fileName: archiveFileName(
        // 서류 하나만 받을 때는 그 서류 이름을 단다 — 「1차 중간 산출물」이라는 같은 이름이
        // 폴더에 여러 벌 쌓이면 어느 것이 무엇인지 알 수 없다.
        scope.kind === 'DOCUMENT'
          ? (documents[0]?.name ?? milestone.name)
          : milestone.name,
        milestone.dueAt,
      ),
      contentType: 'application/zip',
      contentLength,
    };
  }

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}

/** 좁힌 ZIP 은 폴더가 뜻이 없어 평평하게 놓는다. 자세한 근거는 `…ArchiveLayout` 주석에 있다. */
function layoutOf(
  scope: MilestoneDocumentArchiveScope,
): MilestoneDocumentArchiveLayout {
  return scope.kind === 'DOCUMENT' ? 'FLAT' : scope.grouping;
}

/**
 * ZIP 꼬리표(end of central directory)를 zip64 형식으로 **강제해야 하는가**.
 *
 * ⚠ 이건 우리 취향이 아니라 **yazl 3.3.1의 버그를 비켜 가는 장치**다. 크기를 미리 셀 때는
 * 중앙 디렉터리가 64KiB(`0xffff`)만 넘으면 zip64 꼬리표(76바이트)를 더하는데, 실제로 쓸 때는
 * 4GiB(`0xffffffff`)를 넘어야 더한다. 두 조건이 갈리는 구간에서는 **미리 말한 길이가 실제보다
 * 정확히 76바이트 크고**, 그러면 `Content-Length`를 채우지 못한 응답이 되어 브라우저가
 * **매번 「다운로드 실패」로 버린다.** 본문은 멀쩡한 ZIP인데 영영 못 받는다.
 *
 * 한글 경로는 한 항목이 64바이트 안팎이라 그 구간이 멀지 않다 — 팀 100여 개 × 서류 4장이면
 * 닿는다. 즉 **정상 규모에서 터진다.**
 *
 * 강제해 두면 예측·기록 두 갈래가 같은 길을 타 어긋날 수 없다. 작은 ZIP은 지금처럼 옛 형식
 * 그대로 두어(임계 아래에서는 두 갈래가 이미 일치한다) 이미 확인한 동작을 바꾸지 않는다.
 *
 * 중앙 디렉터리 한 항목의 크기 = 고정 46 + 경로 UTF-8 바이트 + Info-ZIP 시각 확장 9
 * (파일 주석은 안 쓰고, 항목이 zip64가 되는 4GiB 파일은 크기 상한이 먼저 막는다).
 */
function needsZip64Eocd(paths: readonly string[]): boolean {
  const centralDirectoryBytes = paths.reduce(
    (total, path) => total + 46 + Buffer.byteLength(path, 'utf8') + 9,
    0,
  );
  return centralDirectoryBytes >= 0xffff;
}

/**
 * `1차중간산출물_2026-08-20.zip` — 담은 것의 이름과 **마감일**을 붙인다.
 * 전체를 받으면 마일스톤 이름, 서류 하나만 받으면 그 서류 이름이 앞에 온다.
 *
 * 내려받은 날이 아니라 마감일인 이유: 같은 마일스톤을 마감 전후로 여러 번 받는 것이 정상
 * 동선이고, 그때 이름이 매번 달라지면 폴더에 같은 것이 여러 벌 쌓여 어느 것이 무엇인지
 * 알 수 없다. 이름 치환 규칙은 안에 담기는 파일과 같은 것을 쓴다.
 */
function archiveFileName(name: string, dueAt: Date): string {
  const due = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dueAt);
  return `${milestoneDocumentArchiveFolderName(name)}_${due}.zip`;
}
