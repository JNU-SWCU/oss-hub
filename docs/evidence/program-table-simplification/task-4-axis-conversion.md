# Todo 4 항목 중심 제출 전환 릴리스 A

2026-11-05 main 04ed6b30c 위의 전환이다. 코드·데이터 변환 A를 먼저 배포하고 물리 삭제 B는 별도 다음 릴리스로 적용한다. 이 작업은 PR 제출까지이며 merge·배포·Jenkins 실행·운영 DB 쓰기를 수행하지 않았다.

## 사실 보존과 전환

공개 제출 ID 20건은 준비 단계에서 이미 PK로 옮겨졌다. A는 PK를 다시 쓰지 않고 동일성·충돌 0을 검사한다. 기존 파일·revision·시각·판정·코멘트를 유지한다. 기존 LEGACY_MILESTONE_SUBMISSION 항목 8건은 DOCUMENT로 바꾸고 모든 항목의 자체 FILE/TEXT/FILE_OR_TEXT 유형을 사용한다. Milestone.submissionType으로 새 항목을 추정·복제하지 않는다.

SubmissionHistory가 심사의 단일 원본이다. 과거 중복 심사 16건과 정규 이력의 ID·제출·판정·actor·시각·코멘트 및 연결된 제출 revision을 대조한다. 연결 이력이 NULL이고 정규 이력 revision도 NULL이며 현재 상태가 APPROVED인 과거 승인 1건은 추정 없이 보존한다. 누락·2건·다른 상태·불일치는 migration을 중단한다. 완전히 빈 fresh DB만 0건을 허용한다.

revision 미상 심사는 현재 제출본 review에 넣지 않고 unversionedReviews로 별도 응답·표시한다. 최신 심사 ID는 최신 제출본 연결 여부와 독립적으로 반환하므로 새 심사의 동시성 토큰이 유실되지 않는다. 새 심사는 요청한 현재 revision을 기록한다. 과거 예외는 새 쓰기에 허용하지 않는다.

## API와 파일 경계

항목 제출·파일·심사·이력 API와 공개 제출 ID review-context 조회를 유지한다. 프론트는 응답의 requirementId로 심사를 요청한다. 유형으로 옛 API를 추측하거나 항목 목록을 추가 조회하지 않는다. 항목 없는 마일스톤 제출·재제출·심사·양식·체크리스트·일반 업로드의 옛 API는 404로 종료한다. 삭제 프로그램은 review-context도 404다.

삭제된 옛 API 테스트는 항목 API의 기존 파일·재제출·심사 테스트 및 retired route 404 회귀로 대체한다. 중복 ReviewHistory fixture를 정규 심사 event로 옮긴 뒤 동일 ID를 두 번 넣던 fixture를 제거했다. 기본 목록에서 이관 항목을 숨기거나 옛 milestone 이름으로 표시하던 기대값은 항목의 실제 이름과 단일 목록 계약으로 바꿨다. purge의 정규 이력 수는 제출 event와 심사 event 모두 포함한다. 테스트를 skip하거나 오류를 억제하지 않았다.

A의 DB에는 옛 물리 테이블이 남으므로 팀 삭제와 시드의 FK 정리 SQL만 남긴다. B에서 테이블과 함께 제거한다. 기존 쓰기 bridge trigger는 A에서 제거하고 kind=DOCUMENT check로 옛 앱이 숨은 레거시 항목을 다시 만드는 것을 차단한다. 교체 중 오류 수분은 승인된 전제이며 old/new 이중 쓰기나 이전 이미지 호환성을 추가하지 않는다. 복구는 변환 직전 백업 복원이다.

## 운영 복제 리허설

head 20261105030000 뒤에 A 20261105040000이 정렬된다. Todo 9는 20261105100000 이상으로 뒤에 정렬한다. 실제 운영 덤프를 서버 내부의 별도 PostgreSQL에 복원하고 공식 rehearse.sh, convert.json으로 사전 검사·변환 전 백업·A 적용·대조·백업 재복원을 실행했다.

| 백업 대상 | 변환 전 | 백업 복원 |
| --- | ---: | ---: |
| 제출 | 55 | 55 |
| 정규 이력 | 94 | 94 |
| 중복 심사 | 16 | 16 |
| 파일 | 81 | 81 |
| 항목 | 25 | 25 |
| revision 미상 승인 | 1 | 1 |

CHECK_OK check-before.sql, CHECK_OK check-conversion.sql, REHEARSAL_OK stages=1 counts=6, CONVERT_REHEARSAL_EXIT=0. 별도 리허설에서는 A→B 적용과 B 직전 백업 복원도 성공했다. 표는 백업 복원 대조이며 운영에 migration을 적용했다는 뜻이 아니다.

운영과 같은 PostgreSQL 이미지를 network none·공개 포트 0·운영 볼륨 연결 0·CPU 0.5·메모리와 memory+swap 각 512 MiB·384 MiB tmpfs·nice 19로 실행했다. 데이터는 서버 밖으로 옮기지 않았다. 컨테이너·덤프·작업디렉터리는 종료 처리와 별도 SSH 연결에서 잔존 0, 익명 볼륨 생성 0을 확인했다.

첫 리허설은 count 식별자에 underscore를 사용해 manifest 검증에서 중단했다. 식별자를 historical-unknown-revision으로 보정한 뒤 공식 전체 리허설을 통과했다. 실패 실행도 동일한 정리 절차에서 잔존 0이었다.

