# ADR-003: 백엔드 모듈 구조와 네이밍·DTO 컨벤션

## Context

백엔드는 10개 Nest 모듈로 나누고, [Nest 기본 구조](https://docs.nestjs.com/modules)를 따릅니다. 강제할 수 있는 규칙만 둡니다.

## Decision

### 모듈 맵

| 모듈 | 범위 |
| --- | --- |
| `auth` | 인증, 로그인 이력 |
| `users` | 사용자, 온보딩, 역할 요청, 동의 |
| `programs` | 프로그램과 공개 조회, 게시판, 팀 초대, 지원, 제출, 제출 리뷰, 마일스톤 문서 |
| `ranking` | 랭킹 |
| `student` | 학생 대시보드, 내 저장소 조회 |
| `staff` | 스태프 대시보드, 인사이트, 스태프 메뉴 조회 |
| `admin` | 관리자 사용자 관리, 감사 로그 조회, 시스템 상태, 수집 관리 |
| `notifications` | 알림 |
| `github` | 수집, 저장소 |
| `platform` | Prisma, 런타임 설정, 스토리지, 헬스체크, 공통, 감사 로그 쓰기 |

### 폴더와 파일

- 폴더 하나가 Nest 모듈 하나이고, 깊이는 1입니다. 하위 폴더는 `dto/`만 둡니다.
- 모듈의 공개 API는 `exports`에 올린 provider뿐입니다.
- 파일 이름은 kebab-case입니다. 리소스는 복수형, 개념은 단수형입니다.
- 클래스 이름은 PascalCase(stem) + 접미사입니다. 접미사와 예외 파일은 아래 계약 블록이 정합니다.
- `*.repository.ts`는 데이터 접근만 두고 클래스와 타입만 export합니다. 상수와 repository가 함께 쓰는 순수 함수는 `.config.ts`에 둡니다.
- 타입은 그것을 만드는 코드 옆에 둡니다. `.types.ts`는 여러 모듈이 공유하는 타입에만 씁니다.

### DTO

- Request DTO는 필드와 class-validator 데코레이터만 둡니다. 상속은 Create와 Update가 validator까지 같을 때만 씁니다.
- Response DTO는 `declare readonly` 필드와, 기존 JSON 키 순서대로 객체 리터럴을 돌려주는 `static from()`을 둡니다. 계산된 값은 서비스가 만들어 `from()`에 넘깁니다.
- 값이 없을 때는 null 대신 명시적인 상태 필드를 둡니다.

```ts
export class ProgramSummaryResponseDto {
  declare readonly id: string;
  static from(p: Program) { return { id: p.id }; }
}
```

### 배치

- 읽기 엔드포인트는 그것을 부르는 메뉴 중 가장 낮은 권한의 오디언스 모듈(`student`, `staff`, `admin`)에 둡니다. 쓰기는 데이터를 소유한 모듈에 남깁니다.
- 쓰기 repository를 aggregate당 하나로 모으는 것이 앞으로의 방향입니다.
- frontend와 backend는 서로의 경로를 참조하지 않습니다.

### 없앤 규칙

- 파일 크기 규칙: 작은 파일을 흡수하지 않습니다. 파일 하나에 개념 하나를 둡니다([Angular 스타일 가이드](https://angular.dev/style-guide)).
- type 전용 파일 분리: 위 `.types.ts` 규칙으로 대체합니다.
- `.scheduler`, `.job`, `.policy` 역할: `@Cron`/`@Interval`은 모듈 서비스의 메서드에 둡니다([task scheduling](https://docs.nestjs.com/techniques/task-scheduling)). CLI는 `src/cli.ts` 하나에서 `createApplicationContext`로 실행합니다([standalone applications](https://docs.nestjs.com/standalone-applications)). 도메인 규칙 함수는 서비스에 둡니다.

## Consequences

아래 계약 블록의 `rules`가 위 규칙을 린트 오류로 강제합니다. 중첩 컨텍스트, vertical slice, `@Expose` 직렬화, mapped-types, nestjs-zod, nestia는 채택하지 않았습니다.

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
  "outOfScopeFiles": [
    "src/main.ts",
    "src/cli.ts",
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
  ]
}
```
