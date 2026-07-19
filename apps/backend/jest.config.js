module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  // src와 prisma(#110 시드 스펙) 양쪽의 *.spec.ts를 모두 찾도록 backend 루트를 rootDir로 쓴다.
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/prisma'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.(t|j)s', 'prisma/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};
