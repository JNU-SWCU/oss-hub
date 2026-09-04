import { SUBMISSION_FILE_EXTENSIONS } from './submission-file-content-type';

/**
 * 업로드 상한·허용 형식의 **유일한 소유자**.
 *
 * 이 값은 앞서 여덟 곳에 같은 리터럴로 흩어져 있었고 이미 표기가 갈라졌다(#1107) —
 * 사용자가 실패 **전에** 보는 유일한 자리만 「5MB」였고 나머지는 「5MiB」였다. 그래서
 * 숫자를 한 곳으로 모으고, 화면은 이 값을 API 응답으로 받아 쓴다. 화면이 자기 사본을
 * 들면 서버가 거절하는 상한과 화면이 약속하는 상한이 다시 갈라진다.
 *
 * ⚠ 상한 값 자체는 그대로 5 MiB다. nginx `client_max_body_size 6m`은 이 값보다 **위**에
 *   두어 초과분이 nginx의 413이 아니라 앱의 ProblemDetail로 거절되게 한 짝이다
 *   (`deploy/nginx/nginx.conf`, `deploy/host-nginx/oss-hub.conf`). 한쪽만 올리지 않는다.
 */
export const SUBMISSION_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/**
 * 사람이 읽는 표기. 실제 상한은 5 MiB(5,242,880 B)지만 화면·오류 문구는 「5 MB」 하나로
 * 통일한다 — 두 표기를 섞으면 같은 값을 보고도 서로 다른 상한으로 읽힌다(#1107).
 */
export const SUBMISSION_UPLOAD_MAX_LABEL = '5 MB';

/**
 * `<input type="file" accept>`에 그대로 넣는 값. 확장자만 싣는다 — 브라우저가 붙이는 MIME은
 * 입장 판정에 쓰지 않기로 이미 정했고(#1184), 여기에 MIME을 섞으면 화면이 서버보다 넓거나
 * 좁은 목록을 약속하게 된다.
 */
export const SUBMISSION_UPLOAD_ACCEPT = SUBMISSION_FILE_EXTENSIONS.join(',');

const EXTENSION_LABELS: Readonly<Record<string, string>> = {
  '.jpeg': 'JPG',
};

/** 「PDF, HWP, JPG, PNG, ZIP」 — 허용 확장자에서 직접 만든다(따로 적어 두면 목록과 갈라진다). */
export const SUBMISSION_UPLOAD_FORMAT_LABEL = [
  ...new Set(
    SUBMISSION_FILE_EXTENSIONS.map(
      (extension) =>
        EXTENSION_LABELS[extension] ?? extension.slice(1).toUpperCase(),
    ),
  ),
].join(', ');

/** 상한 초과 거절 문구. 서버가 내는 말과 화면이 미리 보여 주는 말이 같아야 한다. */
export const SUBMISSION_UPLOAD_TOO_LARGE_MESSAGE = `파일은 ${SUBMISSION_UPLOAD_MAX_LABEL} 이하여야 합니다.`;
