# 시스템 지도

이 문서는 예정된 저장소 구조와 컴포넌트 경계를 보여준다. 기술·운영 결정의 근거는 [ADR 인덱스](decisions/README.md)를 참조하며 이 문서에서 재서술하지 않는다.

## 예정 디렉터리 구조

```text
apps/
├── frontend/                 # Next.js 사용자 인터페이스
└── backend/                  # NestJS REST API
    └── prisma/               # Prisma schema와 migration
deploy/                       # nginx, Jenkins, 서버 배포 설정
compose.yaml                  # 운영 런타임 Compose 정의
compose.dev.yaml              # 개발 PostgreSQL Compose 정의
docs/
├── decisions/                # Architecture Decision Records
├── exec-plan/                # 수동 운영 절차와 실행 기록
└── rules/                    # 구현 규칙
```

## 컴포넌트 경계

- `apps/frontend`는 브라우저 UI와 화면별 상태를 소유하며 API 호출은 단일 클라이언트를 통해 수행한다.
- `apps/backend`는 `/api/v1` REST API, DTO 검증, 업무 규칙, 영속성 접근을 소유한다.
- PostgreSQL은 backend만 직접 접근한다.
- `deploy/`와 Compose 파일은 런타임 네트워크, proxy, 배포 자동화를 소유한다.
- `docs/decisions`는 장기 결정, `docs/exec-plan`은 반복 가능한 수동 운영 절차를 소유한다.

## 배포 런타임

```mermaid
flowchart LR
  Internet[인터넷] --> Nginx[nginx :80/:443]
  Nginx -->|/| Front[front]
  Nginx -->|/api| Back[back]
  Back --> Postgres[(postgres / pgdata)]
  Back --> Minio[(minio / minio_data)]
```

nginx는 `/` 요청을 front로, `/api` 요청을 back으로 전달한다.
`/api/v1` 접두사는 proxy에서 제거하지 않는다.
런타임 컨테이너는 nginx, front, back, postgres와 제출 파일 object storage인 `minio` 지속 서비스·`minio-bucket` 초기화 서비스까지 여섯 개다.

## 핵심 흐름

### 요청 경로

1. 브라우저 요청은 nginx의 80 또는 443 포트에 도착한다.
2. UI 경로는 front로 전달되고, `/api` 경로는 back으로 전달된다.
3. back은 `/api/v1` API 계약에 따라 요청을 처리하고 PostgreSQL에 접근한다.
4. 응답은 nginx를 거쳐 브라우저로 반환된다.

### 배포 경로

1. PR과 main 병합의 품질 검증은 GitHub Actions `ci`가 단독으로 수행하며 Jenkins는 실행되지 않으므로 병합만으로는 production이 바뀌지 않는다.
2. Jenkins는 draft·prerelease가 아닌 GitHub Release가 발행될 때만 실행되고 그 발행 자체가 배포 인가다.
3. Jenkins는 latest full Release와 tag의 main ancestry를 검증하고 exact commit SHA를 checkout한다.
4. 동일·하위 Release는 no-op으로 종료한다. 새 Release는 test → DB backup → SHA 이미지 1회 build → migration → Compose 순서로 배포한다.
5. Compose ingress에서 `/`·`/api/v1/health` 200과 제출 파일 업로드 경로 403 smoke가 성공한 뒤에만 정상 배포 상태를 기록한다. 실패하면 이전 이미지를 한 번 복구하고 DB restore는 승인된 수동 절차로 남긴다.
