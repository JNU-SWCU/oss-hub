// 그래프 노드 색상 — canvas 드로잉과 히어로 하단 범례가 동시에 참조하는 단일 소스.
// 'use client' 모듈 밖으로 둔다. Server Component(landing-hero)가 client 모듈 상수를
// 직접 import하면 서버는 실제 값 대신 client reference proxy를 보게 되어 범례 style이 비기 때문이다.
export const HERO_NODE_COLORS = Object.freeze({
  program: '#ffffff', // 흰색 발광점 (프로그램)
  student: '#9db9f0', // ≈ --palette-navy-200/300 (학생)
  repository: '#5cc687', // --palette-green-300 (저장소)
});
