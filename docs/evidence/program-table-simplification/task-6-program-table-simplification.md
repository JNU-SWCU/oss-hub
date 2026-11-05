# Todo 6 File 전환 검증

기준 main: `1d8e9259ff4afc95cd4fc97a401f639dd3de16de`.
첫 릴리스는 File 생성·복사·대조·코드 전환이다. 옛 테이블 삭제와
kind × lifecycle CHECK는 다음 릴리스의 draft PR에 둔다.

## 바뀌는 저장과 유지하는 경계

- 업로드 토큰·양식·자체 커버·제출 파일·삭제 툼스톤은 File을 사용한다.
  storageKey는 유니크하며 소모한 업로드는 같은 행에서 TEMPLATE 또는 COVER로 전환한다.
- 외부 커버는 Program의 URL 컬럼이다. 스토리지 소유권이나 File 행을 만들지 않는다.
- 삭제 큐는 임대, CAS, 실패 횟수, 다음 시각을 한 워커에서 처리한다.
  프로그램 삭제 스냅샷 뒤에 연결된 커버·양식도 DELETED 소유자를 보고 회수한다.
- 스토리지 삭제 실패만 삭제 재시도 횟수에 반영한다. 삭제 완료를 DB에 기록하지
  못한 오류는 호출자에게 전달하며 스토리지 실패로 바꾸지 않는다.
- 기존 HTTP 경로, 권한, 업로드 제한과 응답 필드를 유지한다.
  프로그램 삭제 완료 건수는 중복 메타데이터 행 대신 File의 실제 정리 대상을 센다.
  프론트의 기존 결과 안내가 이 응답을 소비한다.
- `deploy/jenkins/smoke-release.sh`가 사용하는
  `/api/v1/milestone-document-files` 경로도 유지한다.

## 선택 실행과 실패 수정

전체 로컬 스위트는 실행하지 않았다. 변경 영역을 선택 실행하고 실패한 파일만
다시 실행했다. 아래 실행은 서로 겹치는 케이스가 있으므로 합계로 제시하지 않는다.

| 경계 | 선택 실행 결과 |
| --- | --- |
| 파일 변경 관련 단위 | 47 파일, 550 케이스에서 발견한 6개 실패를 수정하고 해당 파일 재실행 |
| 메타데이터 변환 소비자 | 17 파일, 356 케이스. 옛 Prisma mock 형태의 실패를 수정하고 두 파일 재실행 |
| 마지막 저장소 재실행 | `milestone-documents.repository.spec.ts` 80 케이스 통과 |
| 인증 인벤토리·컨트롤러·업로드 모듈 | 8 파일, 185 케이스 통과 |
| 실제 업로드·현재 파일 접근 권한 | 2 파일, 45 케이스 통과 |
| 팀 삭제·외부 커버 | 2 파일, 35 케이스 통과 |
| 늦은 첨부·생명주기·고아 대조·시드 | 4 파일의 34 케이스 통과. 시드 cleanup FK 실패는 별도 18 케이스 재실행으로 수정 확인 |

시드 cleanup은 기존의 제출 파일 보호 조건에 TEMPLATE까지 섞어 마일스톤을
남겼다. SUBMISSION 종류로 범위를 바로잡았고 cleanup 실패 시에도 연결을 해제한다.
제출 소유권, 이력 연결, 마감·동시성, 트랜잭션, 스토리지 키 비노출 검증은 유지했다.

## Mutation

`FileCleanupRepository.claimNextForDeletion`의 DELETED 프로그램 소유자 분기
세 곳을 일시적으로 무효화했다. 실제 DB의 늦은 커버·양식 테스트 두 개가
각각 객체가 남아 있다는 이유로 실패했다.

```text
Test Suites: 1 failed, 1 total
Tests:       2 failed, 2 total
Expected: false
Received: true
MUTATION_TEST_EXIT=1
```

원본 바이트를 복원한 뒤 같은 두 테스트가 통과했다. 복원한 저장소 파일의
SHA-256은 `f1e6f421d39e2c37cb57771816b2c04cbbb43976925c14d6fed0e8541b0b0233`이다.
mutant는 커밋하지 않는다.

재현 명령:

```sh
BACKEND_INTEGRATION_TEST_PATTERN='file-late-attachment\.integration\.spec\.ts$' \
  bash apps/backend/test/run-integration.sh
```

## 정적 검사

공유 Prisma Client는 heavy lock 안에서 이 worktree의 스키마로 생성하고,
생성 결과를 사용하는 검사까지 같은 lock을 유지했다.

```text
TYPECHECK_EXIT=0
LINT_EXIT=0
FORMAT_EXIT=0
FILE_LEDGER_OK 271 paths
LEDGER_EXIT=0
FINAL_STATIC_EXIT=0
```

`pnpm lint:structure`도 종료 코드 0이다. 의존성 자동 설치를 막기 위해
`pnpm --config.verify-deps-before-run=false`를 사용했다.

빈 격리 DB에 전체 마이그레이션을 적용한 뒤 선택 통합 테스트를 실행했다.
예상한 테스트 수와 종료 코드를 함께 확인했으며, 실패를 무시하는 재시도나
테스트 skip은 추가하지 않았다. 실패 파일은 원인을 수정한 뒤 재실행했다.

## 운영 데이터와 남은 게이트

현재 SQL로 수행한 서버 내부 복사·삭제·백업 복원 대조와 정리 영수증은
[서버 리허설](task-6-server-rehearsal.md)에 있다.
파일별 삭제·병합 상태와 208 → 194개 제품 파일 수는
[파일 원장](file-ledger.md)에 기록했다.

성능은 소유자의 최종 지시에 따라 PR별 검증 대상에서 제외했다.
전체 단위·통합 스위트와 위험 변경의 독립 게이트는 CI·오케스트레이터의
머지 조건이다. 이 작업은 머지·배포·릴리스를 수행하지 않는다.
