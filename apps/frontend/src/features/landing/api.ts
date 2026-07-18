import { apiPath } from "@/lib/api-client";

/**
 * OAuth 진입은 fetch가 아니라 브라우저 이동(<a href>)이어야 한다.
 * landing은 auth feature 내부 경로에 의존하지 않고, 단일 클라이언트의
 * 경로 빌더(apiPath)만 재사용해 자체 상수를 갖는다.
 */
export const githubLoginPath = apiPath("auth/github");
