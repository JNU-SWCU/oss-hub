# Architecture Decision Records

이 디렉터리는 변경 비용이 큰 기술·운영 결정을 ADR(Architecture Decision Record)로 기록한다. ADR은 삭제하지 않는 주제 앵커이며, 결정이 바뀌면 같은 문서를 현재 결정에 맞게 갱신하고 Changelog에 변경을 남긴다.

## ADR 인덱스

| 번호 | 상태 | 결정 | 문서 |
| --- | --- | --- | --- |
| ADR-001 | Accepted | 테크스택 | [ADR-001-테크스택](ADR-001-테크스택.md) |
| ADR-002 | Accepted | CI/CD 파이프라인 | [ADR-002-CI-CD-파이프라인](ADR-002-CI-CD-파이프라인.md) |
| ADR-003 | Accepted | Backend Architecture | [ADR-003-backend-architecture](ADR-003-backend-architecture.md) |
| ADR-004 | Accepted | REST API 규격 | [ADR-004-REST-API-규격](ADR-004-REST-API-규격.md) |
| ADR-005 | Proposed | Agent-Driven Review Cycle | [ADR-005-agent-driven-review-cycle](ADR-005-agent-driven-review-cycle.md) |

## ADR 라이프사이클

1. 제안자는 되돌리기 어려운 횡단 결정을 ADR로 작성하고 상태를 `Proposed`로 둔다.
2. 합의된 결정은 `Accepted`로 바꾸고 근거, 대안, 결과를 현재 사실에 맞게 완결한다.
3. 더 이상 적용되지 않는 결정은 `Deprecated`로 바꾸며, 대체 결정과 영향을 References에 연결한다.
4. 결정의 내용이 바뀌면 파일을 새로 만들거나 삭제하지 않고 같은 ADR을 갱신한 뒤 Changelog에 날짜와 변경 사유를 남긴다.

구현 작업의 세부 절차나 짧은 수명의 설정값은 ADR 대상이 아니다. 해당 내용은 실행 계획 또는 운영 문서에 기록한다.
