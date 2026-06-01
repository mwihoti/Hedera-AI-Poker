import { Buffer } from 'buffer';
import { Router } from 'express';
import { z } from 'zod';
import {
  PREMIUM_REPORT_HBAR,
  paidExecutions,
  queuePendingTx,
  requireGame,
} from '../gameState';

export const paidAgentRouter = Router();

const paidReportSchema = z.object({
  playerAccountId: z.string().regex(/^0\.0\.\d+$/),
});

function paymentRequirement(gameId: string): Record<string, unknown> {
  const resource = `/agent/paid-report/${gameId}`;
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: 'hedera-testnet',
        asset: 'HBAR',
        maxAmountRequired: PREMIUM_REPORT_HBAR.toString(),
        resource,
        description: 'Paid Llama premium poker analytics report executed by Hedera AI Poker.',
        payTo: process.env.POT_ACCOUNT_ID ?? 'configure-POT_ACCOUNT_ID',
        mimeType: 'application/json',
      },
    ],
  };
}

paidAgentRouter.get('/agent/paid-report/:id', (req, res, next) => {
  try {
    requireGame(req.params.id);
    const requirement = paymentRequirement(req.params.id);
    res
      .status(402)
      .setHeader('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(requirement)).toString('base64'))
      .json({
        error: 'Payment Required',
        message: 'Queue and confirm the HBAR payment to execute the premium agent report.',
        paymentRequired: requirement,
        hbarFlow: {
          queue: `POST /agent/paid-report/${req.params.id}/pay`,
          confirm: 'POST /tx/confirm',
        },
      });
  } catch (error) {
    next(error);
  }
});

paidAgentRouter.post('/agent/paid-report/:id/pay', (req, res, next) => {
  try {
    const { playerAccountId } = paidReportSchema.parse(req.body);
    const game = requireGame(req.params.id);
    const potAccount = process.env.POT_ACCOUNT_ID;
    if (!potAccount) throw new Error('POT_ACCOUNT_ID is required in .env');

    const pendingTx = queuePendingTx({
      gameId: game.id,
      from: playerAccountId,
      to: potAccount,
      amountHbar: PREMIUM_REPORT_HBAR,
      purpose: 'agent-execution',
      playerId: game.players[0].id,
      service: 'premium-report',
    });

    res.json({
      pending_tx: pendingTx,
      paymentRequired: paymentRequirement(game.id),
      execution: {
        service: 'premium-report',
        status: 'waiting-for-confirmation',
      },
    });
  } catch (error) {
    next(error);
  }
});

paidAgentRouter.get('/agent/executions/:txId', (req, res, next) => {
  try {
    const execution = paidExecutions.get(req.params.txId);
    if (!execution) throw new Error(`Paid execution ${req.params.txId} was not found`);
    res.json(execution);
  } catch (error) {
    next(error);
  }
});
