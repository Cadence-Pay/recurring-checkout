# recurring-checkout

[![ci](https://github.com/Cadence-Pay/recurring-checkout/actions/workflows/ci.yml/badge.svg)](https://github.com/Cadence-Pay/recurring-checkout/actions/workflows/ci.yml)

An embeddable React button that subscribes a person to a Stellar Recurring plan. It loads the plan, shows the terms in plain words, connects the person's wallet, and then makes two signed transactions: a token approval for the later payments, and the subscription itself, which pays the first period.

This is **not** payment streaming. It is one discrete charge per period.

## Status

Implemented and covered by unit tests (`pnpm test`: 112 at the time of writing, plus 6 opt-in tests against the live testnet, see "Verify"): the terms and approval maths, the subscribe flow, the network layer (against a fake RPC server), the component, the wallet adapter, and the contrast of the default theme.

Run for real on the **testnet** with the Stellar CLI standing in for a wallet: the widget's subscribe flow checked the balance, made the token approval and subscribed, and the keeper then charged that subscription twice (see `scripts/e2e-testnet.md` and the contracts repository's [docs/DEMO.md](https://github.com/Cadence-Pay/recurring-contracts/blob/main/docs/DEMO.md)). The built example page was also loaded in a DOM and rendered the live plan's terms.

**Not tested:** a real wallet extension signing in a real browser, by a person. Wallet connection, the wallet's own dialogs and how the widget looks on a real page are unproven. Nothing has run on mainnet.

**Audit status: the contract this widget talks to has not been audited. This widget has not been audited either.**

## Install

The package is **not published to npm**. Build it from source, pack it, and install the packed file in your app:

```bash
git clone https://github.com/Cadence-Pay/recurring-checkout.git
cd recurring-checkout
pnpm install --frozen-lockfile && pnpm build && pnpm pack   # writes recurring-checkout-0.1.0.tgz

cd /path/to/your-app
pnpm add /path/to/recurring-checkout/recurring-checkout-0.1.0.tgz react react-dom
pnpm add @creit.tech/stellar-wallets-kit   # optional, see "Wallets"
```

This path was checked: the packed file installs into an empty project and the package loads as ESM and as CommonJS, with `recurring-checkout/style.css` resolving. React 19 is a peer dependency. `@stellar/stellar-sdk` is installed with the package.

## Use

```tsx
import { SubscribeButton } from 'recurring-checkout';
import 'recurring-checkout/style.css';

<SubscribeButton
  planId={1}
  contractId="C…"
  rpcUrl="https://soroban-testnet.stellar.org"
  networkPassphrase="Test SDF Network ; September 2015"
  onSuccess={(result) => console.log(result.subscriptionId)}
  onError={(error) => console.warn(error.code, error.message)}
/>;
```

Nothing network-specific is built in: the network, RPC server and contract all come from the props. A working page is in [examples/basic](examples/basic) (`pnpm build:example`, then open `examples/basic/index.html`). It points at the public testnet deployment, which is wiped on the testnet reset date written in [docs/TESTNET.md](https://github.com/Cadence-Pay/recurring-contracts/blob/main/docs/TESTNET.md).

### Props

| Prop                 | Required | Meaning                                                                                                                                                                                |
| -------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planId`             | yes      | The plan, a whole number from 1.                                                                                                                                                       |
| `contractId`         | yes      | The recurring contract (starts with `C`).                                                                                                                                              |
| `rpcUrl`             | yes      | Stellar RPC server URL.                                                                                                                                                                |
| `networkPassphrase`  | yes      | Network passphrase. A wallet on another network is refused.                                                                                                                            |
| `onSuccess(result)`  | no       | Called once when subscribed. `result` has `planId`, `subscriptionId`, `subscriber`, `approveTxHash` (null if the approval was made earlier in the same session) and `subscribeTxHash`. |
| `onError(error)`     | no       | Called when subscribing fails or cannot start. `error` is a `SubscribeError` with a `code`, the `step` it happened at, a readable `message`, and `approved`.                           |
| `maxCharges`         | no       | How many later charges one approval covers at most. Default 12.                                                                                                                        |
| `maxApprovalLedgers` | no       | Longest an approval may last, in ledgers. Default 3,000,000 (about 174 days).                                                                                                          |
| `wallet`             | no       | Your own wallet adapter (see below).                                                                                                                                                   |
| `className`          | no       | Extra class for the outer element.                                                                                                                                                     |
| `chain`              | no       | Replaces the network layer. For tests and advanced use.                                                                                                                                |

Error codes: `CONFIG`, `PLAN_NOT_FOUND`, `PLAN_INACTIVE`, `PERIOD_TOO_LONG`, `WALLET_UNAVAILABLE`, `WALLET_REJECTED`, `WRONG_NETWORK`, `INSUFFICIENT_BALANCE`, `NETWORK`, `PENDING`, `FAILED`.

### What the person sees and signs

1. The widget shows the price, the period, what they pay now, what is charged later, and exactly what the approval allows (a total, how many charges that covers, and a date).
2. On click the wallet opens. The balance is checked **before** anything is signed.
3. The wallet is asked to sign **twice**: first the token approval, then the subscription. This has to be two transactions because a contract transaction can hold only one operation.
4. If the approval succeeds but the subscription fails, the widget says so, and pressing the button again asks for **one** signature (the subscription), not a second approval.
5. If a transaction was sent but not confirmed in time (`PENDING`), the button is disabled and the message tells the person to check their wallet first, so nothing is sent twice.

## Theming

All colours, sizes and the font are CSS variables with a `--rc-` prefix, set on `.rc-root`. Import `recurring-checkout/style.css` for the default theme (light, and dark when the visitor's system is dark), then override any variable from your own CSS. The defaults have zero specificity, so your rules always win.

```css
.my-shop .rc-root {
  --rc-primary: #0a7d3c;
  --rc-primary-contrast: #ffffff;
  --rc-radius: 0;
}
```

| Variable                                            | Used for                               |
| --------------------------------------------------- | -------------------------------------- |
| `--rc-bg`, `--rc-text`, `--rc-muted`, `--rc-border` | surface, text, secondary text, outline |
| `--rc-primary`, `--rc-primary-contrast`             | the button                             |
| `--rc-danger`, `--rc-success`                       | error and success messages             |
| `--rc-focus`                                        | keyboard focus ring                    |
| `--rc-space`, `--rc-radius`, `--rc-font`            | spacing, corners, font                 |

If you change colours, keep text at 4.5:1 contrast against its background. The default theme is checked for this by a test. Extra ready-made themes are planned work (`WAVE-ISSUE(checkout-1)`).

## Wallets

By default the widget uses the [Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit) chooser, which it loads only when the person clicks. Install `@creit.tech/stellar-wallets-kit` (an optional peer dependency) for that. Without it, clicking shows "No wallet is available".

To use another wallet, pass an adapter:

```ts
const wallet: WalletAdapter = {
  async connect() {
    return { address: 'G…', networkPassphrase: 'Test SDF Network ; September 2015' };
  },
  async signTransaction(xdr, { networkPassphrase, address }) {
    return signedXdr;
  },
};
```

`networkPassphrase` in the session may be `null` if the wallet cannot say. A request the person declines should be thrown with code `-4` (SEP-43) or a message containing "rejected", "declined" or "closed"; it is then shown as "Nothing was charged". A chooser dialog of the widget's own is planned work (`WAVE-ISSUE(checkout-2)`).

## Security notes: what the subscriber is authorizing

- **The approval is a cap with an end date, not unlimited access.** It lets only the recurring contract take the plan amount, once per billing period, up to the total shown, until the date shown. It does not move money by itself. The contract takes it when a charge is due.
- **The first payment is made immediately** when subscribing, directly from the person's account to the merchant. It is not returned if they cancel.
- **How long an approval can last is limited by the network** (about 180 days). A plan with a long period therefore covers fewer charges, and the widget says how many. After the date, charging stops until the person approves again. Plans whose period is longer than any approval can last cannot be subscribed to with this widget, and say so.
- **Cancelling does not remove the approval.** Either the subscriber or the merchant can cancel the subscription through the contract, which stops all charges. A subscriber who wants to be sure should also remove the approval in their wallet.
- **The merchant chooses the token.** A token that misbehaves (blocks transfers, can freeze or claw back funds) can break payments. Only subscribe to plans that use a token you trust.
- **The widget never holds keys.** Signing happens in the wallet. The widget itself stores nothing in the browser (the wallet chooser may remember which wallet was picked).
- **Nothing is sent before the balance has been checked,** but the check is advice, not a guarantee: the balance can change before the transaction runs, and the contract then refuses the payment.
- The contract is **not audited**. Do not use it with money you cannot afford to lose.

## Verify

```bash
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Needs Node 24 or newer and pnpm. `pnpm build:example` builds the example page separately. The opt-in live tests need the network and fail once testnet is reset and the contract is gone: 5 read-only tests run with `LIVE_TESTNET=1 pnpm test`, and 1 end-to-end test that spends testnet funds runs only with `E2E_RUN=1` (see `scripts/e2e-testnet.md`).

The files in `src/contract/` are generated by `stellar-js generate`; see the header in each file.

## Stellar Recurring repositories

| Repository                                                                | What it is                                                                                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [recurring-contracts](https://github.com/Cadence-Pay/recurring-contracts) | the Soroban contract: plans, subscriptions, `charge`, `cancel` (testnet deployment and live runs in its `docs/`) |
| [recurring-keeper](https://github.com/Cadence-Pay/recurring-keeper)       | service that charges due subscriptions, sends webhooks and serves a read API                                     |
| [recurring-dashboard](https://github.com/Cadence-Pay/recurring-dashboard) | Next.js dashboard for merchants                                                                                  |
| [recurring-checkout](https://github.com/Cadence-Pay/recurring-checkout)   | this subscribe button                                                                                            |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately as described in [SECURITY.md](SECURITY.md), never in a public issue.

## License

MIT
