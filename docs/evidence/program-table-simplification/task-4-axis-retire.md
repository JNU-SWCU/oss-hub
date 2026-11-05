# Todo 4 다음 릴리스의 물리 삭제

릴리스 A의 코드와 변환 SQL이 배포된 뒤 별도 릴리스에서 적용한다. A와 B를 같은 배포에 넣지 않는다. 이 PR은 draft이며 merge·배포·Jenkins 실행을 수행하지 않았다.

## 삭제 대상과 보존 경계

| 대상 | 삭제 직전 운영 복제 건수 | 처리 |
| --- | ---: | --- |
| MilestoneDocumentReviewHistory | 16행, 8컬럼, outgoing FK 3개, incoming FK 0개 | 정규 이력과 ID·제출·판정·actor·시각·코멘트·revision 대조 후 테이블 삭제 |
| Milestone.submissionType | nonnull 8 | 동일 유형의 제출 항목 존재 대조 후 컬럼 삭제 |
| MilestoneDocument.kind | 25행 전부 DOCUMENT | A의 전환 check 확인 후 컬럼 삭제 |
| MilestoneDocumentSubmission.legacySubmissionId | nonnull 20 | 이미 공개 ID와 PK가 동일함을 확인 후 컬럼 삭제 |

submissionHistoryId FK를 명시적으로 먼저 제거한다. DROP TABLE은 CASCADE를 쓰지 않는다. 나머지 outgoing FK 2개는 테이블과 함께 제거된다. kind 컬럼에 종속된 A의 check constraint도 컬럼 삭제로 제거된다. 정규 제출 55·이력 94·파일 81·항목 25는 보존한다. revision 미상 승인 1건의 사실·시각·NULL revision·APPROVED 상태는 추정 없이 보존한다. 새 심사는 제출 revision을 기록하며 이 과거 예외를 새 쓰기에 적용하지 않는다.

## 서버 내부 복원 리허설

2026-11-05 head 20261105030000 운영 DB를 읽기 전용으로 덤프했다. 같은 서버의 별도 PostgreSQL에만 복원했다. 데이터는 서버 밖으로 옮기지 않았다. 공식 rehearse.sh와 retire-rehearsal.json으로 A040000 적용·대조, B 직전 백업, B050000 적용·대조, 백업 재복원과 여섯 건수 비교를 수행했다. 이 manifest는 두 릴리스를 모사하는 리허설 전용이며 두 migration을 한 배포에 넣는 지시가 아니다.

| 백업 대상 | B 직전 | 백업 복원 |
| --- | ---: | ---: |
| 제출 | 55 | 55 |
| 정규 이력 | 94 | 94 |
| 중복 심사 | 16 | 16 |
| 파일 | 81 | 81 |
| 항목 | 25 | 25 |
| revision 미상 승인 | 1 | 1 |

REHEARSAL_OK stages=2 counts=6, RETIRE_REHEARSAL_EXIT=0, SERVER_REHEARSAL_EXIT=0. B 후 check-retired.sql 불일치 0을 확인했다. 복원표의 중복 심사 16은 B 직전 백업의 복구 증거이며 B 적용 후에도 남는다는 뜻이 아니다.

network none, 공개 포트 0, 운영 볼륨 연결 0, CPU 0.5, 메모리와 memory+swap 각512 MiB, 384 MiB tmpfs, nice19로 운영과 동일한 이미지에서 실행했다. 종료 후 컨테이너0·덤프와 작업디렉터리0·익명 볼륨 생성0을 확인했고 별도 SSH 연결에서도 INDEPENDENT_CLEANUP_EXIT=0이었다. 원본 데이터와 영구 백업은 이 작업에서 변경하지 않았다.
