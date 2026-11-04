# Todo 8 A: 백엔드 선행 배포

PR #1723의 첫 게이트는 배포 시차 때문에 거절됐다. Vercel은 release publish로 실행되고 Jenkins의 백엔드 교체를 기다리지 않는다. 새 프론트가 먼저 배포되면 구 백엔드가 혼자 지원하는 요청을 APP_019로 거부하는데, 새 프론트에는 지원 전 초대 경로가 없어 지원이 막힌다.

## 반드시 지킬 순서

1. A의 백엔드 변경과 테스트만 먼저 배포한다. 프론트 소스·가이드·Prisma schema·마이그레이션은 바꾸지 않는다.
2. Jenkins가 실제 서빙 중인 백엔드를 A 포함 버전으로 교체했고 정상 상태임을 확인한다. PR 병합이나 release publish만으로 이 조건을 충족했다고 보지 않는다.
3. 그 뒤에만 A 위에 쌓인 B의 draft를 해제하고 프론트를 배포한다. B는 지원 후 초대와 교직원 최소 인원 거부 안내, 가이드·캡처를 포함한다.

스키마 이력 전환과 물리 DROP 단계는 시작하지 않았다. 임시 트리거·capability fallback·새 env를 만들지 않는다.

## 구 프론트 호환

기존 프론트가 만드는 준비팀, 초대 수락, 최종 지원 요청 계약은 유지한다. 최종 지원은 준비팀 이름과 수락한 구성원을 같은 트랜잭션에서 Team으로 옮기고 성공한 뒤 준비팀을 제거한다. 계정 자격·최대 인원·팀장·중복 소속·모집 기간 검증을 유지한다.

`application-preparations.integration.spec.ts`는 기존 준비팀의 두 명 지원, 초대와 최종 지원 경합, 자격 변경 거부, 실패 롤백을 실제 PostgreSQL에서 실행한다. 기존 최소 인원 미달 지원 거부 기대는 승인 시점 이동과 충돌하므로, 준비팀 한 명의 지원 성공 테스트와 자격 변경 거부 테스트로 분리했다. 나머지 기존 호환 테스트는 유지했다.

## 승인과 탈퇴 경합

`applications.service.integration.spec.ts`에 실제 `ProgramTeamsRepository.leave`와 `ApplicationsService.decide`를 동시에 실행하는 테스트를 추가했다. 탈퇴 트랜잭션이 Team 잠금을 잡은 상태에서 승인 연결이 PostgreSQL Lock 대기 상태에 들어가는 것을 `pg_stat_activity`와 `pg_blocking_pids`로 확인한다. 탈퇴가 커밋된 뒤 승인은 1명으로 다시 계산해 APP_019로 거부하고 SUBMITTED를 유지하며 승인 이력과 outbox를 만들지 않는다.

동기화는 트랜잭션 callback의 Promise와 실제 DB 잠금 관찰을 사용한다. sleep이나 재시도 통과 옵션은 없다. 승인 쪽 Team 잠금만 잠시 제거하면 새 테스트가 `Approval did not wait for the leaving member transaction`으로 실패한다. 잠금을 원복한 최종 통합 실행은 2 suites / 36 tests passed, `A_INTEGRATION_EXIT=0`이다.

처음 mutation 실행은 fixture의 최소 2명·최대 1명 조합이 DB CHECK에 걸려 실패했다. 최대 인원을 2로 수정한 뒤 위 의도된 mutation red를 확인했다. fixture 실패를 잠금 검증 증거로 세지 않는다. 실제 mutation은 커밋에 포함하지 않는다.

## 범위와 정리

최종 A 로컬 관문은 공유 heavy lock 안에서 순서대로 실행했다. 통합 2 suites / 36 tests, backend 단위 390 suites / 6,333 tests, backend typecheck·lint, lint:structure, format:check, check:file-ledger가 모두 `EXIT=0`이다. 이번 A는 프론트 제품 코드와 가이드를 변경하지 않는다.

실제 운영 데이터 이동·삭제는 각각 0건이다. 데이터 마이그레이션이 없어 서버 내부 복원 리허설은 해당하지 않는다. 기존 읽기 전용 집계의 후속 이관 대상은 수락 20 + 거절 5 = 25건이며 전환 시 다시 집계해야 한다.

통합 실행기는 빈 DB에서 기존 86개 마이그레이션을 적용하고 종료 시 자신이 만든 Docker 프로젝트·볼륨을 제거한다. heavy lock은 획득한 실행만 해제한다. 프론트 후속 PR과 구분하기 위해 A의 공개 diff에는 apps/frontend와 guide 변경을 넣지 않는다.
