import type { RuntimeConfig } from '../runtime-config/runtime-config';
import { CollectionPublicReadConfig } from './collection-app.config';

/**
 * 수집 전용 GitHub 서비스 계정 fine-grained PAT provider.
 *
 * `CollectionAppTokenProvider`(Collection GitHub App installation token)와
 * 같은 `getToken`/`clear` 표면을 제공하지만, 이쪽은 발급·갱신·만료가 없는
 * 정적 PAT 하나다. GitHub GraphQL v4는 OAuth App client_id:client_secret
 * Basic Auth를 받지 않고 REST 전용 미인증 한도 상향 기전이므로, REST·GraphQL
 * 양쪽에서 조직 설치 범위 밖 public 저장소를 읽어야 하는 이 수집 경로는 PAT
 * 하나로 통일한다. fine-grained PAT은 스코프 선택과 무관하게 public repo
 * 읽기를 항상 포함하며, 시간당 5,000 요청 한도를 갖는다.
 *
 * PAT은 `Authorization: Bearer <token>` 형태 그대로 쓰이므로,
 * `CollectionAppClient`/`CollectionDiscoveryClient`가 이미 하드코딩한
 * `Authorization: Bearer ${token}` 구성과 별도 변경 없이 맞는다 — `getToken()`은
 * PAT 원문 문자열을 그대로 반환한다(헤더 스킴을 조립하지 않는다).
 *
 * 자격증명 부재는 생성자가 아니라 `getToken()` 최초 호출 시점에만 검증한다 —
 * 조직 collection이 이 키 없이도 계속 동작해야 하므로 모듈 부트스트랩에서
 * 즉시 실패시키지 않고, 외부 수집이 실제로 시도되는 지점에서만 fail-closed로
 * 실패한다.
 */
export class CollectionPublicTokenProvider {
  private token: string | undefined;

  constructor(private readonly runtimeConfig: RuntimeConfig) {}

  /**
   * `CollectionAppTokenProvider.getToken(signal?)`과 같은 모양이지만 갱신할
   * 대상이 없어 `signal`을 받지 않는다 — 함수 타입은 매개변수가 더 적어도
   * 호환되므로(TS parameter bivariance) `(signal?: AbortSignal) => Promise<string>`
   * 자리에 그대로 대입할 수 있다.
   */
  // 검증 실패를 항상 rejected promise로 전달한다 — await 없는 async로 선언하면
  // eslint(require-await)가 막으므로, 동기 검증을 try/catch로 감싸 명시적으로
  // resolve/reject한다. 그냥 동기 함수였다면 CollectionAppConfigError가
  // 호출 자체에서 동기적으로 throw돼 호출자의 `await`/`.catch` 계약을 깬다.
  getToken(): Promise<string> {
    if (this.token !== undefined) return Promise.resolve(this.token);
    try {
      const config = CollectionPublicReadConfig.fromRuntimeConfig(
        this.runtimeConfig,
      );
      this.token = config.token;
      return Promise.resolve(this.token);
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * 정적 PAT이라 무효화할 캐시가 없다 — 호출자가 401을 받고
   * `CollectionAppTokenProvider`와 동일하게 clear를 호출해도 안전한 no-op이다.
   * 이 no-op이 401 재시도를 무한 루프로 만들지 않는 이유: 토큰 값 자체가
   * 절대 바뀌지 않으므로 clear가 캐시를 비우지 않아도 staleness가 없고,
   * `CollectionAppClient.request`/`CollectionDiscoveryClient`의 401 재시도는
   * 이 provider와 무관하게 이미 최대 1회로 bounded되어 있어(두 번째 401은
   * 즉시 에러를 던진다) clear의 동작 방식과 상관없이 무한 루프가 될 수 없다.
   */
  clear(): void {
    // no-op
  }
}
