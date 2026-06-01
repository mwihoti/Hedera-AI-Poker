import type { Card, GamePhase, GameState, PokerAction } from './gameState';

export interface AgentDecision {
  action: PokerAction;
  amount: number;
  comment: string;
}

interface TextBlock {
  type?: 'text';
  text?: string;
}

interface LlamaChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | TextBlock[];
    };
  }>;
}

export interface PlayerAdvice {
  recommendation: PokerAction;
  amount: number;
  confidence: number;
  reasoning: string;
  model: string;
}

export interface TableExplanation {
  explanation: string;
  model: string;
}

const personalities = {
  Alex: 'aggressive: raises frequently, re-raises, and bluffs with big bets',
  Sam: 'tight: folds weak hands and only bets strong holdings',
  River: 'tricky: slowplays strong hands and bluffs unpredictably',
} as const;

function fallbackDecision(name: keyof typeof personalities, amountToCall: number, holeCards: Card[] = []): AgentDecision {
  const paired = holeCards.length === 2 && holeCards[0][0] === holeCards[1][0];
  if (name === 'Alex') {
    return { action: paired || amountToCall <= 25 ? 'raise' : 'call', amount: Math.max(20, amountToCall + 20), comment: 'I am putting pressure on this table.' };
  }
  if (name === 'Sam') {
    return { action: paired || amountToCall <= 25 ? (amountToCall > 0 ? 'call' : 'check') : 'fold', amount: amountToCall, comment: 'I am keeping this disciplined.' };
  }
  return { action: amountToCall > 0 ? 'call' : 'check', amount: amountToCall, comment: 'I will keep the line a little unclear.' };
}

function coerceDecision(value: unknown, amountToCall: number): AgentDecision | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const action = record.action;
  if (action !== 'fold' && action !== 'call' && action !== 'check' && action !== 'raise') return undefined;
  const amount = typeof record.amount === 'number' && Number.isFinite(record.amount) ? Math.max(0, record.amount) : 0;
  const comment = typeof record.comment === 'string' && record.comment.trim() ? record.comment.trim().slice(0, 140) : 'I act.';
  return { action, amount: action === 'call' ? amountToCall : amount, comment };
}

function coerceAdvice(value: unknown): Omit<PlayerAdvice, 'model'> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const recommendation = record.recommendation;
  if (recommendation !== 'fold' && recommendation !== 'call' && recommendation !== 'check' && recommendation !== 'raise') return undefined;
  const amount = typeof record.amount === 'number' && Number.isFinite(record.amount) ? Math.max(0, record.amount) : 0;
  const confidence = typeof record.confidence === 'number' && Number.isFinite(record.confidence)
    ? Math.max(0, Math.min(1, record.confidence))
    : 0.5;
  const reasoning = typeof record.reasoning === 'string' && record.reasoning.trim()
    ? record.reasoning.trim().slice(0, 260)
    : 'Use the lowest-risk action available from the current table state.';
  return { recommendation, amount, confidence, reasoning };
}

function llamaSettings(): { apiKey?: string; endpoint: string; model: string } {
  const baseUrl = process.env.LLAMA_CLOUD_BASE_URL ?? 'https://api.llama.com/compat/v1';
  return {
    apiKey: process.env.LLAMA_CLOUD_API_KEY,
    endpoint: `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    model: process.env.LLAMA_CLOUD_MODEL ?? 'Llama-3.3-70B-Instruct',
  };
}

async function callLlama(input: {
  system: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
}): Promise<{ text?: string; model: string }> {
  const settings = llamaSettings();
  if (!settings.apiKey) {
    return { model: `${settings.model} (fallback: missing LLAMA_CLOUD_API_KEY)` };
  }

  const response = await fetch(settings.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Llama Cloud API returned ${response.status}`);
  }

  const data = (await response.json()) as LlamaChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  return {
    model: settings.model,
    text: typeof content === 'string'
      ? content
      : content?.find((block) => block.type === 'text')?.text,
  };
}

export async function decideAgentAction(input: {
  name: keyof typeof personalities;
  phase: GamePhase;
  chips: number;
  pot: number;
  amountToCall: number;
  holeCards: Card[];
  communityCards: Card[];
  lastActions: string[];
}): Promise<AgentDecision> {
  const prompt = [
    `You are ${input.name}, a Texas Holdem poker opponent. Personality: ${personalities[input.name]}.`,
    'Respond only with JSON: {"action":"fold"|"call"|"check"|"raise","amount":0,"comment":"one sentence"}',
    `Phase: ${input.phase}`,
    `Chip count: ${input.chips}`,
    `Pot: ${input.pot}`,
    `Amount to call: ${input.amountToCall}`,
    `Your hole cards: ${input.holeCards.join(' ')}`,
    `Visible community cards: ${input.communityCards.join(' ') || 'none'}`,
    `Last actions: ${input.lastActions.join(' | ') || 'none'}`,
  ].join('\n');

  try {
    const result = await callLlama({
      system: 'You are a poker opponent. Return only valid JSON with no markdown.',
      prompt,
      maxTokens: 120,
      temperature: 0.7,
    });
    const text = result.text ?? '';
    const parsed = JSON.parse(text) as unknown;
    return coerceDecision(parsed, input.amountToCall) ?? fallbackDecision(input.name, input.amountToCall, input.holeCards);
  } catch {
    return fallbackDecision(input.name, input.amountToCall, input.holeCards);
  }
}

