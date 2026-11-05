import { describe, expect, it } from 'vitest';
import { SubscribeError } from './errors';
import { runSubscribeFlow, type FlowInput, type FlowStep } from './flow';
import { computeApproval } from './terms';
import {
  CONTRACT,
  FakeChain,
  FakeWallet,
  MAINNET,
  PLAN,
  SUBSCRIBER,
  TESTNET,
  TOKEN,
} from './testing/fakes';

const APPROVAL = computeApproval({
  amount: PLAN.amount,
  periodSecs: PLAN.periodSecs,
  maxCharges: 12,
  maxLedgers: 3_000_000,
});

function setup(overrides: Partial<FlowInput> = {}) {
  const chain = new FakeChain();
  const wallet = new FakeWallet();
  const steps: FlowStep[] = [];
  const input: FlowInput = {
    chain,
    wallet,
    contractId: CONTRACT,
    networkPassphrase: TESTNET,
    terms: PLAN,
    approval: APPROVAL,
    skipApproval: false,
    onStep: (s) => steps.push(s),
    ...overrides,
  };
  return { chain, wallet, steps, input };
}

async function failureOf(input: FlowInput): Promise<SubscribeError> {
  const result = await runSubscribeFlow(input).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(result).toBeInstanceOf(SubscribeError);
  return result as SubscribeError;
}

