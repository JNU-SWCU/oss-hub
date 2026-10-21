import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { parseDotenv } from './validate-production-env.mjs';

class StateError extends Error {}
const fail = (reason) => {
  throw new StateError(reason);
};
const run = (command, args) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const docker = (...args) => run('docker', args);
const inspect = (...args) => {
  const values = JSON.parse(docker(...args));
  if (!Array.isArray(values) || values.length !== 1) fail('ambiguous inspect');
  return values[0];
};
const semver = (tag) => {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
    fail('invalid version');
  return tag.slice(1).split('.').map(BigInt);
};
const same = (a, b, reason) => {
  if (a !== b) fail(reason);
};
const hash = (file) =>
  createHash('sha256').update(readFileSync(file)).digest('hex');
const mount = (container, destination) => {
  const matches = container.Mounts.filter(
    (item) =>
      item.Destination === destination &&
      item.Type === 'bind' &&
      item.RW === false,
  );
  if (matches.length !== 1 || !isAbsolute(matches[0].Source))
    fail('unsupported bind mount');
  return realpathSync(matches[0].Source);
};

try {
  const [tag, sha, mode, source, secrets] = process.argv.slice(2);
  const target = semver(tag);
  if (!/^[a-f0-9]{40}$/.test(sha)) fail('invalid revision');
  const ids = docker(
    'ps',
    '--all',
    '--quiet',
    '--filter',
    'label=com.docker.compose.project=oss-hub',
  )
    .split(/\s+/)
    .filter(Boolean);
  if (!ids.length) fail('unsupported empty host');
  if (ids.length !== 3) fail('partial or duplicate project');
  const services = {};
  for (const id of ids) {
    const container = inspect('inspect', id);
    const labels = container.Config.Labels;
    const service = labels['com.docker.compose.service'];
    if (
      labels['com.docker.compose.project'] !== 'oss-hub' ||
      !['postgres', 'backend', 'nginx'].includes(service) ||
      services[service]
    )
      fail('invalid service inventory');
    const state = container.State;
    if (
      !state.Running ||
      state.Paused ||
      state.Restarting ||
      state.Dead ||
      state.Status !== 'running' ||
      (container.Config.Healthcheck &&
        container.Config.Healthcheck.Test?.[0] !== 'NONE' &&
        state.Health?.Status !== 'healthy')
    )
      fail('service not healthy running');
    services[service] = container;
  }
  const backend = services.backend;
  const labels = backend.Config.Labels;
  const previousTag = labels['org.opencontainers.image.version'];
  const previousSha = labels['org.opencontainers.image.revision'];
  const current = semver(previousTag);
  if (
    !/^[a-f0-9]{40}$/.test(previousSha) ||
    !/^sha256:[a-f0-9]{64}$/.test(backend.Image)
  )
    fail('invalid image identity');
  same(
    backend.Config.Image,
    `oss-hub-backend:${previousTag}`,
    'image tag mismatch',
  );
  const image = inspect('image', 'inspect', backend.Config.Image);
  same(image.Id, backend.Image, 'moved previous image tag');
  same(
    image.Config.Labels['org.opencontainers.image.version'],
    previousTag,
    'image version mismatch',
  );
  same(
    image.Config.Labels['org.opencontainers.image.revision'],
    previousSha,
    'image revision mismatch',
  );
  if (tag === previousTag && sha !== previousSha)
    fail('same tag different revision');
  const comparison =
    target
      .map((value, index) =>
        value < current[index] ? -1 : value > current[index] ? 1 : 0,
      )
      .find((value) => value !== 0) ?? 0;
  const result = {
    decision: comparison <= 0 ? 'noop' : 'deploy',
    tag: previousTag,
    sha: previousSha,
    imageId: backend.Image,
    postgresId: services.postgres.Id,
  };
  if (mode === '--capture' || mode === '--verify') {
    const paths = [services.backend, services.nginx].map((container) => {
      const config =
        container.Config.Labels['com.docker.compose.project.config_files'];
      const directory =
        container.Config.Labels['com.docker.compose.project.working_dir'];
      if (
        !config ||
        config.includes(',') ||
        !isAbsolute(config) ||
        !directory ||
        !isAbsolute(directory)
      )
        fail('unsupported previous compose labels');
      return {
        compose: realpathSync(config),
        directory: realpathSync(directory),
      };
    });
    for (const path of paths) {
      same(path.compose, paths[0].compose, 'incoherent compose files');
      same(path.directory, paths[0].directory, 'incoherent working directory');
    }
    const nginx = mount(services.nginx, '/etc/nginx/conf.d');
    same(
      nginx,
      realpathSync(join(paths[0].directory, 'deploy/nginx')),
      'nginx mount mismatch',
    );
    same(
      paths[0].compose,
      join(paths[0].directory, 'compose.yml'),
      'unsupported compose path',
    );
    const generation = realpathSync(join(secrets, 'current'));
    for (const role of ['collection', 'operations']) {
      same(
        mount(backend, `/run/secrets/github_${role}_app_private_key`),
        realpathSync(join(generation, `${role}.pem`)),
        'key mount mismatch',
      );
    }
    const files = readdirSync(nginx).sort();
    if (
      !files.length ||
      files.some((name) => !statSync(join(nginx, name)).isFile())
    )
      fail('unsupported nginx directory');
    Object.assign(result, {
      compose: paths[0].compose,
      directory: paths[0].directory,
      nginx,
      generation,
      composeHash: hash(paths[0].compose),
      nginxHashes: Object.fromEntries(
        files.map((name) => [name, hash(join(nginx, name))]),
      ),
    });
    if (mode === '--capture') {
      const expectedFiles = run('git', [
        '-C',
        source,
        'ls-tree',
        '--name-only',
        `${previousSha}:deploy/nginx`,
      ])
        .split('\n')
        .sort();
      same(
        JSON.stringify(files),
        JSON.stringify(expectedFiles),
        'previous nginx inventory differs from revision',
      );
      for (const [relative, actual] of [
        ['compose.yml', paths[0].compose],
        ...files.map((name) => [`deploy/nginx/${name}`, join(nginx, name)]),
      ]) {
        const expected = execFileSync(
          'git',
          ['-C', source, 'show', `${previousSha}:${relative}`],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        if (!expected.equals(readFileSync(actual)))
          fail('previous config differs from revision');
      }
    } else {
      const previous = JSON.parse(readFileSync(source, 'utf8'));
      for (const key of [
        'tag',
        'sha',
        'imageId',
        'compose',
        'directory',
        'nginx',
        'generation',
        'composeHash',
      ])
        same(result[key], previous[key], `recovery ${key} mismatch`);
      same(
        JSON.stringify(result.nginxHashes),
        JSON.stringify(previous.nginxHashes),
        'recovery nginx bytes mismatch',
      );
    }
  } else if (mode === '--storage') {
    const values = parseDotenv(readFileSync(source, 'utf8'));
    const keys = [
      'SUBMISSION_FILE_STORAGE_MODE',
      'SUBMISSION_FILE_S3_ENDPOINT',
      'SUBMISSION_FILE_S3_REGION',
      'SUBMISSION_FILE_S3_BUCKET',
      'SUBMISSION_FILE_S3_FORCE_PATH_STYLE',
    ];
    const active = new Map(
      backend.Config.Env.map((entry) => {
        const index = entry.indexOf('=');
        return [entry.slice(0, index), entry.slice(index + 1)];
      }),
    );
    for (const key of keys) {
      if (!values.get(key)) fail('missing storage configuration');
      same(values.get(key), active.get(key), 'storage tuple mismatch');
    }
  } else if (mode !== undefined) fail('invalid mode');
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(
    `FAIL_CLOSED release_state: ${error instanceof StateError ? error.message : 'invalid input or external command failed'}`,
  );
  process.exitCode = 1;
}