export function agentTurnContext(game: GameState, playerIndex: number): Parameters<typeof decideAgentAction>[0] {
  const player = game.players[playerIndex];
  const amountToCall = Math.max(...game.players.map((candidate) => candidate.bet)) - player.bet;
  const name = player.name === 'Alex' || player.name === 'Sam' || player.name === 'River' ? player.name : 'River';
  return {
    name,
    phase: game.phase,
    chips: player.chips,
    pot: game.pot,
    amountToCall,
    holeCards: player.holeCards,
    communityCards: game.communityCards,
    lastActions: game.log.slice(-4).map((entry) => entry.message),
  };
}

export async function getPlayerAdvice(game: GameState): Promise<PlayerAdvice> {
  const player = game.players[0];
  const amountToCall = Math.max(...game.players.map((candidate) => candidate.bet)) - player.bet;
  const prompt = [
    'Give one Texas Holdem recommendation for the human player.',
    'Respond only with JSON: {"recommendation":"fold"|"call"|"check"|"raise","amount":0,"confidence":0.0,"reasoning":"one concise sentence"}',
    `Phase: ${game.phase}`,
    `Human hole cards: ${player.holeCards.join(' ') || 'none'}`,
    `Human chips: ${player.chips}`,
    `Pot: ${game.pot}`,
    `Amount to call: ${amountToCall}`,
    `Community cards: ${game.communityCards.join(' ') || 'none'}`,
    `Opponents: ${game.players.slice(1).map((opponent) => `${opponent.name} chips=${opponent.chips} bet=${opponent.bet} folded=${opponent.folded}`).join('; ')}`,
    `Recent actions: ${game.log.slice(-8).map((entry) => entry.message).join(' | ') || 'none'}`,
  ].join('\n');

  try {
    const result = await callLlama({
      system: 'You are a concise poker coach. Return only valid JSON with no markdown.',
      prompt,
      maxTokens: 160,
      temperature: 0.35,
    });
    if (!result.text) {
      return {
        recommendation: amountToCall > 0 ? 'call' : 'check',
        amount: amountToCall,
        confidence: 0.45,
        reasoning: 'Llama key is not configured, so the fallback keeps the hand moving with a low-risk action.',
        model: result.model,
      };
    }
    const advice = coerceAdvice(JSON.parse(result.text) as unknown);
    if (!advice) throw new Error('Llama returned invalid advice JSON');
    return { ...advice, model: result.model };
  } catch (error) {
    return {
      recommendation: amountToCall > 0 ? 'call' : 'check',
      amount: amountToCall,
      confidence: 0.35,
      reasoning: `Fallback advice used because Llama advice failed: ${error instanceof Error ? error.message : String(error)}`,
      model: `${llamaSettings().model} (fallback)`,
    };
  }
}

export async function explainTable(game: GameState): Promise<TableExplanation> {
  const human = game.players[0];
  const amountToCall = Math.max(...game.players.map((candidate) => candidate.bet)) - human.bet;
  const prompt = [
    'Explain this Hedera AI Poker table to a player who is looking at the UI.',
    'Use concise beginner-friendly bullets.',
    'Explain: phase, pot, every player visible hole cards, how Texas Holdem winner is decided, who currently looks strongest, and what the action buttons mean now.',
    'In this demo all hole cards are visible, so compare all players directly. Mention that real poker normally hides opponent hole cards.',
    `Phase: ${game.phase}`,
    `Pot HBAR: ${game.pot}`,
    `Human cards: ${human.holeCards.join(' ') || 'not dealt yet'}`,
    `Human chips: ${human.chips}`,
    `Human current bet: ${human.bet}`,
    `Amount to call: ${amountToCall}`,
    `Community cards: ${game.communityCards.join(' ') || 'none yet'}`,
    `Players: ${game.players.map((player) => `${player.name} cards=${player.holeCards.join(' ') || 'none'} chips=${player.chips} bet=${player.bet} folded=${player.folded}`).join('; ')}`,
    `Recent log: ${game.log.slice(-8).map((entry) => entry.message).join(' | ') || 'none'}`,
  ].join('\n');

  try {
    const result = await callLlama({
      system: 'You explain poker UI state clearly and concisely. Return plain text only.',
      prompt,
      maxTokens: 220,
      temperature: 0.25,
    });

    if (result.text?.trim()) {
      return { explanation: result.text.trim(), model: result.model };
    }

    return {
      explanation: fallbackTableExplanation(game, amountToCall),
      model: result.model,
    };
  } catch (error) {
    return {
      explanation: `${fallbackTableExplanation(game, amountToCall)}\n\nLlama fallback note: ${error instanceof Error ? error.message : String(error)}`,
      model: `${llamaSettings().model} (fallback)`,
    };
  }
}

