# Rawli Analytic Prediction Terminal

BNB-native prediction trading terminal that routes Polymarket markets, orderbook liquidity, portfolio data, and funding flows into one interface.

## Monorepo Layout

```text
SmartMarket
├ apps
│  ├ api             Fastify API
│  └ web             Next.js frontend
├ packages
│  ├ polymarket-sdk  Wrapper for Gamma, CLOB, and Bridge APIs
│  ├ types           Shared types
│  └ config          Shared config
├ infra
│  ├ docker
│  └ deployment
└ scripts
```

## Quickstart

1. Install deps:
   - `npm install`
2. Configure env:
   - `cp apps/web/.env.example apps/web/.env`
   - `cp apps/api/.env.example apps/api/.env`
   - Add `NEXT_PUBLIC_PRIVY_APP_ID` in `apps/web/.env` before testing wallet login.
3. Start API and web:
   - `npm -w @smartmarket/api run dev`
   - `npm -w @smartmarket/web run dev`

## Environment Notes

The app has two env files:

- `apps/web/.env` controls browser-visible settings: `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_POLYMARKET_BUILDER_CODE`, and `NEXT_PUBLIC_ENABLE_KALSHI`.
- `apps/api/.env` controls server settings: host/port, Polymarket upstream URLs, optional OpenAI analysis, optional Redis cache, and SQLite trading profile storage.

Operational fallbacks:

- `OPENAI_API_KEY` is optional. When it is missing or the OpenAI request fails, the analysis service returns a deterministic fallback brief instead of failing the API.
- `REDIS_URL` is optional for local development. Cache reads/writes are wrapped so the API remains responsive if Redis is unavailable, but production deployments should run Redis for lower upstream load.
- `TRADING_PROFILE_DB_PATH` should point to persistent storage in production. The default example uses `.data/trading-profiles.sqlite`.
- `PAYMENT_RECEIVER_ADDRESS` must be your BNB wallet before premium analysis can collect payment.
- `RAWLI_FEE_RECEIVER_ADDRESS` must be your BNB wallet before tokenized stock swap fees can be collected.
- `NEXT_PUBLIC_POLYMARKET_BUILDER_CODE` must be the bytes32 builder code from your Polymarket Builder Profile before orders receive builder attribution.

## Analysis API

Polymarket and Kalshi are market data sources. The analysis endpoint returns structured intelligence for a selected event.

### Endpoints

- `GET /analysis/quote`
  - Returns a lightweight description of the analysis action.
- `POST /analysis/unlock`
  - Generates structured market intelligence for the supplied market payload.

### Example

```bash
curl -X POST "http://localhost:4000/analysis/unlock" \
  -H "Content-Type: application/json" \
  -d '{
    "market": {
      "id": "m1",
      "question": "Will BTC close above $100k this year?",
      "outcomes": [
        { "name": "Yes", "price": 54 },
        { "name": "No", "price": 46 }
      ]
    }
  }'
```
