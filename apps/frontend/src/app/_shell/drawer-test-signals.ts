const DEFAULT_TIMEOUT_MS = 1000;

export function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label}: ${timeoutMs}ms 안에 오지 않았습니다`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function nextFocus(target: HTMLElement): Promise<void> {
  return withTimeout(
    new Promise<void>((resolve) => {
      target.addEventListener('focus', () => resolve(), { once: true });
    }),
    'focus 이벤트',
  );
}

export function bodyAttributeRemoved(name: string): Promise<void> {
  let observer: MutationObserver | undefined;
  return withTimeout(
    new Promise<void>((resolve) => {
      observer = new MutationObserver(() => {
        if (!document.body.hasAttribute(name)) resolve();
      });
      observer.observe(document.body, { attributeFilter: [name] });
    }),
    `body[${name}] 제거`,
  ).finally(() => observer?.disconnect());
}

export function documentListenerAdded(type: string): Promise<void> {
  const original = document.addEventListener.bind(document);
  const restore = () => Reflect.deleteProperty(document, 'addEventListener');
  return withTimeout(
    new Promise<void>((resolve) => {
      document.addEventListener = ((
        ...args: Parameters<typeof original>
      ) => {
        original(...args);
        if (args[0] === type) {
          restore();
          resolve();
        }
      }) as typeof document.addEventListener;
    }),
    `document '${type}' 리스너 등록`,
  ).finally(restore);
}

export function callSignal(): {
  readonly called: Promise<void>;
  readonly notify: () => void;
} {
  let notify!: () => void;
  const called = new Promise<void>((resolve) => {
    notify = resolve;
  });
  return { called: withTimeout(called, '콜백 호출'), notify };
}
