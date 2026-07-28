import { SubmissionFileStorageConfig } from './submission-file-storage.config';
import {
  SUBMISSION_FILE_STORAGE_ERROR_CODES,
  SubmissionFileStorageError,
} from './submission-file-storage.port';

const ENV_KEYS = [
  'SUBMISSION_FILE_S3_ENDPOINT',
  'SUBMISSION_FILE_S3_REGION',
  'SUBMISSION_FILE_S3_BUCKET',
  'SUBMISSION_FILE_S3_ACCESS_KEY_ID',
  'SUBMISSION_FILE_S3_SECRET_ACCESS_KEY',
  'SUBMISSION_FILE_S3_FORCE_PATH_STYLE',
  'NODE_ENV',
] as const;
type EnvKey = (typeof ENV_KEYS)[number];

describe('SubmissionFileStorageConfig', () => {
  const original: Partial<Record<EnvKey, string>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      original[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  });

  function setValidEnvironment(
    overrides: Partial<Record<EnvKey, string | undefined>> = {},
  ) {
    process.env.SUBMISSION_FILE_S3_ENDPOINT = 'https://s3.example.com';
    process.env.SUBMISSION_FILE_S3_REGION = 'synthetic-region';
    process.env.SUBMISSION_FILE_S3_BUCKET = 'synthetic-bucket';
    process.env.SUBMISSION_FILE_S3_ACCESS_KEY_ID = 'synthetic-access-key';
    process.env.SUBMISSION_FILE_S3_SECRET_ACCESS_KEY = 'synthetic-secret-key';
    process.env.SUBMISSION_FILE_S3_FORCE_PATH_STYLE = 'true';
    for (const key of Object.keys(overrides) as EnvKey[]) {
      const value = overrides[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  function expectConfigurationError() {
    return expect(() =>
      new SubmissionFileStorageConfig().requireSettings(),
    ).toThrow(
      new SubmissionFileStorageError(
        SUBMISSION_FILE_STORAGE_ERROR_CODES.CONFIGURATION,
      ),
    );
  }

  it('6개 값이 모두 있고 endpoint가 https://s3.example.com이면 설정을 반환한다', () => {
    setValidEnvironment();

    const settings = new SubmissionFileStorageConfig().requireSettings();

    expect(settings).toEqual({
      endpoint: 'https://s3.example.com',
      region: 'synthetic-region',
      bucket: 'synthetic-bucket',
      accessKeyId: 'synthetic-access-key',
      secretAccessKey: 'synthetic-secret-key',
      forcePathStyle: true,
    });
  });

  it.each(['true', 'false'] as const)(
    "forcePathStyle 문자열 '%s'를 boolean으로 파싱한다",
    (value) => {
      setValidEnvironment({ SUBMISSION_FILE_S3_FORCE_PATH_STYLE: value });

      const settings = new SubmissionFileStorageConfig().requireSettings();

      expect(settings.forcePathStyle).toBe(value === 'true');
    },
  );

  it("forcePathStyle이 'true'/'false' 외 값이면 CONFIGURATION 에러를 던진다", () => {
    setValidEnvironment({ SUBMISSION_FILE_S3_FORCE_PATH_STYLE: 'yes' });

    expectConfigurationError();
  });

  it.each([
    'SUBMISSION_FILE_S3_ENDPOINT',
    'SUBMISSION_FILE_S3_REGION',
    'SUBMISSION_FILE_S3_BUCKET',
    'SUBMISSION_FILE_S3_ACCESS_KEY_ID',
    'SUBMISSION_FILE_S3_SECRET_ACCESS_KEY',
    'SUBMISSION_FILE_S3_FORCE_PATH_STYLE',
  ] as const)('%s가 누락되면 CONFIGURATION 에러를 던진다', (key) => {
    setValidEnvironment({ [key]: undefined });

    expectConfigurationError();
  });

  it.each([
    'SUBMISSION_FILE_S3_ENDPOINT',
    'SUBMISSION_FILE_S3_REGION',
    'SUBMISSION_FILE_S3_BUCKET',
    'SUBMISSION_FILE_S3_ACCESS_KEY_ID',
    'SUBMISSION_FILE_S3_SECRET_ACCESS_KEY',
    'SUBMISSION_FILE_S3_FORCE_PATH_STYLE',
  ] as const)('%s가 공백 문자열이면 CONFIGURATION 에러를 던진다', (key) => {
    setValidEnvironment({ [key]: '   ' });

    expectConfigurationError();
  });

  it.each([
    'http://minio:9000',
    'http://127.0.0.1:9000',
    'http://localhost:9000',
    'http://10.1.2.3:9000',
    'http://192.168.0.5:9000',
    'http://[::1]:9000',
    // RFC1918 172.16/12 경계 양끝.
    'http://172.16.0.1:9000',
    'http://172.31.255.254:9000',
    // IPv6 ULA.
    'http://[fd00::1]:9000',
    // URL 파서가 127.0.0.1로 정규화하는 십진 표기.
    'http://2130706433:9000',
    // 관리형 S3로 옮겨도 https 공개 엔드포인트는 그대로 통과해야 한다.
    'https://s3.ap-northeast-2.amazonaws.com',
  ])('%s는 사설 대상 http라서 허용한다', (endpoint) => {
    setValidEnvironment({ SUBMISSION_FILE_S3_ENDPOINT: endpoint });

    expect(() =>
      new SubmissionFileStorageConfig().requireSettings(),
    ).not.toThrow();
  });

  it.each([
    'http://s3.example.com',
    'http://8.8.8.8:9000',
    'ftp://minio:9000',
    'not-a-url',
    // userinfo에 사설 호스트를 숨겨도 실제 접속 대상은 공개 호스트다.
    'http://minio:9000@s3.example.com/',
    // 사설 IP를 앞에 붙인 공개 호스트명.
    'http://127.0.0.1.s3.example.com:9000',
    // RFC1918 172.16/12 바로 바깥.
    'http://172.32.0.1:9000',
    'http://172.15.255.255:9000',
    // URL 파서가 8.8.8.8로 정규화하는 십진 표기.
    'http://134744072:9000',
    // 공개 IPv6, 그리고 IPv4-mapped 형태로 우회 시도.
    'http://[2001:db8::1]:9000',
    'http://[::ffff:8.8.8.8]:9000',
  ])('%s는 CONFIGURATION 에러를 던진다', (endpoint) => {
    setValidEnvironment({ SUBMISSION_FILE_S3_ENDPOINT: endpoint });

    expectConfigurationError();
  });

  it('NODE_ENV=production에서도 http://minio:9000을 허용한다', () => {
    setValidEnvironment({
      SUBMISSION_FILE_S3_ENDPOINT: 'http://minio:9000',
      NODE_ENV: 'production',
    });

    expect(() =>
      new SubmissionFileStorageConfig().requireSettings(),
    ).not.toThrow();
  });

  it('NODE_ENV=development에서도 http://s3.example.com을 거부한다', () => {
    setValidEnvironment({
      SUBMISSION_FILE_S3_ENDPOINT: 'http://s3.example.com',
      NODE_ENV: 'development',
    });

    expectConfigurationError();
  });
});
