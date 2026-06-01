# Hedera-AI-Poker

Hedera AI Poker is an enterprise-agent demo for the Hedera AI Bounty Week 2: **Enterprise Agent + Plugin** track. It is a playable Texas Holdem table where a human joins with a Hedera testnet account, buys in with HBAR, plays against Llama-powered AI opponents, and confirms every HBAR movement through a human-in-the-loop modal.

The app uses Hedera Agent Kit v4, a third-party Pyth plugin, and a custom poker plugin. It demonstrates tokenization, payments, plugin extensibility, AI table explanation, and real testnet transactions.

## What It Does

- Creates a `POKER CHIPS` HTS fungible token when a new game starts.
- Lets a player buy into the table with `0.5 HBAR`.
- Uses Pyth to show the live HBAR/USD buy-in value.
- Deals Texas Holdem hands through a custom `pokerPlugin`.
- Uses Llama for AI opponents, player advice, and table explanation.
- Requires explicit confirmation before any HBAR transfer.
- Pays the winner from the pot account after showdown.

## Bounty Requirements

| Requirement | Implementation |
| --- | --- |
| Public GitHub repository | This repo |
| Built with Hedera Agent Kit | `@hashgraph/hedera-agent-kit` + `HederaLangchainToolkit` |
| Two non-query Hedera tools | `CREATE_FUNGIBLE_TOKEN_TOOL`, `TRANSFER_HBAR_TOOL` |
| Commercial transaction | 0.5 HBAR buy-in and winner payout |
| Third-party plugin | `hak-pyth-plugin` for HBAR/USD |
| Custom plugin | `pokerPlugin` for deal/evaluate tools |
| Human-in-the-loop safety | pending transaction modal + `/tx/confirm` |
| Demo URL or X video | See demo section |
| AI Studio feedback | See feedback section |

## Hedera Tools Used

`CREATE_FUNGIBLE_TOKEN_TOOL` from `coreTokenPlugin` is called by `POST /game/new` to mint `POKER CHIPS` as an HTS fungible display/score token with a `1,000,000` supply.

`TRANSFER_HBAR_TOOL` from `coreAccountPlugin` is called only after `POST /tx/confirm`. It is used for both player buy-ins and winner payouts. HBAR is used for transfers because HTS token transfers require recipient token association, while HBAR keeps the demo runnable from fresh testnet accounts.

## Third-Party Plugin

`hak-pyth-plugin` is registered as `pythPlugin` in the toolkit configuration.

`GET /table/:id/price` calls the plugin's latest-price tool for `HBAR/USD` and returns:

```json
{
  "hbarUsd": 0.0949,
  "buyInHbar": 0.5,
  "buyInUsd": 0.05,
  "display": "Buy in: 0.5 HBAR ≈ $0.05"
}
```

## Custom Plugin

`pokerPlugin` registers three custom tools:

- `deal_hand`: shuffles a 52-card deck and deals two hole cards per player.
- `deal_community`: deals the flop, turn, and river from the remaining deck.
- `evaluate_winner`: evaluates Holdem hand rankings from high card through royal flush and returns the winning player.

## Llama Intelligence

The table includes three Llama-powered opponents:

- **Alex**: aggressive, raises often, bluffs.
- **Sam**: tight, folds weak hands, bets strong holdings.
- **River**: tricky, slowplays and bluffs unpredictably.

The frontend also includes:

- **Explain Table**: Llama explains the phase, pot, every visible hand, poker basics, and who currently looks strongest.
- **Ask Llama**: Llama recommends the human player's next move.

If `LLAMA_CLOUD_API_KEY` is not configured, the game falls back to deterministic local decisions so the demo remains playable.

## Human-In-The-Loop Safety

No route moves HBAR directly except `POST /tx/confirm`.

`POST /game/:id/join` returns a pending transaction:

```json
{
  "from": "0.0.player",
  "to": "0.0.pot",
  "amountHbar": 0.5,
  "purpose": "buy-in"
}
```

The frontend shows a confirmation modal before calling `/tx/confirm`. Winner payouts use the same pending transaction flow. This makes it impossible for the agent to drain funds without explicit user approval.

## Setup

```bash
npm install
cp .env.example .env
```

Fill `.env`:

```bash
HEDERA_ACCOUNT_ID=0.0.xxxxxxx
HEDERA_KEY_TYPE=ECDSA
HEDERA_PRIVATE_KEY=...
POT_ACCOUNT_ID=0.0.xxxxxxx
POT_KEY_TYPE=ED25519
POT_PRIVATE_KEY=...
LLAMA_CLOUD_API_KEY=...
LLAMA_CLOUD_BASE_URL=https://api.llama.com/compat/v1
LLAMA_CLOUD_MODEL=Llama-3.3-70B-Instruct
PORT=3001
```

Run:

```bash
npm run dev
```

Open:

```text
http://localhost:3001
```

Get free Hedera testnet accounts and HBAR from https://portal.hedera.com.

## How To Play

1. Click **Create Game + POKER Token**.
2. Click **Get HBAR/USD** to show the Pyth price.
3. Enter the player Hedera account ID.
4. Click **Join Table**.
5. Confirm the pending 0.5 HBAR buy-in.
6. Use **Explain Table** to understand the cards and game state.
7. Use **Ask Llama** for a suggested move.
8. Play through preflop, flop, turn, and river.
9. Confirm the winner payout when the hand ends.

## API Quick Start

```bash
curl -X POST http://localhost:3001/game/new
curl http://localhost:3001/table/<gameId>/price
curl http://localhost:3001/table/<gameId>/explain
curl http://localhost:3001/table/<gameId>/advice
curl -X POST http://localhost:3001/game/<gameId>/join \
  -H 'content-type: application/json' \
  -d '{"playerAccountId":"0.0.xxxxxxx"}'
curl -X POST http://localhost:3001/tx/confirm \
  -H 'content-type: application/json' \
  -d '{"txId":"<pendingTxId>"}'
curl -X POST http://localhost:3001/game/<gameId>/action \
  -H 'content-type: application/json' \
  -d '{"playerId":"human","action":"raise","amount":25}'
```

## Demo Video Checklist

- `/game/new` fires `CREATE_FUNGIBLE_TOKEN_TOOL`; show `txId`.
- HashScan shows the token creation transaction.
- `/table/:id/price` returns live Pyth HBAR/USD data.
- Join creates a pending buy-in transaction.
- Confirm buy-in fires `TRANSFER_HBAR_TOOL`.
- HashScan shows player to pot HBAR transfer.
- Use **Explain Table** and **Ask Llama**.
- Play through multiple streets.
- Winner payout appears as a pending transaction.
- Confirm payout fires `TRANSFER_HBAR_TOOL`.
- HashScan shows pot to winner HBAR transfer.

## Demo Video Link

See X post: [URL]

## Feedback

Required Agent Kit feedback issue:

https://github.com/hashgraph/hedera-agent-kit-js/issues/new?template=agent_kit_feedback.yml

## Notes

Do not commit `.env`. Testnet private keys are for local demos only.
