import { createConnection } from 'node:net';
import { networkInterfaces } from 'node:os';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  process.stderr.write('backend listener isolation: invalid port\n');
  process.exit(1);
}

const nonLoopbackAddress = Object.values(networkInterfaces())
  .flatMap((addresses) => addresses ?? [])
  .find((address) => address.family === 'IPv4' && !address.internal)?.address;

if (nonLoopbackAddress === undefined) {
  process.stderr.write(
    'backend listener isolation: no non-loopback IPv4 interface available\n',
  );
  process.exit(1);
}

const accepted = await new Promise((resolve) => {
  const socket = createConnection({ host: nonLoopbackAddress, port });
  socket.setTimeout(1_000);
  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.once('error', () => resolve(false));
  socket.once('timeout', () => {
    socket.destroy();
    resolve(false);
  });
});

if (accepted) {
  process.stderr.write(
    'backend listener isolation: backend accepted a non-loopback connection\n',
  );
  process.exit(1);
}

process.stdout.write('backend listener isolation: ok\n');
