import { Router } from 'express';
import { z } from 'zod';
import { createPokerChipToken, dealCommunity, dealHands, evaluateWinner } from '../agent';
import { agentTurnContext, decideAgentAction } from '../agentPlayers';
import {
  BUY_IN_HBAR,
  addLog,
  createGameState,
  publicTable,
  queuePendingTx,
  requireGame,
  pendingTxs,
  type GameState,
  type PokerAction,
} from '../gameState';

export const gameRouter = Router();

const joinSchema = z.object({
  playerAccountId: z.string().regex(/^0\.0\.\d+$/),
});

const actionSchema = z.object({
  playerId: z.string(),
  action: z.enum(['fold', 'call', 'check', 'raise']),
  amount: z.number().min(0).optional(),
});

async function startHand(game: GameState): Promise<void> {
  const dealt = await dealHands(game.players.length);
  game.remainingDeck = dealt.remainingDeck;
  game.players.forEach((player, index) => {
    player.holeCards = dealt.hands[index] ?? [];
    player.folded = false;
    player.bet = 0;
  });
  game.communityCards = [];
  game.phase = 'preflop';
  game.activePlayer = 0;
  addLog(game, 'Cards dealt by pokerPlugin deal_hand.');
}

function applyAction(game: GameState, playerIndex: number, action: PokerAction, amount = 0): void {
  const player = game.players[playerIndex];
  if (action === 'fold') player.folded = true;
  if (action === 'raise') {
    const bet = Math.min(player.chips, Math.max(1, amount));
    player.chips -= bet;
    player.bet += bet;
  }
  if (action === 'call') {
    const currentBet = Math.max(...game.players.map((candidate) => candidate.bet));
    const callAmount = Math.min(player.chips, Math.max(0, currentBet - player.bet));
    player.chips -= callAmount;
    player.bet += callAmount;
  }
  addLog(game, `${player.name} ${action}${amount ? ` ${amount}` : ''}.`);
}

function moveStreetBetsToPot(game: GameState): void {
  const streetTotal = game.players.reduce((total, player) => total + player.bet, 0);
  game.pot = Number((game.pot + streetTotal / 100).toFixed(8));
  game.players.forEach((player) => {
    player.bet = 0;
  });
}

async function runAgentTurns(game: GameState): Promise<void> {
  for (let index = 1; index < game.players.length; index += 1) {
    const player = game.players[index];
    if (player.folded) continue;
    const decision = await decideAgentAction(agentTurnContext(game, index));
    applyAction(game, index, decision.action, decision.amount);
    addLog(game, `${player.name}: ${decision.comment}`);
  }
}

async function dealNextStreet(game: GameState): Promise<void> {
  const nextStreet = game.phase === 'preflop'
    ? 'flop'
    : game.phase === 'flop'
      ? 'turn'
      : game.phase === 'turn'
        ? 'river'
        : undefined;

  if (!nextStreet) return;

  const dealt = await dealCommunity({
    remainingDeck: game.remainingDeck,
    street: nextStreet,
    currentCommunityCards: game.communityCards,
  });

  game.communityCards = dealt.communityCards;
  game.remainingDeck = dealt.remainingDeck;
  game.phase = nextStreet;
  if (nextStreet === 'flop') {
    addLog(game, `Flop: ${game.communityCards.join(' ')}`);
  } else {
    addLog(game, `${nextStreet === 'turn' ? 'Turn' : 'River'}: ${game.communityCards[game.communityCards.length - 1] ?? ''}`);
  }
}

async function finishHand(game: GameState): Promise<void> {
  const winner = await evaluateWinner({
    hands: game.players.map((player) => player.holeCards),
    communityCards: game.communityCards,
    foldedPlayerIndexes: game.players.flatMap((player, index) => (player.folded ? [index] : [])),
  });
  game.phase = 'showdown';
  game.activePlayer = winner.winnerIndex;
  addLog(game, `${game.players[winner.winnerIndex].name} wins with ${winner.handName}.`);

  const winnerAccount = game.players[winner.winnerIndex].accountId ?? process.env.HEDERA_ACCOUNT_ID;
  const potAccount = process.env.POT_ACCOUNT_ID;
  if (!winnerAccount || !potAccount) {
    throw new Error('HEDERA_ACCOUNT_ID and POT_ACCOUNT_ID are required to queue winner payout');
  }
  const payout = queuePendingTx({
    gameId: game.id,
    from: potAccount,
    to: winnerAccount,
    amountHbar: Number(game.pot.toFixed(8)),
    purpose: 'winner-payout',
    winnerIndex: winner.winnerIndex,
  });
  game.pendingPayoutTxId = payout.txId;
  addLog(game, `Winner payout queued for confirmation: ${payout.txId}.`);
}

async function progressHand(game: GameState): Promise<void> {
  const activePlayers = game.players.filter((player) => !player.folded);
  if (activePlayers.length === 1) {
    const winnerIndex = game.players.findIndex((player) => !player.folded);
    game.phase = 'showdown';
    game.activePlayer = winnerIndex;
    addLog(game, `${game.players[winnerIndex].name} wins because everyone else folded.`);
    await finishHand(game);
    return;
  }

  moveStreetBetsToPot(game);
  if (game.phase === 'river') {
    await finishHand(game);
    return;
  }
  await dealNextStreet(game);
}

gameRouter.post('/game/new', async (_req, res, next) => {
  try {
    const token = await createPokerChipToken();
    const game = createGameState(token.tokenId, token.txId);
    res.json({ gameId: game.id, tokenId: token.tokenId, txId: token.txId, raw: token.raw });
  } catch (error) {
    next(error);
  }
});

gameRouter.post('/game/:id/join', async (req, res, next) => {
  try {
    const { playerAccountId } = joinSchema.parse(req.body);
    const game = requireGame(req.params.id);
    game.players[0].accountId = playerAccountId;
    const potAccount = process.env.POT_ACCOUNT_ID;
    if (!potAccount) throw new Error('POT_ACCOUNT_ID is required in .env');
    const pendingTx = queuePendingTx({
      gameId: game.id,
      from: playerAccountId,
      to: potAccount,
      amountHbar: BUY_IN_HBAR,
      purpose: 'buy-in',
      playerId: game.players[0].id,
    });
    addLog(game, `Buy-in pending explicit confirmation: ${pendingTx.txId}.`);
    res.json({ pending_tx: pendingTx });
  } catch (error) {
    next(error);
  }
});

gameRouter.post('/game/:id/action', async (req, res, next) => {
  try {
    const { playerId, action, amount } = actionSchema.parse(req.body);
    const game = requireGame(req.params.id);
    const playerIndex = game.players.findIndex((player) => player.id === playerId);
    if (playerIndex === -1) throw new Error(`Player ${playerId} is not seated at this table`);
    if (game.phase === 'waiting') throw new Error('Confirm the buy-in before taking a poker action');
    if (game.phase === 'showdown' || game.phase === 'complete') throw new Error('This hand has already ended');

    applyAction(game, playerIndex, action, amount);
    await runAgentTurns(game);
    await progressHand(game);
    const pendingPayout = game.pendingPayoutTxId ? pendingTxs.get(game.pendingPayoutTxId) : undefined;
    res.json({ ...publicTable(game), pending_tx: pendingPayout });
  } catch (error) {
    next(error);
  }
});

export { startHand };
