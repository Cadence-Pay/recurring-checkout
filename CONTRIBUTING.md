# Contributing to recurring-checkout

Thank you for helping. This is the embeddable subscribe button of Stellar Recurring: pull-based subscription billing on Stellar. One discrete charge per period; it is **not** payment streaming.

The widget asks visitors of a merchant's site to approve token payments. What it says must match what it does.

## Set up

You need Node 24 or newer and [pnpm](https://pnpm.io).

```bash
git clone https://github.com/Cadence-Pay/recurring-checkout.git
cd recurring-checkout
pnpm install --frozen-lockfile
pnpm test
pnpm build:example   # builds examples/basic
```

## Before you open a pull request

Run the full check. A pull request is ready when this passes:

```bash
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Rules for this package:

- The widget is a library: React is a peer dependency, and styling is CSS variables only (`src/style.css`).
- Every sentence the widget shows lives in `src/messages.ts`.
- What the person authorizes must always be stated in plain words before they sign. Never send anything before the balance check.
- A transaction that is sent but not confirmed must not be sent again blindly (`PENDING`).
- TypeScript is strict. No `any`. Every public function has a test for success and at least one for failure.
- `src/contract/` is generated. Do not edit it by hand beyond what its header says.

Where things are: `src/` (widget), `src/style.css` (theme), `examples/` (example page), `scripts/` (testnet end to end).

General rules:

- **Testnet only.** Never put a mainnet key, a seed phrase or any secret in a file, a test, a log, a commit or an issue. Use the Stellar CLI key store.
- **Describe only what exists.** Documentation says what is implemented and tested. No claims about features that are not there.
- **Keep to the issue.** Do what the issue asks and no more. A small, focused change is reviewed faster than a large one.
- **Test it.** New behaviour comes with tests for success and for failure. Say in the pull request what you ran.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org). Examples:

```
feat(checkout): add <what>
fix(checkout): handle <case>
docs(checkout): explain <thing>
test(checkout): cover <case>
```

## Claiming an issue

1. Pick an issue that is not assigned. Issues drafted for contributors name a marker such as `WAVE-ISSUE(...)`; search the code for it to find where the work plugs in.
2. Comment that you would like to take it, and wait to be assigned. One person per issue at a time.
3. Ask questions in the issue if the scope is unclear. The scope written there is the limit of the change.
4. Open a pull request that mentions the issue. If you stop working on it, say so, so someone else can take it.

If an issue carries a Drips Wave label (for example `Stellar Wave`), it is part of a [Drips Wave](https://www.drips.network/wave) cycle. Apply for it in the Drips Wave app; the maintainers assign one applicant, there or on GitHub.

## Reporting a security problem

Do not open a public issue. See [SECURITY.md](SECURITY.md).

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
