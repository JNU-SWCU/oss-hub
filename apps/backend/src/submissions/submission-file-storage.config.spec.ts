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
    // Compose 내부 서비스 호스트명(정확 일치)과 loopback/사설 http.
    'http://minio:9000',
    'http://127.0.0.1:9000',
    'http://localhost:9000',
    'http://10.1.2.3:9000',
    'http://192.168.0.5:9000',
    'http://[::1]:9000',
    // RFC1918 172.16/12 경계 양끝.
    'http://172.16.0.1:9000',
    'http://172.31.255.254:9000',
    // IPv6 ULA·link-local.
    'http://[fd00::1]:9000',
    'http://[fe80::1]:9000',
    // URL 파서가 127.0.0.1로 정규화하는 십진 표기.
    'http://2130706433:9000',
    // 관리형 S3로 옮겨도 https 공개 엔드포인트는 그대로 통과해야 한다.
    'https://s3.ap-northeast-2.amazonaws.com',
    'https://s3.example.com',
  ])('%s는 허용된 endpoint라서 설정을 반환한다', (endpoint) => {
    setValidEnvironment({ SUBMISSION_FILE_S3_ENDPOINT: endpoint });

    const settings = new SubmissionFileStorageConfig().requireSettings();

    expect(settings.endpoint).toBe(endpoint);
  });

  it.each([
    // 공개 http·비허용 scheme·비URL.
    'http://s3.example.com',
    'http://8.8.8.8:9000',
    'ftp://minio:9000',
    'not-a-url',
    // 다른 단일 라벨 호스트는 Compose 서비스명 minio가 아니므로 거부.
    'http://redis:9000',
    'http://postgres:9000',
    // credentials/query/fragment는 http·https 모두 protocol 수락 전 거부.
    'http://user:pass@minio:9000',
    'http://minio:9000?x=1',
    'http://minio:9000#frag',
    'https://user:pass@s3.example.com',
    'https://s3.example.com?x=1',
    'https://s3.example.com#frag',
    // present-empty delimiter: WHATWG getters are empty but component is present.
    'https://s3.example.com?',
    'https://s3.example.com#',
    'https://s3.example.com?#',
    'http://minio:9000?',
    'http://minio:9000#',
    'https://@s3.example.com',
    'https://:@s3.example.com',
    'http://@minio:9000',
    'http://:@minio:9000',
    // userinfo에 사설 호스트를 숨겨도 credentials가 있으면 거부.
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

  it.each([
    // percent-encoded path octets are not query/fragment delimiters.
    'https://s3.example.com/%3Fnot-query',
    'https://s3.example.com/%23not-hash',
    'https://s3.example.com/path%3Fstill-path',
    'https://s3.example.com/path%23still-path',
    'http://minio:9000/%3Fnot-query',
  ])(
    '%s는 percent-encoded 경로라서 허용된 endpoint로 설정을 반환한다',
    (endpoint) => {
      setValidEnvironment({ SUBMISSION_FILE_S3_ENDPOINT: endpoint });

      const settings = new SubmissionFileStorageConfig().requireSettings();

      expect(settings.endpoint).toBe(endpoint);
    },
  );

  it('endpoint 앞뒤 공백은 trim한 값으로 반환한다', () => {
    setValidEnvironment({
      SUBMISSION_FILE_S3_ENDPOINT: '  https://s3.example.com  ',
    });

    const settings = new SubmissionFileStorageConfig().requireSettings();

    expect(settings.endpoint).toBe('https://s3.example.com');
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