export async function generatePremiumReport(game: GameState): Promise<TableExplanation> {
  const human = game.players[0];
  const amountToCall = Math.max(...game.players.map((candidate) => candidate.bet)) - human.bet;
  const prompt = [
    'Create a paid premium Texas Holdem report for this Hedera AI Poker hand.',
    'Use concise sections: Table State, Player Comparison, Best Current Move, Payment Execution Proof.',
    'Explain every visible player hand, likely winner from visible cards, and why the recommendation is commercially valuable.',
    'Mention that the report was executed only after confirmed HBAR payment.',
    `Phase: ${game.phase}`,
    `Pot HBAR: ${game.pot}`,
    `Human cards: ${human.holeCards.join(' ') || 'not dealt yet'}`,
    `Human chips: ${human.chips}`,
    `Human current bet: ${human.bet}`,
    `Amount to call: ${amountToCall}`,
    `Community cards: ${game.communityCards.join(' ') || 'none yet'}`,
    `Players: ${game.players.map((player) => `${player.name} cards=${player.holeCards.join(' ') || 'none'} chips=${player.chips} bet=${player.bet} folded=${player.folded}`).join('; ')}`,
    `Recent log: ${game.log.slice(-10).map((entry) => entry.message).join(' | ') || 'none'}`,
  ].join('\n');

  try {
    const result = await callLlama({
      system: 'You are a premium poker analytics agent. Return plain text only.',
      prompt,
      maxTokens: 420,
      temperature: 0.28,
    });

    if (result.text?.trim()) {
      return { explanation: result.text.trim(), model: result.model };
    }

    return {
      explanation: fallbackPremiumReport(game, amountToCall),
      model: result.model,
    };
  } catch (error) {
    return {
      explanation: `${fallbackPremiumReport(game, amountToCall)}\n\nLlama fallback note: ${error instanceof Error ? error.message : String(error)}`,
      model: `${llamaSettings().model} (fallback)`,
    };
  }
}

function fallbackTableExplanation(game: GameState, amountToCall: number): string {
  const human = game.players[0];
  const board = game.communityCards.length ? game.communityCards.join(' ') : 'no community cards yet';
  const visibleHands = game.players.map((player) => `${player.name}: ${player.holeCards.join(' ') || 'not dealt'}`).join('; ');
  const strongest = estimateVisibleLeader(game);
  return [
    `- Phase: ${game.phase}. You are ${game.phase === 'preflop' ? 'acting before the flop' : 'continuing the current street'}.`,
    `- Pot: ${game.pot} HBAR. Your cards are ${human.holeCards.join(' ') || 'not dealt yet'} and the board is ${board}.`,
    `- Visible hands: ${visibleHands}. Real poker hides opponent cards; this demo shows them so the AI table can be inspected.`,
    `- How to win: each player makes the best 5-card hand from 2 hole cards plus 5 community cards. Rankings go high card, pair, two pair, three of a kind, straight, flush, full house, four of a kind, straight flush, royal flush.`,
    `- Current visible favorite: ${strongest}. Preflop odds are only an estimate because the flop, turn, and river can change everything.`,
    `- Bets: you have ${human.bet} chips committed; the amount to call is ${amountToCall}.`,
    '- Buttons: Check if no call is required, Call to match the current bet, Raise 25 to add pressure, or Fold to exit the hand.',
  ].join('\n');
}

function fallbackPremiumReport(game: GameState, amountToCall: number): string {
  const human = game.players[0];
  return [
    'Table State',
    `The hand is in ${game.phase}. The pot is ${game.pot} HBAR, your visible hand is ${human.holeCards.join(' ') || 'not dealt'}, and the board is ${game.communityCards.join(' ') || 'not dealt yet'}.`,
    '',
    'Player Comparison',
    game.players.map((player) => `${player.name}: ${player.holeCards.join(' ') || 'not dealt'} with ${player.chips} chips and ${player.bet} committed.`).join('\n'),
    '',
    'Best Current Move',
    `The current amount to call is ${amountToCall}. ${estimateVisibleLeader(game)} based on visible starting-card shape.`,
    '',
    'Payment Execution Proof',
    'This report is generated only after the HBAR payment confirmation route settles the paid action.',
  ].join('\n');
}

function estimateVisibleLeader(game: GameState): string {
  const scored = game.players
    .filter((player) => !player.folded && player.holeCards.length === 2)
    .map((player) => ({ name: player.name, score: preflopScore(player.holeCards) }))
    .sort((left, right) => right.score - left.score);
  const leader = scored[0];
  if (!leader) return 'not enough cards are visible yet';
  return `${leader.name} has the best visible starting shape`;
}

function preflopScore(cards: Card[]): number {
  const values = cards.map((card) => cardValue(card[0])).sort((left, right) => right - left);
  const suited = cards[0][1] === cards[1][1] ? 3 : 0;
  const pair = values[0] === values[1] ? 20 + values[0] : 0;
  const connected = Math.abs(values[0] - values[1]) <= 1 ? 3 : 0;
  return pair + values[0] * 2 + values[1] + suited + connected;
}

function cardValue(rank: string): number {
  return '23456789TJQKA'.indexOf(rank) + 2;
}
