# End-to-end run on testnet

Steps to repeat the whole flow on the Stellar **testnet**: create a short plan, subscribe through the widget's real flow code, let the keeper charge twice, cancel. It contains no secrets. Keys stay in the Stellar CLI key store and are only ever named.

It spends testnet funds and creates real testnet subscriptions. The script takes the network from the environment and refuses mainnet unless the owner sets `E2E_ALLOW_MAINNET=yes` for one run (see the repository's `docs/RELEASE.md`); this runbook is for testnet. The testnet is wiped on the dates in the repository's `docs/TESTNET.md`; after that, deploy a contract first and use its id below.

## You need

- The Stellar CLI, Node 24 or newer, and pnpm.
- Funded testnet identities in the CLI key store: a merchant, a subscriber and a keeper. The repository's `docs/TESTNET.md` lists the ones created for it (`recurring-merchant`, `recurring-subscriber`, `recurring-keeper`) and how to fund more (`stellar keys fund <name> --network testnet`).
- A deployed contract id (`CONTRACT`) and a token contract id (`TOKEN`). The testnet XLM contract works and needs no setup: `stellar contract id asset --asset native --network testnet`.

```bash
CONTRACT=C…        # the recurring contract
TOKEN=C…           # for example the native XLM contract
```

## 1. Create a 60 second plan (merchant)

```bash
stellar contract invoke --id $CONTRACT --source-account recurring-merchant --network testnet --cost -- \
  create_plan --merchant recurring-merchant --token $TOKEN --amount 10000000 --period_secs 60
```

The last line printed is the new plan id. Call it `PLAN`. (`10000000` is 1 XLM.)

## 2. Start the keeper (second terminal)

The signing key goes from the key store straight into the process environment. It is never printed. Do not write it to a file.

```bash
cd recurring-keeper && pnpm install --frozen-lockfile && pnpm build
KEEPER_SECRET_KEY="$(stellar keys secret recurring-keeper)" \
STELLAR_NETWORK=testnet STELLAR_RPC_URL=https://soroban-testnet.stellar.org \
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" CONTRACT_ID=$CONTRACT \
DB_PATH=./e2e.sqlite API_PORT=18081 POLL_INTERVAL_SECS=5 MAX_FEE_STROOPS=1000000 \
node dist/main.js
```

Check `curl localhost:18081/health`: it must say `"readOnly":false` and a `lastSyncAt`. Start the keeper **before** subscribing so it sees the new subscription.

## 3. Subscribe through the widget flow (subscriber)

This runs the widget's real code (balance check, token approval, subscription). A stand-in wallet signs by asking the CLI to use the named identity.

```bash
cd recurring-checkout && pnpm install --frozen-lockfile
E2E_TESTNET=1 E2E_NETWORK=testnet E2E_RPC_URL=https://soroban-testnet.stellar.org \
E2E_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
E2E_SIGN_IDENTITY=recurring-subscriber E2E_PLAN_ID=$PLAN E2E_CONTRACT_ID=$CONTRACT \
  pnpm exec vitest run scripts/e2e-subscribe.test.ts
```

It prints one `E2E_RESULT {...}` line with the subscription id and the two transaction hashes (approve, subscribe), and passes.

## 4. Watch the keeper charge twice

```bash
curl localhost:18081/subscriptions/<subscription id>/charges
```

The first charge is due one period after subscribing, the second one period after that. Each shows `"status":"succeeded"` and a transaction hash. If the RPC is slow you will see `attempts` above 0 on a charge: the keeper retried after a timeout. Check also `curl localhost:18081/plans/$PLAN/subscriptions` (`charges: 2`) and the merchant's `revenue`.

## 5. Cancel (subscriber), then check that charging stopped

```bash
stellar contract invoke --id $CONTRACT --source-account recurring-subscriber --network testnet -- \
  cancel --caller recurring-subscriber --sub_id <subscription id>
stellar contract invoke --id $CONTRACT --source-account recurring-keeper --network testnet -- \
  charge --sub_id <subscription id>          # must fail with Error(Contract, #6), NotActive
```

Stop the keeper with Ctrl-C. Remove the approval in the wallet if you want to leave nothing behind (the approval is not removed by cancelling).

## What a successful run proves, and what it does not

It proves that the widget's subscribe flow, the contract, the keeper's charge loop and the read API work together on the real testnet. It does **not** prove anything about a real wallet extension, a real browser, or mainnet.
