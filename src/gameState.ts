import { randomUUID } from 'crypto';

export type Suit = 'C' | 'D' | 'H' | 'S';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
export type Card = `${Rank}${Suit}`;
export type GamePhase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
export type PokerAction = 'fold' | 'call' | 'check' | 'raise';
export type PendingTxPurpose = 'buy-in' | 'winner-payout' | 'agent-execution';
export type PendingTxStatus = 'pending' | 'confirmed';

export interface PlayerState {
  id: string;
  name: string;
  accountId?: string;
  chips: number;
  bet: number;
  folded: boolean;
  isAgent: boolean;
  holeCards: Card[];
}

export interface LogEntry {
  at: string;
  message: string;
}

export interface PendingTx {
  txId: string;
  gameId: string;
  from: string;
  to: string;
  amountHbar: number;
  purpose: PendingTxPurpose;
  status: PendingTxStatus;
  hederaTxId?: string;
  playerId?: string;
  winnerIndex?: number;
  service?: 'premium-report';
}

export interface PaidExecution {
  id: string;
  gameId: string;
  txId: string;
  hederaTxId?: string;
  service: 'premium-report';
  result: string;
  createdAt: string;
}

export interface GameState {
  id: string;
  tokenId?: string;
  tokenTxId?: string;
  phase: GamePhase;
  communityCards: Card[];
  remainingDeck: Card[];
  players: PlayerState[];
  pot: number;
  activePlayer: number;
  log: LogEntry[];
  pendingPayoutTxId?: string;
}

export const BUY_IN_HBAR = 0.5;
export const PREMIUM_REPORT_HBAR = 0.1;
export const STARTING_CHIPS = 1000;
export const games = new Map<string, GameState>();
export const pendingTxs = new Map<string, PendingTx>();
export const paidExecutions = new Map<string, PaidExecution>();

export function createGameState(tokenId?: string, tokenTxId?: string): GameState {
  const game: GameState = {
    id: randomUUID(),
    tokenId,
    tokenTxId,
    phase: 'waiting',
    communityCards: [],
    remainingDeck: [],
    players: [
      { id: 'human', name: 'You', chips: STARTING_CHIPS, bet: 0, folded: false, isAgent: false, holeCards: [] },
      { id: 'alex', name: 'Alex', chips: STARTING_CHIPS, bet: 0, folded: false, isAgent: true, holeCards: [] },
      { id: 'sam', name: 'Sam', chips: STARTING_CHIPS, bet: 0, folded: false, isAgent: true, holeCards: [] },
      { id: 'river', name: 'River', chips: STARTING_CHIPS, bet: 0, folded: false, isAgent: true, holeCards: [] },
    ],
    pot: 0,
    activePlayer: 0,
    log: [],
  };

  games.set(game.id, game);
  addLog(game, `POKER table opened${tokenId ? ` with token ${tokenId}` : ''}.`);
  return game;
}

export function addLog(game: GameState, message: string): void {
  game.log.push({ at: new Date().toISOString(), message });
  game.log = game.log.slice(-40);
}

export function requireGame(gameId: string): GameState {
  const game = games.get(gameId);
  if (!game) {
    throw new Error(`Game ${gameId} was not found`);
  }
  return game;
}

export function publicTable(game: GameState): Omit<GameState, 'remainingDeck'> {
  const { remainingDeck: _remainingDeck, ...table } = game;
  return table;
}

export function queuePendingTx(input: Omit<PendingTx, 'txId' | 'status'>): PendingTx {
  const tx: PendingTx = {
    ...input,
    txId: randomUUID(),
    status: 'pending',
  };
  pendingTxs.set(tx.txId, tx);
  return tx;
}

export function requirePendingTx(txId: string): PendingTx {
  const tx = pendingTxs.get(txId);
  if (!tx) {
    throw new Error(`Pending transaction ${txId} was not found`);
  }
  if (tx.status !== 'pending') {
    throw new Error(`Pending transaction ${txId} has already been confirmed`);
  }
  return tx;
}
