# Todo 5 게이트 수정 코드 검토

2026-11-04. 사용자 지시에 따라 인계자가 위임 없이 검토했다. 이 기록은 수정 HEAD의 독립 재게이트 승인이 아니다.

## 원인과 수정 경계

상태 삭제로 하위 행이 살아남으면서 하위 ID 존재만 확인하던 쓰기와 수집이 계속 통과했다. 기존 프로그램 조회·잠금에서 DELETED를 제외하고 빈 결과를 거부한다. 새 잠금 전략이나 worker는 추가하지 않았다.

공통 수집 조건은 `PlatformRepository.collectionTargetWhere()` 인스턴스 메서드 한 곳에 둔다. `CollectionIncrementalRepository`와 `SystemStatusRepository`가 생성자로 주입받고 트랜잭션 store도 같은 인스턴스를 받는다. PlatformModule이 이미 전역 provider를 export하며 PlatformRepository는 두 소비 repository를 참조하지 않아 순환 의존성은 없다. static 메서드는 기존 DI lint에서 거부되어 인스턴스 메서드로 수정했다.

## programming 검토

- 기존 typed 결과·오류와 실제 Prisma 경계를 재사용한다. 새 parsing·normalization·retry 계층이나 호환 플래그를 추가하지 않았다.
- 테이블 기반 DB 테스트의 20개 경계와 별도 URL 변경·신청 승인 2개를 확인했다. PUBLISHED·ARCHIVED 양성 대조와 DELETED의 거부 및 기록 불변을 대조한다.
- 조직·외부 저장소 각각 실제 수집 SKIPPED, 관리자 집계 감소, 상세 제외, 기존 fact·Contribution·랭킹 불변을 검사한다.
- 경합 네 건은 실제 프로그램 이름 검색으로 삭제 전 ID와 count 1을 확인한다. 상태 삭제는 새 자식을 보존하므로 종전 물리 삭제의 409가 필요 없다는 이유가 공통 it.each 제목에 있다. 기존 snapshot·identity 변경의 409는 유지한다.
- 넓힌 통합 실행에서 관리자 상세 테스트가 다른 suite가 남긴 동일한 저장소 표시 이름을 대상으로 오인했다. fixture의 고유 ID를 표시 이름에도 넣어 삭제 전후 같은 저장소를 검사하도록 수정했다. 실제 수집 조건과 삭제 후 부정 assertion은 유지했다.

## remove-ai-slops 검토

| 관점 | 판정과 근거 |
| --- | --- |
| 과잉·무용 테스트 | 새 DB 테스트는 기존 하위 쓰기의 lifecycle 공백을 검출하며 정상 상태의 성공도 검사한다. |
| 삭제만 검사하는 테스트 | 행·관계·파일 큐 보존, 실패 시 이력·outbox 불변을 함께 검사한다. |
| 제거 확인용 테스트 | 소스 문자열 grep이나 복제된 파일·export 인벤토리를 추가하지 않았다. |
| 동어반복·공허한 부정 | 목록의 삭제 전 양성 전제와 실제 필터 변이에서 네 실패를 확인했다. 관리자 상세도 고유 저장소 이름의 삭제 전 존재를 확인한다. |
| 구현 미러 | 일부 기존 unit은 Prisma 인수·잠금 순서를 고정한다. 보안·직렬화 계약의 보조 증거로 유지하며 행동의 주 증거는 실제 DB 테스트다. |
| 불필요한 추출·변환 | 여러 실제 소비자가 사용하는 공통 조건만 기존 PlatformRepository에 두었다. 테스트 전용 production seam이나 별도 변환 계층은 없다. |

변이 증거는 목록의 DELETED 필터를 제거했을 때 정확히 네 경합 테스트가 실패한 로그(4 failed / 19 passed, EXIT=1)와 원복 후 전체 퍼지 통합 23개 통과 로그(EXIT=0)다. 변이 대상 production 파일은 최초 준비 커밋과 동일하다. it.each 제목 수정 외 경합 행동은 이 증거와 같다.

## 범위와 남은 위험

backend PR의 apps/frontend·guide diff는 0이다. 새 안내와 가이드는 최초 검증된 준비 커밋의 해당 파일을 별도 draft로 옮긴다. 기존 보존 패치의 손상은 원본 커밋에서 binary patch를 다시 생성해 복구했고 원본과 staged 전체 백업도 보존했다.

소유자가 Todo 6에 배정한 늦은 커버·양식 바이트 큐 공백은 남는다. 운영 배포 확인과 retire 삭제 승인은 수행하지 않는다. 별도 frontend draft는 backend 운영 확인 전 배포할 수 없다.
