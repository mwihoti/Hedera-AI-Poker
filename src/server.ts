import 'dotenv/config';
import path from 'path';
import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { gameRouter } from './routes/game';
import { paidAgentRouter } from './routes/paidAgent';
import { tableRouter } from './routes/table';
import { txRouter } from './routes/tx';

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/api', (_req, res) => {
  res.json({
    name: 'Hedera AI Poker',
    status: 'ok',
    routes: [
      'GET /health',
      'POST /game/new',
      'GET /table/:id',
      'GET /table/:id/price',
      'GET /table/:id/advice',
      'GET /table/:id/explain',
      'GET /agent/paid-report/:id',
      'POST /agent/paid-report/:id/pay',
      'GET /agent/executions/:txId',
      'POST /game/:id/join',
      'POST /tx/confirm',
      'POST /game/:id/action',
    ],
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use(gameRouter);
app.use(tableRouter);
app.use(paidAgentRouter);
app.use(txRouter);

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  res.status(400).json({ error: message });
};

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Hedera AI Poker API listening on http://localhost:${port}`);
});
