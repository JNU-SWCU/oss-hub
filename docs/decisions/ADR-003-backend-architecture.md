# ADR-003: 백엔드 모듈 구조와 네이밍·DTO 컨벤션

## Context

백엔드 `src/`에는 20개가 넘는 폴더가 계층별 하위 폴더(controller, service, repository, domain)로 흩어져 있어서 한 기능을 보려면 여러 곳을 오가야 했습니다. 파일 이름과 DTO 모양도 모듈마다 달랐습니다. 이 ADR은 10개 모듈로 묶는 구조와, 린트로 강제할 수 있는 규칙만 정합니다.

## Decision

### 모듈 맵

| 모듈 | 흡수하는 기존 폴더 |
| --- | --- |
| `auth` | `auth`, `login-history` |
| `users` | `users`, `roles` (onboarding, role-requests), `consents` |
| `programs` | `programs` (`public/*` 포함), `board`, `team-invitations`, `applications`, `submissions`, `submission-reviews`, `milestone-documents` |
| `ranking` | `ranking` |
| `student` | 새 모듈. 학생 대시보드, 내 저장소 조회 |
| `staff` | 새 모듈. 스태프 대시보드, 인사이트, 스태프 메뉴 조회 |
| `admin` | 새 모듈. 관리자 users 컨트롤러, 감사 로그 조회, `system-status`, 수집 관리 |
| `notifications` | `notifications` |
| `github` | `github` (collection, repositories) |
| `platform` | `prisma`, `runtime-config`, `storage`, `health`, `common`, 감사 로그 쓰기 |

### 폴더 규칙

- 모듈 폴더는 깊이 1이고, 하위 폴더는 `dto/`만 둡니다.
- 폴더 하나가 Nest 모듈 하나입니다.
- 모듈의 공개 API는 `exports`에 올린 provider뿐입니다.

### 네이밍

- 파일 이름은 kebab-case. 리소스는 복수형(`programs`), 개념은 단수형(`auth`, `ranking`).
- 루트 파일 접미사는 닫힌 목록 14개: `.module` `.controller` `.service` `.repository` `.guard` `.interceptor` `.filter` `.client` `.job` `.scheduler` `.policy` `.error` `.types` `.config`.
- 클래스 이름은 PascalCase(stem) + 접미사. 예: `program-board.service.ts` -> `ProgramBoardService`.
- DTO 파일은 `dto/*-request.dto.ts`, `dto/*-response.dto.ts`.
- 예외: `src/main.ts`, `src/app.module.ts`, `src/app-controller-discovery.ts`, `test/**/*.ts`, `src/**/*.spec.ts`, `src/**/*.integration.spec.ts`, `src/**/*.spec.helpers.ts`, `src/**/*.test.ts`, `src/**/*fixture.ts`, `src/**/*fixtures.ts`, `src/**/*support.ts`.

### DTO

- Request DTO는 필드와 class-validator 데코레이터만 둡니다.
- Response DTO는 `declare readonly` 필드와, 기존 JSON 키 순서대로 객체 리터럴을 돌려주는 `static from()`을 둡니다. mapped-types는 쓰지 않습니다.
- 값이 없을 때는 null 대신 명시적인 상태 필드를 둡니다. Nest는 null을 빈 200 본문으로 보내기 때문입니다.

```ts
export class ProgramSummaryResponseDto {
  declare readonly id: string;
  static from(p: Program) { return { id: p.id }; }
}
```

### 배치

- 읽기 엔드포인트는 그것을 부르는 메뉴 중 가장 낮은 권한의 오디언스 모듈(`student`, `staff`, `admin`)에 둡니다.
- 쓰기는 데이터를 소유한 모듈에 남깁니다.
- frontend와 backend는 서로의 경로를 참조하지 않습니다.

## Consequences

규칙은 다음 검사로 강제합니다.

| 규칙 id | 검사 |
| --- | --- |
| `conventions/controller-explicit-return` | 컨트롤러 핸들러가 명시적 응답 DTO 타입을 반환 |
| `conventions/response-dto-shape` | Response DTO가 `declare readonly` 필드와 `static from()`만 가짐 |
| `conventions/request-dto-decorated` | Request DTO의 모든 필드에 class-validator 데코레이터 |
| `conventions/file-name-convention` | 파일 이름이 kebab-case와 닫힌 접미사 목록을 따름 |
| `conventions/file-class-match` | 클래스 이름이 파일 stem과 접미사에 맞음 |
| `cross-app/no-cross-app-path` | frontend와 backend 사이 경로 참조 금지 |
| `boundaries/no-unknown-files` | 모듈 맵 밖의 폴더나 파일 금지 |
| `architecture/no-cycle` | 모듈 사이 순환 의존 금지 |

`conventions/controller-explicit-return`의 반환 타입 허용 목록(라우트 이름): `GET programs/:programId/applications/me`, `GET application-preparations/programs/:programId/me`. 지원서나 지원 준비가 없으면 빈 200 본문을 보내며, 상태 필드로 바꾸면 JSON이 달라집니다.

검토 후 채택하지 않은 안: 중첩 컨텍스트, vertical slice, `@Expose` 직렬화, mapped-types, nestjs-zod, nestia.

```json adr-003-contract
{
  "modules": [
    "auth",
    "users",
    "programs",
    "ranking",
    "student",
    "staff",
    "admin",
    "notifications",
    "github",
    "platform"
  ],
  "rootSuffixes": [
    ".module",
    ".controller",
    ".service",
    ".repository",
    ".guard",
    ".interceptor",
    ".filter",
    ".client",
    ".job",
    ".scheduler",
    ".policy",
    ".error",
    ".types",
    ".config"
  ],
  "dtoSuffixes": [
    "-request.dto.ts",
    "-response.dto.ts"
  ],
  "rules": [
    "conventions/controller-explicit-return",
    "conventions/response-dto-shape",
    "conventions/request-dto-decorated",
    "conventions/file-name-convention",
    "conventions/file-class-match",
    "cross-app/no-cross-app-path",
    "boundaries/no-unknown-files",
    "architecture/no-cycle"
  ],
  "exemptFiles": [
    "src/main.ts",
    "src/app.module.ts",
    "src/app-controller-discovery.ts",
    "test/**/*.ts",
    "src/**/*.spec.ts",
    "src/**/*.integration.spec.ts",
    "src/**/*.spec.helpers.ts",
    "src/**/*.test.ts",
    "src/**/*fixture.ts",
    "src/**/*fixtures.ts",
    "src/**/*support.ts"
  ],
  "crossAppExceptions": []
}
```
