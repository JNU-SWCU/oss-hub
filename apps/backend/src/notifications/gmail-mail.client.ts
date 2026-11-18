import { connect as connectNet, type Socket } from 'node:net';
import { connect as connectTls, type TLSSocket } from 'node:tls';
import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { PROGRAM_MAIL_TRANSPORT_TIMEOUT_MS } from './program-mail.config';

export interface DeadlineDigestMail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly html?: string;
}

export interface MailSender {
  send(mail: DeadlineDigestMail, signal?: AbortSignal): Promise<void>;
}

export const MAIL_SENDER = Symbol('NOTIFICATIONS_MAIL_SENDER');

export interface GmailSenderConfig {
  readonly sender: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

type MailSocket = Socket | TLSSocket;
type MailSocketOptions = {
  readonly host?: string;
  readonly port?: number;
  readonly secure?: boolean;
  readonly servername?: string;
};
type MailSocketCallback = (
  error: Error | null,
  options?: { readonly connection: MailSocket },
) => void;

@Injectable()
export class GmailMailClient implements MailSender {
  constructor(private readonly config: GmailSenderConfig) {}

  async send(mail: DeadlineDigestMail, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const socket: { current: MailSocket | null } = { current: null };
    let pendingSocketCallback: MailSocketCallback | null = null;
    let transporter: Transporter | null = null;
    const abort = () => {
      const error = this.abortError(signal);
      socket.current?.destroy(error);
      pendingSocketCallback?.(error);
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
            host,
            port,
            servername: options.servername ?? host,
          })
        : connectNet({ host, port });
      socket.current = connection;
      pendingSocketCallback = callback;
      const connectedEvent = options.secure ? 'secureConnect' : 'connect';
      connection.once(connectedEvent, () => {
        if (pendingSocketCallback !== callback) return;
        pendingSocketCallback = null;
        callback(null, { connection });
      });
      connection.once('error', (error: Error) => {
        if (pendingSocketCallback !== callback) return;
        pendingSocketCallback = null;
        callback(error);
      });
      if (signal?.aborted) abort();
    };
    transporter = this.createTransporter(getSocket);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      await transporter.sendMail({
        from: this.config.sender,
        to: mail.to,
        subject: mail.subject,
        text: mail.body,
        html: mail.html,
      });
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener('abort', abort);
      socket.current?.destroy();
      transporter.close();
    }
  }

  private createTransporter(
    getSocket: (
      options: MailSocketOptions,
      callback: MailSocketCallback,
    ) => void,
  ): Transporter {
    return createTransport({
      service: 'gmail',
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
