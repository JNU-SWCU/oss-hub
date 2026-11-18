import { connect as connectNet, type Socket } from 'node:net';
import {
  connect as connectTls,
  type ConnectionOptions,
  type TLSSocket,
} from 'node:tls';
import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { PROGRAM_MAIL_TRANSPORT_TIMEOUT_MS } from './program-mail.config';

export interface DeadlineDigestMail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly html?: string;
}

export type MailOperation = {
  readonly promise: Promise<void>;
  readonly abort: (reason: Error) => void;
};

export interface MailSender {
  send(mail: DeadlineDigestMail, signal?: AbortSignal): Promise<void>;
  start?(mail: DeadlineDigestMail): MailOperation;
}

export const MAIL_SENDER = Symbol('NOTIFICATIONS_MAIL_SENDER');

export interface GmailSenderConfig {
  readonly sender: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly accessToken?: string;
  readonly smtp?: {
    readonly host: string;
    readonly port: number;
    readonly secure: boolean;
    readonly servername: string;
    readonly ca: string;
  };
}

type MailSocket = Socket | TLSSocket;
type MailSocketOptions = {
  readonly host?: string;
  readonly port?: number;
  readonly secure?: boolean;
  readonly servername?: string;
  readonly tls?: ConnectionOptions;
};
type MailSocketCallback = (
  error: Error | null,
  options?: {
    readonly connection: MailSocket;
    readonly secured: boolean;
  },
) => void;

@Injectable()
export class GmailMailClient implements MailSender {
  constructor(private readonly config: GmailSenderConfig) {}

  async send(mail: DeadlineDigestMail, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const operation = this.start(mail);
    const abort = () => operation.abort(this.abortError(signal));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      await operation.promise;
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  start(mail: DeadlineDigestMail): MailOperation {
    const socket: { current: MailSocket | null } = { current: null };
    let pendingSocketCallback: MailSocketCallback | null = null;
    let transporter: Transporter | null = null;
    let finished = false;
    const abort = (reason: Error) => {
      if (finished) return;
      socket.current?.destroy(reason);
      pendingSocketCallback?.(reason);
      pendingSocketCallback = null;
      transporter?.close();
    };
    const getSocket = (
      options: MailSocketOptions,
      callback: MailSocketCallback,
    ) => {
      const host = options.host ?? 'smtp.gmail.com';
      const port = options.port ?? (options.secure ? 465 : 587);
      const connection = options.secure
        ? connectTls({
            ...options.tls,
            host,
            port,
            servername: options.tls?.servername ?? options.servername ?? host,
          })
        : connectNet({ host, port });
      socket.current = connection;
      pendingSocketCallback = callback;
      const connectedEvent = options.secure ? 'secureConnect' : 'connect';
      connection.once(connectedEvent, () => {
        if (pendingSocketCallback !== callback) return;
        pendingSocketCallback = null;
        callback(null, {
          connection,
          secured: options.secure === true,
        });
      });
      connection.once('error', (error: Error) => {
        if (pendingSocketCallback !== callback) return;
        pendingSocketCallback = null;
        callback(error);
      });
    };
    transporter = this.createTransporter(getSocket);
    const promise = transporter
      .sendMail({
        from: this.config.sender,
        to: mail.to,
        subject: mail.subject,
        text: mail.body,
        html: mail.html,
      })
      .then(() => undefined)
      .finally(() => {
        finished = true;
        socket.current?.destroy();
        transporter?.close();
      });
    return { promise, abort };
  }

  private createTransporter(
    getSocket: (
      options: MailSocketOptions,
      callback: MailSocketCallback,
    ) => void,
  ): Transporter {
    return createTransport({
      ...(this.config.smtp === undefined
        ? { service: 'gmail' }
        : {
            host: this.config.smtp.host,
            port: this.config.smtp.port,
            secure: this.config.smtp.secure,
            tls: {
              servername: this.config.smtp.servername,
              ca: this.config.smtp.ca,
              rejectUnauthorized: true,
            },
          }),
      connectionTimeout: PROGRAM_MAIL_TRANSPORT_TIMEOUT_MS,
      greetingTimeout: PROGRAM_MAIL_TRANSPORT_TIMEOUT_MS,
      socketTimeout: PROGRAM_MAIL_TRANSPORT_TIMEOUT_MS,
      getSocket,
      auth: {
        type: 'OAuth2',
        user: this.config.sender,
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        refreshToken: this.config.refreshToken,
        accessToken: this.config.accessToken,
      },
    });
  }

  private abortError(signal?: AbortSignal): Error {
    return signal?.reason instanceof Error
      ? signal.reason
      : new Error('Mail delivery aborted');
  }
}

@Injectable()
export class LogMailClient implements MailSender {
  private readonly logger = new Logger('LogMailSender');

  send(mail: DeadlineDigestMail, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.logger.log(
      `[dry-run] deadline digest prepared bodyChars=${mail.body.length} htmlChars=${mail.html?.length ?? 0}`,
    );
    return Promise.resolve();
  }
}
