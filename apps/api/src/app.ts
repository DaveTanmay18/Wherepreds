import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import pinoHttp from 'pino-http';
import { logger } from './logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { v1Router } from './routes/v1/index.js';

export function createApp(opts: { webOrigin: string }): Express {
  const app = express();

  // Behind a proxy (Fly/Render), so req.ip reflects the client rather than the
  // load balancer. Session IP hashing depends on this being right.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const existing = req.headers['x-request-id'];
        const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      // Health checks every few seconds would otherwise drown the log.
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
    }),
  );

  app.use(
    cors({
      origin: opts.webOrigin,
      // Sessions are cookie-based, so the browser must be allowed to send them.
      credentials: true,
    }),
  );

  // 100kb is generous for a full round of predictions and small enough that a
  // malicious body cannot tie up memory.
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api/v1', v1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
