import 'dotenv/config';
import { Client, PrivateKey } from '@hiero-ledger/sdk';
import { AgentMode } from '@hashgraph/hedera-agent-kit';
import { coreAccountPlugin, coreTokenPlugin, coreTokenQueryPlugin } from '@hashgraph/hedera-agent-kit/plugins';
import { HederaLangchainToolkit } from '@hashgraph/hedera-agent-kit-langchain';
import { pythPlugin as PythPlugin } from 'hak-pyth-plugin';
import { pokerPlugin } from './pokerPlugin';
import type { Card } from './gameState';

interface InvokableTool {
  name?: string;
  method?: string;
  invoke?: (input: unknown) => Promise<unknown>;
  call?: (input: unknown) => Promise<unknown>;
}

interface TokenCreationResult {
  tokenId?: string;
  txId?: string;
  raw: unknown;
}

interface HbarTransferResult {
  hederaTxId?: string;
  raw: unknown;
}

interface PriceResult {
  hbarUsd: number;
  raw: unknown;
}

export interface AgentExecutorLike {
  invoke: (input: { input: string }) => Promise<{ output: string }>;
}

let toolkit: HederaLangchainToolkit | undefined;
const accountToolkits = new Map<string, HederaLangchainToolkit>();
export const agentExecutor: AgentExecutorLike = {
  invoke: async ({ input }) => ({ output: `Hedera AI Poker uses direct toolkit invocation for deterministic bounty actions: ${input}` }),
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required in .env`);
  }
  return value;
}

function parsePrivateKey(key: string, keyType: string): PrivateKey {
  const normalizedKey = key.startsWith('0x') ? key.slice(2) : key;
  if (keyType === 'ECDSA') {
    return PrivateKey.fromStringECDSA(normalizedKey);
  }
  return PrivateKey.fromString(normalizedKey);
}

function createClient(accountId: string, privateKey: string, keyType: string): Client {
  return Client.forTestnet().setOperator(
    accountId,
    parsePrivateKey(privateKey, keyType),
  );
}

function createToolkit(client: Client): HederaLangchainToolkit {
  return new HederaLangchainToolkit({
      client,
      configuration: {
        plugins: [
          coreAccountPlugin,
          coreTokenPlugin,
          coreTokenQueryPlugin,
          PythPlugin,
          pokerPlugin,
        ],
        context: { mode: AgentMode.AUTONOMOUS },
      },
    });
}

export function getToolkit(): HederaLangchainToolkit {
  if (!toolkit) {
    toolkit = createToolkit(createClient(
      requiredEnv('HEDERA_ACCOUNT_ID'),
      requiredEnv('HEDERA_PRIVATE_KEY'),
      process.env.HEDERA_KEY_TYPE ?? 'ECDSA',
    ));
  }
  return toolkit;
}

function getToolkitForAccount(accountId: string): HederaLangchainToolkit {
  const operatorAccountId = requiredEnv('HEDERA_ACCOUNT_ID');
  if (accountId === operatorAccountId) {
    return getToolkit();
  }

  const potAccountId = process.env.POT_ACCOUNT_ID;
  if (potAccountId && accountId === potAccountId) {
    const cached = accountToolkits.get(accountId);
    if (cached) return cached;
    const potPrivateKey = requiredEnv('POT_PRIVATE_KEY');
    const created = createToolkit(createClient(accountId, potPrivateKey, process.env.POT_KEY_TYPE ?? 'ED25519'));
    accountToolkits.set(accountId, created);
    return created;
  }

  throw new Error(`No private key configured for source account ${accountId}`);
}

export async function getAgentExecutor(): Promise<AgentExecutorLike> {
  return agentExecutor;
}

function normalizeName(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getTools(selectedToolkit = getToolkit()): InvokableTool[] {
  return selectedToolkit.getTools().map((tool) => tool as InvokableTool);
}

async function invokeTool(partials: string[], input: unknown, selectedToolkit = getToolkit()): Promise<unknown> {
  const normalizedPartials = partials.map(normalizeName);
  const tool = getTools(selectedToolkit).find((candidate) => {
    const name = normalizeName(candidate.name);
    const method = normalizeName(candidate.method);
    return normalizedPartials.some((partial) => name.includes(partial) || method.includes(partial));
  });

  if (!tool) {
    throw new Error(`Hedera Agent Kit tool not found. Tried: ${partials.join(', ')}`);
  }

  if (tool.invoke) return tool.invoke(input);
  if (tool.call) return tool.call(input);
  throw new Error(`Tool ${tool.name ?? tool.method ?? 'unknown'} is not invokable`);
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(collectStrings);
  }
  return [];
}

function unwrapToolResult(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return unwrapToolResult(JSON.parse(value) as unknown);
    } catch {
      return value;
    }
  }
  if (value && typeof value === 'object' && 'raw' in value) {
    return unwrapToolResult((value as Record<string, unknown>).raw);
  }
  return value;
}

function findField(value: unknown, fieldNames: string[]): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const fieldName of fieldNames) {
    const field = record[fieldName];
    if (typeof field === 'string') return field;
    if (field && typeof field === 'object' && 'toString' in field && typeof field.toString === 'function') {
      const text = field.toString();
      if (text !== '[object Object]') return text;
    }
  }
  for (const nested of Object.values(record)) {
    const found = findField(nested, fieldNames);
    if (found) return found;
  }
  return undefined;
}

function accountLikeFromText(value: unknown): string | undefined {
  return collectStrings(value)
    .map((text) => text.match(/\b0\.0\.\d+\b/)?.[0])
    .find((match): match is string => Boolean(match));
}

function parsePrice(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 10) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) && parsed > 0 && parsed < 10 ? parsed : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const price = parsePrice(item);
      if (price) return price;
    }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['price', 'hbarUsd', 'usdPrice', 'currentPrice']) {
      const price = parsePrice(record[key]);
      if (price) return price;
    }
    for (const item of Object.values(record)) {
      const price = parsePrice(item);
      if (price) return price;
    }
  }
  return undefined;
}

/**
 * Calls CREATE_FUNGIBLE_TOKEN_TOOL from coreTokenPlugin to mint POKER chips as an HTS display/score token.
 */
export async function createPokerChipToken(): Promise<TokenCreationResult> {
  try {
    const rawResult = await invokeTool(['createfungibletokentool', 'createfungibletoken'], {
      tokenName: 'POKER CHIPS',
      tokenSymbol: 'POKER',
      initialSupply: 1000000,
      supplyType: 'finite',
      maxSupply: 1000000,
      decimals: 0,
    });
    const raw = unwrapToolResult(rawResult);
    return {
      tokenId: findField(raw, ['tokenId', 'token_id']) ?? accountLikeFromText(raw),
      txId: findField(raw, ['transactionId', 'txId', 'hederaTxId']),
      raw,
    };
  } catch (error) {
    throw new Error(`CREATE_FUNGIBLE_TOKEN_TOOL failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Calls TRANSFER_HBAR_TOOL from coreAccountPlugin only after /tx/confirm approves a pending buy-in or payout.
 */
export async function transferHbar(input: {
  from: string;
  to: string;
  amountHbar: number;
  purpose: string;
}): Promise<HbarTransferResult> {
  try {
    const selectedToolkit = getToolkitForAccount(input.from);
    const rawResult = await invokeTool(['transferhbartool', 'transferhbar'], {
      sourceAccountId: input.from,
      transfers: [{ accountId: input.to, amount: input.amountHbar }],
      transactionMemo: `Hedera AI Poker ${input.purpose}`,
    }, selectedToolkit);
    const raw = unwrapToolResult(rawResult);
    return {
      hederaTxId: findField(raw, ['transactionId', 'txId', 'hederaTxId']) ?? collectStrings(raw).find((text) => text.includes('@')),
      raw,
    };
  } catch (error) {
    throw new Error(`TRANSFER_HBAR_TOOL failed for ${input.purpose}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function getHbarUsdPrice(): Promise<PriceResult> {
  try {
    const rawResult = await invokeTool(['pythgetlatestprice', 'pythlatestprice', 'pythprice'], {
      symbol: 'HBAR/USD',
    });
    const raw = unwrapToolResult(rawResult);
    const hbarUsd = parsePrice(raw);
    if (!hbarUsd) {
      throw new Error('Pyth plugin did not return a parseable HBAR/USD price');
    }
    return { hbarUsd, raw };
  } catch (error) {
    throw new Error(`PythPlugin HBAR/USD price lookup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function dealHands(playerCount: number): Promise<{ hands: Card[][]; remainingDeck: Card[] }> {
  const record = unwrapToolResult(await invokeTool(['dealhand'], { playerCount }));
  if (!record || typeof record !== 'object') throw new Error('deal_hand returned an invalid payload');
  const output = record as Record<string, unknown>;
  return {
    hands: (output.hands as Card[][] | undefined) ?? [],
    remainingDeck: (output.remainingDeck as Card[] | undefined) ?? [],
  };
}

export async function dealCommunity(input: {
  remainingDeck: Card[];
  street: 'flop' | 'turn' | 'river';
  currentCommunityCards: Card[];
}): Promise<{ communityCards: Card[]; remainingDeck: Card[] }> {
  const record = unwrapToolResult(await invokeTool(['dealcommunity'], input));
  if (!record || typeof record !== 'object') throw new Error('deal_community returned an invalid payload');
  const output = record as Record<string, unknown>;
  return {
    communityCards: (output.communityCards as Card[] | undefined) ?? [],
    remainingDeck: (output.remainingDeck as Card[] | undefined) ?? [],
  };
}

export async function evaluateWinner(input: {
  hands: Card[][];
  communityCards: Card[];
  foldedPlayerIndexes: number[];
}): Promise<{ winnerIndex: number; handName: string }> {
  const record = unwrapToolResult(await invokeTool(['evaluatewinner'], input));
  if (!record || typeof record !== 'object') throw new Error('evaluate_winner returned an invalid payload');
  const output = record as Record<string, unknown>;
  if (typeof output.winnerIndex !== 'number' || typeof output.handName !== 'string') {
    throw new Error('evaluate_winner did not include winnerIndex and handName');
  }
  return { winnerIndex: output.winnerIndex, handName: output.handName };
}
