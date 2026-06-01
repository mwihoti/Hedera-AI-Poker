import { Router } from 'express';
import { getHbarUsdPrice } from '../agent';
import { explainTable, getPlayerAdvice } from '../agentPlayers';
import { BUY_IN_HBAR, publicTable, requireGame } from '../gameState';

export const tableRouter = Router();

gameTableRoutes();

function gameTableRoutes(): void {
  tableRouter.get('/table/:id', (req, res, next) => {
    try {
      res.json(publicTable(requireGame(req.params.id)));
    } catch (error) {
      next(error);
    }
  });

  tableRouter.get('/table/:id/price', async (req, res, next) => {
    try {
      requireGame(req.params.id);
      const price = await getHbarUsdPrice();
      res.json({
        hbarUsd: price.hbarUsd,
        buyInHbar: BUY_IN_HBAR,
        buyInUsd: Number((price.hbarUsd * BUY_IN_HBAR).toFixed(2)),
        display: `Buy in: ${BUY_IN_HBAR} HBAR ≈ $${(price.hbarUsd * BUY_IN_HBAR).toFixed(2)}`,
        raw: price.raw,
      });
    } catch (error) {
      next(error);
    }
  });

  tableRouter.get('/table/:id/advice', async (req, res, next) => {
    try {
      const game = requireGame(req.params.id);
      const advice = await getPlayerAdvice(game);
      res.json(advice);
    } catch (error) {
      next(error);
    }
  });

  tableRouter.get('/table/:id/explain', async (req, res, next) => {
    try {
      const game = requireGame(req.params.id);
      const explanation = await explainTable(game);
      res.json(explanation);
    } catch (error) {
      next(error);
    }
  });
}
