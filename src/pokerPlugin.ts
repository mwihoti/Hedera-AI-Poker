import { z } from 'zod';
import type { Client } from '@hiero-ledger/sdk';
import type { Context, Plugin, Tool } from '@hashgraph/hedera-agent-kit';
import type { Card, Rank, Suit } from './gameState';

export const DEAL_HAND_TOOL = 'deal_hand';
export const DEAL_COMMUNITY_TOOL = 'deal_community';
export const EVALUATE_WINNER_TOOL = 'evaluate_winner';

interface HandEvaluation {
  score: number[];
  handName: string;
}

const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const suits: Suit[] = ['C', 'D', 'H', 'S'];
const rankValue = new Map<Rank, number>(ranks.map((rank, index) => [rank, index + 2]));

const dealHandParameters = z.object({
  playerCount: z.number().int().min(2).max(10).describe('Number of poker players to deal two hole cards to.'),
});

const dealCommunityParameters = z.object({
  remainingDeck: z.array(z.string()).describe('Current deck returned by deal_hand or prior deal_community.'),
  street: z.enum(['flop', 'turn', 'river']).describe('Community-card street to deal.'),
  currentCommunityCards: z.array(z.string()).optional().describe('Community cards already on the table.'),
});

const evaluateWinnerParameters = z.object({
  hands: z.array(z.array(z.string()).length(2)).describe('Two-card hole cards for each player.'),
  communityCards: z.array(z.string()).min(5).max(5).describe('Five community cards.'),
  foldedPlayerIndexes: z.array(z.number().int().min(0)).optional().describe('Player indexes that folded before showdown.'),
});

function toCard(value: string): Card {
  if (!/^[2-9TJQKA][CDHS]$/.test(value)) {
    throw new Error(`Invalid card: ${value}`);
  }
  return value as Card;
}

function createDeck(): Card[] {
  return suits.flatMap((suit) => ranks.map((rank) => `${rank}${suit}` as Card));
}

function shuffle(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...tail] = items;
  return [
    ...combinations(tail, size - 1).map((combo) => [head, ...combo]),
    ...combinations(tail, size),
  ];
}

function compareScores(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function straightHigh(values: number[]): number | undefined {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let index = 0; index <= unique.length - 5; index += 1) {
    const window = unique.slice(index, index + 5);
    if (window[0] - window[4] === 4) return window[0];
  }
  return undefined;
}

function evaluateFive(cards: Card[]): HandEvaluation {
  const values = cards.map((card) => rankValue.get(card[0] as Rank) ?? 0).sort((a, b) => b - a);
  const flush = new Set(cards.map((card) => card[1])).size === 1;
  const straight = straightHigh(values);
  const counts = [...values.reduce<Map<number, number>>((map, value) => {
    map.set(value, (map.get(value) ?? 0) + 1);
    return map;
  }, new Map()).entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  if (flush && straight === 14) return { score: [9, 14], handName: 'Royal Flush' };
  if (flush && straight) return { score: [8, straight], handName: 'Straight Flush' };
  if (counts[0][1] === 4) {
    return { score: [7, counts[0][0], counts[1][0]], handName: 'Four of a Kind' };
  }
  if (counts[0][1] === 3 && counts[1][1] === 2) {
    return { score: [6, counts[0][0], counts[1][0]], handName: 'Full House' };
  }
  if (flush) return { score: [5, ...values], handName: 'Flush' };
  if (straight) return { score: [4, straight], handName: 'Straight' };
  if (counts[0][1] === 3) {
    return { score: [3, counts[0][0], ...counts.slice(1).map(([value]) => value)], handName: 'Three of a Kind' };
  }
  if (counts[0][1] === 2 && counts[1][1] === 2) {
    return { score: [2, counts[0][0], counts[1][0], counts[2][0]], handName: 'Two Pair' };
  }
  if (counts[0][1] === 2) {
    return { score: [1, counts[0][0], ...counts.slice(1).map(([value]) => value)], handName: 'One Pair' };
  }
  return { score: [0, ...values], handName: 'High Card' };
}

export function evaluateBestHand(cards: Card[]): HandEvaluation {
  return combinations(cards, 5)
    .map(evaluateFive)
    .sort((left, right) => compareScores(right.score, left.score))[0];
}

function createTool<TSchema extends z.AnyZodObject>(input: {
  method: string;
  name: string;
  description: string;
  parameters: TSchema;
  execute: (params: z.infer<TSchema>) => Promise<unknown>;
}): Tool {
  return {
    method: input.method,
    name: input.name,
    description: input.description,
    parameters: input.parameters,
    execute: async (_client: Client, _context: Context, params: unknown) => {
      const parsed = input.parameters.parse(params);
      const raw = await input.execute(parsed);
      return { raw, humanMessage: JSON.stringify(raw) };
    },
  };
}

export const pokerPlugin: Plugin = {
  name: 'poker-plugin',
  version: '1.0.0',
  description: 'Custom Texas Holdem tools for dealing cards and evaluating winners.',
  tools: () => [
    createTool({
      method: DEAL_HAND_TOOL,
      name: 'Deal Poker Hand',
      description: 'Shuffle a 52-card deck and deal two Texas Holdem hole cards per player.',
      parameters: dealHandParameters,
      execute: async ({ playerCount }) => {
        const deck = shuffle(createDeck());
        const hands = Array.from({ length: playerCount }, () => [deck.pop(), deck.pop()].map((card) => toCard(card ?? '')) as Card[]);
        return { hands, remainingDeck: deck };
      },
    }),
    createTool({
      method: DEAL_COMMUNITY_TOOL,
      name: 'Deal Poker Community Cards',
      description: 'Deal flop, turn, or river cards from the remaining deck.',
      parameters: dealCommunityParameters,
      execute: async ({ remainingDeck, street, currentCommunityCards }) => {
        const deck = remainingDeck.map(toCard);
        const count = street === 'flop' ? 3 : 1;
        const newCards = Array.from({ length: count }, () => toCard(deck.pop() ?? ''));
        return {
          communityCards: [...(currentCommunityCards ?? []).map(toCard), ...newCards],
          dealtCards: newCards,
          remainingDeck: deck,
        };
      },
    }),
    createTool({
      method: EVALUATE_WINNER_TOOL,
      name: 'Evaluate Poker Winner',
      description: 'Evaluate proper Holdem hand rankings from royal flush through high card.',
      parameters: evaluateWinnerParameters,
      execute: async ({ hands, communityCards, foldedPlayerIndexes }) => {
        const folded = new Set(foldedPlayerIndexes ?? []);
        const community = communityCards.map(toCard);
        const evaluations = hands.map((hand, index) => {
          if (folded.has(index)) return undefined;
          return evaluateBestHand([...hand.map(toCard), ...community]);
        });
        const winnerIndex = evaluations.reduce<number>((winner, evaluation, index) => {
          if (!evaluation) return winner;
          const current = evaluations[winner];
          if (!current) return index;
          return compareScores(evaluation.score, current.score) > 0 ? index : winner;
        }, evaluations.findIndex(Boolean));
        const winner = evaluations[winnerIndex];
        if (!winner) throw new Error('No eligible poker winner could be evaluated');
        return { winnerIndex, handName: winner.handName, evaluations };
      },
    }),
  ],
};
