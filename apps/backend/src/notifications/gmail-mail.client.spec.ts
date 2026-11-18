import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type TLSSocket } from 'node:tls';
import { GmailMailClient } from './gmail-mail.client';

describe('GmailMailClient custom socket', () => {
  it('completes one verified implicit-TLS handshake and SMTP delivery', async () => {
    const certificates = testCertificates();
    let handshakes = 0;
    let messages = 0;
    const server = createServer(
      { key: certificates.key, cert: certificates.cert },
      (socket) => {
        handshakes += 1;
        serveSmtp(socket, () => {
          messages += 1;
        });
      },
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing SMTP test server address');
    }
    const client = new GmailMailClient({
      sender: 'sender@example.test',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      accessToken: 'test-access-token',
      smtp: {
        host: '127.0.0.1',
        port: address.port,
        secure: true,
        servername: 'localhost',
        ca: certificates.ca,
      },
    });

    try {
      await client.send({
        to: 'recipient@example.test',
        subject: 'TLS test',
        body: 'verified body',
      });
      expect(handshakes).toBe(1);
      expect(messages).toBe(1);
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('destroys the verified TLS socket when an operation is aborted', async () => {
    const certificates = testCertificates();
    const connected = deferred<TLSSocket>();
    const server = createServer(
      { key: certificates.key, cert: certificates.cert },
      (socket) => connected.resolve(socket),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing SMTP test server address');
    }
    const client = new GmailMailClient({
      sender: 'sender@example.test',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      accessToken: 'test-access-token',
      smtp: {
        host: '127.0.0.1',
        port: address.port,
        secure: true,
        servername: 'localhost',
        ca: certificates.ca,
      },
    });
    try {
      const operation = client.start({
        to: 'recipient@example.test',
        subject: 'abort test',
        body: 'body',
      });
      const socket = await connected.promise;
      const closed = new Promise<void>((resolve) => {
        socket.once('close', () => resolve());
      });
      socket.on('error', () => undefined);
      operation.abort(new Error('synthetic deadline'));

      await expect(operation.promise).rejects.toThrow();
      await closed;
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
} {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function testCertificates(): {
  readonly ca: string;
  readonly cert: string;
  readonly key: string;
} {
  const directory = mkdtempSync(join(tmpdir(), 'oss-hub-smtp-'));
  try {
    const ca = join(directory, 'ca.pem');
    const caKey = join(directory, 'ca-key.pem');
    const key = join(directory, 'server-key.pem');
    const request = join(directory, 'server.csr');
    const extension = join(directory, 'server.ext');
    const cert = join(directory, 'server-cert.pem');
    const openssl = (arguments_: readonly string[]) =>
      execFileSync('openssl', arguments_, { stdio: 'ignore' });
    openssl([
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=oss-hub test SMTP CA',
      '-keyout',
      caKey,
      '-out',
      ca,
    ]);
    openssl([
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-subj',
      '/CN=localhost',
      '-keyout',
      key,
      '-out',
      request,
    ]);
    writeFileSync(
      extension,
      'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n',
    );
    openssl([
      'x509',
      '-req',
      '-in',
      request,
      '-CA',
      ca,
      '-CAkey',
      caKey,
      '-CAcreateserial',
      '-days',
      '1',
      '-extfile',
      extension,
      '-out',
      cert,
    ]);
    return {
      ca: readFileSync(ca, 'utf8'),
      cert: readFileSync(cert, 'utf8'),
      key: readFileSync(key, 'utf8'),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function serveSmtp(socket: TLSSocket, onMessage: () => void): void {
  let buffer = '';
  let dataMode = false;
  socket.setEncoding('utf8');
  socket.write('220 localhost ESMTP\r\n');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    if (dataMode) {
      const end = buffer.indexOf('\r\n.\r\n');
      if (end === -1) return;
      buffer = buffer.slice(end + 5);
      dataMode = false;
      onMessage();
      socket.write('250 2.0.0 queued\r\n');
    }
    let newline = buffer.indexOf('\r\n');
    while (!dataMode && newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 2);
      const command = line.split(' ', 1)[0]?.toUpperCase();
      if (command === 'EHLO') {
        socket.write('250-localhost\r\n250-AUTH XOAUTH2\r\n250 PIPELINING\r\n');
      } else if (command === 'AUTH') {
        socket.write('235 2.7.0 accepted\r\n');
      } else if (command === 'DATA') {
        dataMode = true;
        socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
      } else if (command === 'QUIT') {
        socket.end('221 2.0.0 bye\r\n');
      } else {
        socket.write('250 2.1.0 accepted\r\n');
      }
      newline = buffer.indexOf('\r\n');
    }
  });
}
