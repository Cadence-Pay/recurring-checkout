# recurring-checkout

Embeddable React library for Stellar Recurring. Planned job: a `<SubscribeButton>` that shows a plan's terms, asks the subscriber to approve a token allowance, and subscribes.

This is **not** payment streaming. It is one discrete charge per period.

## Status

**Skeleton only.** The package builds (ESM, CJS and types) and has a placeholder component. There is no subscribe button, wallet connection or contract call yet.

**Audit status: the contract this widget talks to has not been audited. This widget has not been audited either.**

## Verify

```bash
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Needs Node 24 or newer and pnpm. React 19 is a peer dependency.

## License

MIT
