# Todo 4 전환 코드의 통제 성능 비교

main 04ed6b30c와 후보 0d3d44556의 실제 repository를 같은 격리 PostgreSQL에서 비교했다. 각 경로·버전별 워밍업 5회와 측정 100회를 고정하고 base→후보, 후보→base 순서로 번갈아 실행했다. heavy lock을 전체 실행 동안 유지했으며 다른 build·QA 서버와 함께 돌리지 않았다. 두 backend와 Prisma client를 별도 생성·빌드했다.

| 경로 | main p50 ms | 후보 p50 ms | 변화 | main SQL | 후보 SQL |
| --- | ---: | ---: | ---: | ---: | ---: |
| program-overview | 3.149 | 2.995 | -4.89% | 3 | 3 |
| submission-matrix | 16.432 | 17.299 | +5.28% | 12 | 13 |
| document-collection | 30.372 | 29.671 | -2.31% | 18 | 18 |
| staff-team-detail | 16.661 | 17.892 | +7.39% | 16 | 16 |

네 경로 모두 중앙값 회귀가 10% 이내다. 제출 현황은 새 정규 항목들의 상태를 조회하므로 SQL이 12→13으로 증가했다. 수합은 직전 main도 이미 정규 심사 이력을 읽으므로 18→18이다. 전체 제품이나 HTTP·브라우저가 더 빨라졌다는 주장은 하지 않는다.

동일 DB의 합성 데이터는 프로그램 1, 사용자 20, 팀 10, 팀원 20, 신청 10, 마일스톤 2, 항목 4, 제출 40, 정규 이력 80, 파일 40, 레포 10이다. base 읽기를 위한 중복 심사 40행도 같은 사실·ID·revision·actor·시각으로 넣었다. 각 실행은 팀·참가자·항목·파일 크기·심사 판정을 검사한다. 새 findCurrentSubmissions는 모든 정규 항목 상태 40건, 옛 구현은 이 fixture에 없는 레거시 슬롯 0건을 반환하며 항목 좌표 40건은 동일하다. 이를 같은 raw 배열을 반환한 것으로 해석하지 않는다.

## 앞선 관측과 진단

보관된 task1 기준선과 이번 후보를 따로 실행했을 때 개요 1.619→7.955 ms, 현황 7.885→22.386 ms, 수합 12.177→16.241 ms, 팀 상세 9.093→11.736 ms였다. 시간대·다른 main 변경·DB 상태를 통제하지 못하는 비교이므로 통과 판정으로 사용하지 않았다. 이 관측을 숨기거나 실제 코드 회귀가 없었다는 증명으로 바꾸지 않는다.

첫 교차 실행은 팀 상세의 SQL 수가 16/17로 흔들려 실패했다. 원문 진단으로 추가 쿼리가 connection pool의 SELECT 1임을 확인했다. 최종 실행은 SQL 수에서 이 health 쿼리만 분리해 poolHealthSqlCount와 transportSqlCount에 함께 보존한다. 지연 표본은 버리지 않고 health 비용도 포함한다. 최종 팀 상세에서 양쪽 모두 health 쿼리 2회가 기록됐다. BEGIN·COMMIT과 팀 evidence SQL은 여전히 SQL 수에 포함한다. 변동을 감추려고 assertion을 지우지 않았다.

최종 1 suite·1 test, INTERLEAVED_FINAL_EXIT=0. 원시 표본과 파일 SHA-256은 task-4-axis-conversion-performance.json, 재현 하네스는 submission-axis-conversion-interleaved.integration.spec.ts.txt에 있다. 원시 쿼리에 포함되는 값이나 운영 원본은 공개하지 않았다. 임시 하네스와 base export는 측정 후 제거한다.

