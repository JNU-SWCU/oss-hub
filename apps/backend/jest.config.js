module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],

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