describe('runSubscribeFlow', () => {
  it('connects, checks, approves, then subscribes, in that order', async () => {
    const { chain, steps, input } = setup();
    const result = await runSubscribeFlow(input);
    expect(result).toEqual({
      planId: 1,
      subscriptionId: 7,
      subscriber: SUBSCRIBER,
      approveTxHash: 'APPROVE_HASH',
      subscribeTxHash: 'SUBSCRIBE_HASH',
    });
    expect(steps).toEqual(['connecting', 'checking', 'approving', 'subscribing']);
    expect(chain.calls.map((c) => c.method)).toEqual([
      'getBalance',
      'getLedger',
      'approve',
      'subscribe',
    ]);
  });

  it('approves exactly the cap for this contract, until the right ledger', async () => {
    const { chain, input } = setup();
    await runSubscribeFlow(input);
    const approve = chain.calls.find((c) => c.method === 'approve')?.args;
    expect(approve).toEqual({
      token: TOKEN,
      owner: SUBSCRIBER,
      spender: CONTRACT,
      amount: APPROVAL.cap,
      liveUntilLedger: chain.ledger + APPROVAL.durationLedgers,
    });
    // 30 days is about 518,400 ledgers, so five charges fit in the 3,000,000 ledger limit.
    expect(APPROVAL.coveredCharges).toBe(5);
    expect(APPROVAL.cap).toBe(50_000_000n);
  });

  it('has the wallet sign both transactions for the right network and address', async () => {
    const { wallet, input } = setup();
    await runSubscribeFlow(input);
    expect(wallet.signed).toEqual([
      { xdr: 'APPROVE_XDR', networkPassphrase: TESTNET, address: SUBSCRIBER },
      { xdr: 'SUBSCRIBE_XDR', networkPassphrase: TESTNET, address: SUBSCRIBER },
    ]);
  });

  it('skips the approval when it was already made, and reports no approval hash', async () => {
    const { chain, steps, input } = setup({ skipApproval: true });
    const result = await runSubscribeFlow(input);
    expect(result.approveTxHash).toBeNull();
    expect(chain.count('approve')).toBe(0);
    expect(steps).toEqual(['connecting', 'checking', 'subscribing']);
  });

  it('refuses a wallet on another network before anything is signed', async () => {
    const { chain, wallet, input } = setup();
    wallet.session = { address: SUBSCRIBER, networkPassphrase: MAINNET };
    const error = await failureOf(input);
    expect(error).toMatchObject({ code: 'WRONG_NETWORK', step: 'connect' });
    expect(error.message).toContain('Testnet');
    expect(chain.count('getBalance')).toBe(0);
    expect(wallet.signed).toEqual([]);
  });

  it('carries on when the wallet does not say which network it is on', async () => {
    const { wallet, input } = setup();
    wallet.session = { address: SUBSCRIBER, networkPassphrase: null };
    await expect(runSubscribeFlow(input)).resolves.toMatchObject({ subscriptionId: 7 });
  });

  it('stops before any signature when the balance is too low, and says how much', async () => {
    const { chain, wallet, input } = setup();
    chain.balance = 5_000_000n;
    const error = await failureOf(input);
    expect(error).toMatchObject({ code: 'INSUFFICIENT_BALANCE', step: 'check', approved: false });
    expect(error.message).toContain('0.5 XLM');
    expect(error.message).toContain('1 XLM');
    expect(chain.count('approve')).toBe(0);
    expect(wallet.signed).toEqual([]);
  });

  it('accepts a balance exactly equal to the first payment', async () => {
    const { chain, input } = setup();
    chain.balance = PLAN.amount;
    await expect(runSubscribeFlow(input)).resolves.toMatchObject({ subscriptionId: 7 });
  });

  it('reports a declined connection as WALLET_REJECTED', async () => {
    const { wallet, input } = setup();
    wallet.connectError = { code: -4, message: 'User closed the modal' };
    expect(await failureOf(input)).toMatchObject({ code: 'WALLET_REJECTED', step: 'connect' });
  });

  it('reports a wallet that fails to open as WALLET_UNAVAILABLE', async () => {
    const { wallet, input } = setup();
    wallet.connectError = new Error('extension not found');
    expect(await failureOf(input)).toMatchObject({ code: 'WALLET_UNAVAILABLE', step: 'connect' });
  });

  it('passes on an error the wallet adapter already described', async () => {
    const { wallet, input } = setup();
    wallet.connectError = new SubscribeError('WALLET_UNAVAILABLE', 'connect', 'No wallet here.');
    expect((await failureOf(input)).message).toBe('No wallet here.');
  });

  it('reports a declined approval, with nothing approved and nothing subscribed', async () => {
    const { chain, wallet, input } = setup();
    wallet.signError = { code: -4, message: 'declined' };
    const error = await failureOf(input);
    expect(error).toMatchObject({ code: 'WALLET_REJECTED', step: 'approve', approved: false });
    expect(chain.count('subscribe')).toBe(0);
  });

  it('marks the error as approved when the subscription fails after the approval', async () => {
    const { chain, input } = setup();
    chain.subscribeErrors = [new Error('boom')];
    const error = await failureOf(input);
    expect(error).toMatchObject({ code: 'FAILED', step: 'subscribe', approved: true });
    expect(chain.count('approve')).toBe(1);
  });

  it('lets a retry finish with the subscription only', async () => {
    const { chain, wallet, input } = setup();
    chain.subscribeErrors = [new Error('boom')];
    const first = await failureOf(input);
    expect(first.approved).toBe(true);
    wallet.signed = [];
    const retry = await runSubscribeFlow({ ...input, skipApproval: first.approved });
    expect(retry.subscriptionId).toBe(7);
    expect(chain.count('approve')).toBe(1); // not asked again
    expect(wallet.signed).toHaveLength(1); // one signature, for the subscription
  });

  it('keeps the approved flag when a retry that skips the approval fails again', async () => {
    const { chain, input } = setup({ skipApproval: true });
    chain.subscribeErrors = [new Error('boom')];
    expect(await failureOf(input)).toMatchObject({ approved: true });
  });

  it('refuses an inactive plan without touching the wallet', async () => {
    const { wallet, input } = setup({ terms: { ...PLAN, active: false } });
    expect(await failureOf(input)).toMatchObject({ code: 'PLAN_INACTIVE' });
    expect(wallet.connects).toBe(0);
  });

  it('refuses a plan whose period is too long for any approval', async () => {
    const approval = computeApproval({
      amount: PLAN.amount,
      periodSecs: 365 * 86_400,
      maxCharges: 12,
      maxLedgers: 3_000_000,
    });
    const { wallet, input } = setup({ approval });
    expect(await failureOf(input)).toMatchObject({ code: 'PERIOD_TOO_LONG' });
    expect(wallet.connects).toBe(0);
  });
});
