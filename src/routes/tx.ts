import { Router } from 'express';
import { z } from 'zod';
import { transferHbar } from '../agent';
import { BUY_IN_HBAR, addLog, requireGame, requirePendingTx } from '../gameState';
import { startHand } from './game';

export const txRouter = Router();

const confirmSchema = z.object({
  txId: z.string().min(1),
});

txRouter.post('/tx/confirm', async (req, res, next) => {
  try {
    const { txId } = confirmSchema.parse(req.body);
    const pendingTx = requirePendingTx(txId);
    const game = requireGame(pendingTx.gameId);

    const transfer = await transferHbar({
      from: pendingTx.from,
      to: pendingTx.to,
      amountHbar: pendingTx.amountHbar,
      purpose: pendingTx.purpose,
    });

    pendingTx.status = 'confirmed';
    pendingTx.hederaTxId = transfer.hederaTxId;

    if (pendingTx.purpose === 'buy-in') {
      game.pot = Number((game.pot + pendingTx.amountHbar).toFixed(8));
      game.players[0].chips -= Math.round(BUY_IN_HBAR * 100);
      addLog(game, `Buy-in confirmed on Hedera: ${transfer.hederaTxId ?? 'transaction submitted'}.`);
      if (game.phase === 'waiting') {
        await startHand(game);
      }
    }

    if (pendingTx.purpose === 'winner-payout') {
      game.phase = 'complete';
      game.pot = 0;
      addLog(game, `Winner payout confirmed on Hedera: ${transfer.hederaTxId ?? 'transaction submitted'}.`);
    }

    res.json({ confirmed: true, hederaTxId: transfer.hederaTxId, pending_tx: pendingTx, raw: transfer.raw });
  } catch (error) {
    next(error);
  }
});
