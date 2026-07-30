import { loadRuntimeConfig } from './runtime-config';

/**
 * 프로세스 환경을 읽는 애플리케이션 전역 단일 어댑터다.
 * Nest provider와 decorator-time 소비자가 같은 불변 snapshot을 공유한다.
 */
export const PROCESS_RUNTIME_CONFIG = loadRuntimeConfig(process.env);
