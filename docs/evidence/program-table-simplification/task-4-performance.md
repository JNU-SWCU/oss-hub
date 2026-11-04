# Todo 4 준비 백엔드 조회 성능 검증

## 측정 시점과 현재 적용 범위

이 수치는 이전 준비 구현의 측정이다. base는 baed7d753이며 후보 파일 8개의
SHA-256이 준비 커밋 2e0e3e492와 일치한다. 현재 HEAD를 새로 측정한 결과가 아니다.
이후 게이트 수정은 심사 쓰기의 호환 기록과 트랜잭션 잠금 경로를 보완했다.
현재 overview의 DELETED 필터는 main과 후보가 공통으로 갖는다. 아래 과거
숫자가 이 병합된 필터의 비용까지 직접 측정했다고 해석하지 않는다.
이번 수정에서는 요청대로 성능 측정을 재실행하지 않았다.

## 당시 측정의 판정

동일 DB에서 순서를 번갈아 실행한 최종 비교의 네 경로 모두 중앙값 회귀가
10% 이내였다. 수합 조회는 SQL 19회에서 18회로 줄었다. 이 결과를 HTTP나
브라우저 렌더링 속도 개선으로 확대하지 않는다.

| 경로 | base 중앙값 ms | 후보 중앙값 ms | 변화 | base IQR ms | 후보 IQR ms | base p95 ms | 후보 p95 ms |
| --- | ---: | ---: | ---: | --- | --- | ---: | ---: |
| 프로그램 개요 | 2.155 | 2.161 | +0.26% | 1.864–2.628 | 1.858–2.922 | 4.635 | 5.003 |
| 제출 현황 | 9.788 | 9.429 | -3.67% | 8.773–11.896 | 8.687–10.683 | 16.520 | 16.578 |
| 서류 수합 | 19.656 | 18.255 | -7.13% | 14.027–27.193 | 13.220–28.024 | 37.667 | 36.244 |
| 교직원 팀 상세 | 9.861 | 9.969 | +1.09% | 9.114–11.106 | 9.168–11.626 | 19.643 | 21.048 |

각 경로·버전별 워밍업 5회, 측정 100회다. IQR은 p25–p75이고 분위수는
정렬한 표본의 선형 보간으로 계산했다. 최종 비교의 표본 수와 교차 순서는
결과를 보기 전에 고정했고, 성공한 최종 비교는 한 번 실행했다.

## 앞선 +87.8% 관측을 조사한 과정

기존에 기록된 기준선과 첫 후보 실행을 비교했을 때, 수정하지 않은 개요와
팀 상세까지 크게 느려졌다. 이어 같은 호스트에서 base 전체를 실행한 뒤
후보 전체를 실행했을 때 수합 중앙값은 16.827 → 31.607 ms(+87.8%)였다.
개요 +21.0%, 팀 상세 +12.5%, 제출 현황 -16.8%도 함께 관측했다.
이 실행을 버리거나 통과로 바꾸지 않았다.

다음 진단에서는 Prisma query 이벤트의 개별 DB 실행 시간을 수집했다.
수합의 워밍업 포함 21회에서 base는 399 SQL 이벤트, DB 시간 합계 127 ms,
단일 쿼리 최대 8 ms였다. 후보는 378 이벤트, 합계 13 ms, 최대 1 ms였다.
후보에 추가된 고비용 쿼리나 조인은 발견되지 않았다. 별도 심사 테이블에서
revision을 다시 읽던 조회가 사라져 호출은 1회 줄었다. 이 시간은 정수 ms로
양자화된 DB 계측값이므로 작은 차이를 정밀한 개선량으로 해석하지 않는다.

같은 진단의 수합 중앙값은 반대로 21.197 → 15.168 ms였다. 실행 순서와
실행 시점의 영향을 배제하지 못하는 분리 실행으로 회귀 여부를 결정할 수
없다고 판단했다. 인덱스를 추가하거나 유리한 실행을 채택하지 않고 비교
방법을 바꿨다. 앞선 실행의 중앙값·산포·SQL 계측은
`task-4-performance-diagnostics.json`에 모두 남겼다.

## 최종 비교의 통제

- base는 `baed7d753` 소스를 별도 디렉터리에 내보내 자체 Prisma Client와
  backend를 빌드했다. 후보와 같은 TypeScript 검사 문맥에 넣었을 때의
  `legacySubmissionId` 타입 충돌을 오류 무시로 넘기지 않고 별도 빌드로 해결했다.
- 두 버전의 실제 저장소 구현이 **하나의 격리 PostgreSQL DB**를 읽는다.
  결과의 팀 수·항목 수·파일 크기·심사 결과를 같은 assertion으로 검사한다.
- 한 쌍씩 base → 후보, 다음 쌍은 후보 → base 순서로 실행한다.
  공유 heavy lock을 전체 실행 동안 잡고 서버나 별도 무거운 검사를 함께
  실행하지 않았다.
- 데이터는 팀 10개, 제출 40개, 제출 이력 80개, 원본 심사 40개다.
  준비 단계에서 두 읽기 경로를 비교할 수 있도록 같은 심사 사실을 두 구조에
  넣었다. 두 버전이 서로 다른 seed를 읽는 비교가 아니다.
- 최종 표와 원시 표본, SQL 수, 후보 소스의 SHA-256은
  `task-4-performance-interleaved.json`에 있다.

수합 IQR이 넓다는 점은 남는다. 이 측정은 합성 데이터의 준비 단계 비교이며,
운영 트래픽이나 원본 심사 테이블을 삭제한 최종 상태의 성능 보증이 아니다.
최종 통제 비교에서 재현되지 않은 앞선 +87.8%를 실제 코드 회귀로 단정하지
않으며, 특정 인덱스 결함을 고쳤다고 주장하지도 않는다.

## 재현

`submission-axis-interleaved.integration.spec.ts.txt`는 사용한 진단 하네스다.
다음 순서로 임시 복사한 뒤 공식 격리 통합 러너로 실행한다. 공유 heavy lock
아래 한 작업씩 실행하고 종료 후 임시 복사본과 내보낸 base를 제거한다.

```sh
mkdir -p .omo/qa/submission-axis-base
git archive baed7d753 | tar -xf - -C .omo/qa/submission-axis-base
(
  cd .omo/qa/submission-axis-base
  pnpm install --offline --frozen-lockfile --filter backend...
  pnpm --filter backend build
)
cp docs/evidence/program-table-simplification/submission-axis-interleaved.integration.spec.ts.txt \
  apps/backend/prisma/submission-axis-interleaved.integration.spec.ts
BACKEND_INTEGRATION_TEST_PATTERN='submission-axis-interleaved\.integration\.spec\.ts \
  pnpm --filter backend test:integration
```

```text
BASE_BUILD_EXIT=0
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
INTERLEAVED_FINAL_EXIT=0
```
