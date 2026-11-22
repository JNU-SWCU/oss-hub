type Callback = () => Promise<void>;
type CapturedCase = {
  readonly setup: readonly Callback[];
  readonly teardown: readonly Callback[];
  readonly run: Callback;
};
type FixtureDouble = {
  readonly runAt: () => Promise<never>;
  readonly close: () => Promise<void>;
};

function deferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  if (!resolve) throw new Error('promise resolver was not initialized');
  return { promise, resolve };
}

function captureCases(createFixture: () => Promise<FixtureDouble>) {
  const cases: CapturedCase[] = [];
  const contexts: { setup: Callback[]; teardown: Callback[] }[] = [
    { setup: [], teardown: [] },
  ];
  const current = () => {
    const context = contexts.at(-1);
    if (!context) throw new Error('test registration context missing');
    return context;
  };
  const invoke =
    (fn: Parameters<typeof beforeEach>[0]): Callback =>
    async () => {
      await Reflect.apply(fn, undefined, []);
    };
  const spies = [
    jest.spyOn(global, 'describe').mockImplementation((_name, block) => {
      const parent = current();
      contexts.push({
        setup: [...parent.setup],
        teardown: [...parent.teardown],
      });
      try {
        block();
      } finally {
        contexts.pop();
      }
    }),
    jest.spyOn(global, 'beforeEach').mockImplementation((fn) => {
      current().setup.push(invoke(fn));
    }),
    jest.spyOn(global, 'afterEach').mockImplementation((fn) => {
      current().teardown.unshift(invoke(fn));
    }),
    jest.spyOn(global, 'beforeAll').mockImplementation(() => undefined),
    jest.spyOn(global, 'afterAll').mockImplementation(() => undefined),
    jest.spyOn(global, 'it').mockImplementation((_name, fn) => {
      if (!fn) throw new Error('test callback missing');
      cases.push({
        setup: [...current().setup],
        teardown: [...current().teardown],
        run: invoke(fn),
      });
    }),
  ];
  try {
    jest.isolateModules(() => {
      jest.doMock('./collection-scale.integration-support', () => ({
        ...jest.requireActual<
          typeof import('./collection-scale.integration-support')
        >('./collection-scale.integration-support'),
        createScaleCollectionFixture: createFixture,
      }));
      jest.requireActual(
        './collection-sync.service.100-repositories.integration.spec',
      );
    });
  } finally {
    spies.forEach((spy) => spy.mockRestore());
    jest.dontMock('./collection-scale.integration-support');
  }
  const [first, second] = cases;
  if (!first || !second) throw new Error('collection cases missing');
  return { first, second };
}

async function runHooks(hooks: readonly Callback[]) {
  for (const hook of hooks) await hook();
}

describe('collection scale fixture ownership', () => {
  it('late teardown closes A while B is still running', async () => {
    const events: string[] = [];
    const startedA = deferred();
    const startedB = deferred();
    const finishA = deferred();
    const finishB = deferred();
    const stopped = new Error('case already timed out');
    const fixtures: FixtureDouble[] = [
      {
        async runAt() {
          events.push('A running');
          startedA.resolve();
          await finishA.promise;
          throw stopped;
        },
        close() {
          events.push('close A');
          return Promise.resolve();
        },
      },
      {
        async runAt() {
          events.push('B running');
          startedB.resolve();
          await finishB.promise;
          throw stopped;
        },
        close() {
          events.push('close B');
          return Promise.resolve();
        },
      },
    ];
    const { first, second } = captureCases(() => {
      const fixture = fixtures.shift();
      if (!fixture) throw new Error('fixture allocation exhausted');
      return Promise.resolve(fixture);
    });

    await runHooks(first.setup);
    const resultA = Promise.allSettled([first.run()]);
    await startedA.promise;
    const cleanupA = runHooks(first.teardown);
    await runHooks(second.setup);
    const resultB = Promise.allSettled([second.run()]);
    await startedB.promise;
    finishA.resolve();
    await resultA;
    await cleanupA;

    try {
      expect(events).toEqual(['A running', 'B running', 'close A']);
    } finally {
      finishB.resolve();
      await resultB;
      await runHooks(second.teardown);
    }
    expect(events).toEqual(['A running', 'B running', 'close A', 'close B']);
  });

  it('late setup is disposed by A without replacing the running B fixture', async () => {
    const events: string[] = [];
    const allowSetupA = deferred();
    const startedB = deferred();
    const finishB = deferred();
    let allocations = 0;
    const { first, second } = captureCases(async () => {
      allocations += 1;
      if (allocations === 1) {
        await allowSetupA.promise;
        return {
          runAt() {
            return Promise.reject(
              new Error('A body must not start after setup timed out'),
            );
          },
          close() {
            events.push('close A');
            return Promise.resolve();
          },
        };
      }
      return {
        async runAt() {
          events.push('B running');
          startedB.resolve();
          await finishB.promise;
          throw new Error('B body finished');
        },
        close() {
          events.push('close B');
          return Promise.resolve();
        },
      };
    });

    const setupA = runHooks(first.setup);
    const cleanupA = runHooks(first.teardown);
    await runHooks(second.setup);
    const resultB = Promise.allSettled([second.run()]);
    await startedB.promise;
    allowSetupA.resolve();
    await setupA;
    await cleanupA;

    try {
      expect(events).toEqual(['B running', 'close A']);
    } finally {
      finishB.resolve();
      await resultB;
      await runHooks(second.teardown);
    }
    expect(events).toEqual(['B running', 'close A', 'close B']);
  });
});
