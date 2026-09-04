import pino from 'pino';

/**
 * Structured JSON logs with a request id attached (§17.1). The id is
 * propagated into queue jobs so a single trace covers API → worker → DB.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.body.password',
      'req.body.passwordConfirm',
      'res.headers["set-cookie"]',
      '*.passwordHash',
      '*.token',
      'FOOTBALL_API_TOKEN',
      'DATABASE_URL',
      'DIRECT_URL',
      'SESSION_SECRET',
    ],
    censor: '[redacted]',
  },
  ...(process.env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }
    : {}),
});

export type Logger = typeof logger;
