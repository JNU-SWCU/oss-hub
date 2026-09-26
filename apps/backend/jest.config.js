module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  // src·prisma(#110 시드 스펙)·test(E2E 대역) 세 곳의 *.spec.ts를 모두 찾도록 backend 루트를 rootDir로 쓴다.
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/prisma', '<rootDir>/test'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.(t|j)s', 'prisma/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};
