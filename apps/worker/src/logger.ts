import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'worker' },
  redact: {
    paths: ['FOOTBALL_API_TOKEN', 'DATABASE_URL', 'DIRECT_URL', '*.token'],
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
