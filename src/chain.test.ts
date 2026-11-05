// @vitest-environment node
// Tests the network layer with a fake RPC server. Under jsdom the XDR library sees a different
// Uint8Array than Node's and rejects its own byte arrays, which does not happen in a real browser.
/* eslint-disable @typescript-eslint/prefer-promise-reject-errors --
   Wallets really do reject with plain { code, message } objects, which these tests reproduce. */
import { Account, nativeToScVal, type Transaction, type rpc } from '@stellar/stellar-sdk';
import { AssembledTransaction, SentTransaction } from '@stellar/stellar-sdk/contract';
import { describe, expect, it } from 'vitest';
import {
  createCheckoutChain,
  toSubscribeError,
  type ContractClientLike,
  type ServerLike,
} from './chain';
import { SubscribeError } from './errors';
import { CONTRACT, MERCHANT, SUBSCRIBER, TESTNET, TOKEN } from './testing/fakes';

const CONFIG = {
  contractId: CONTRACT,
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: TESTNET,
};

/** What a token answers to each view call. */
interface TokenAnswers {
  symbol?: unknown;
  decimals?: unknown;
  balance?: unknown;
  fail?: Error;
}

function fakeServer(
  options: {
    token?: TokenAnswers;
    statuses?: string[];
    sendStatus?: string;
    account?: Error;
  } = {},
) {
  const sent: Transaction[] = [];
  const answers: TokenAnswers = {
    symbol: 'XLM',
    decimals: 7,
    balance: 25_000_000n,
    ...options.token,
  };
  const statuses = [...(options.statuses ?? ['SUCCESS'])];
  const server: ServerLike = {
    getLatestLedger: () => Promise.resolve({ sequence: 4242 }),
    getAccount: () =>
      options.account === undefined
        ? Promise.resolve(new Account(SUBSCRIBER, '100'))
        : Promise.reject(options.account),
    prepareTransaction: (tx) => Promise.resolve(tx),
    sendTransaction: (tx) => {
      sent.push(tx);
      return Promise.resolve({ status: options.sendStatus ?? 'PENDING', hash: 'TXHASH' });
    },
    getTransaction: () =>
      Promise.resolve({
        status: statuses.length > 1 ? (statuses.shift() ?? 'SUCCESS') : (statuses[0] ?? 'SUCCESS'),
      }),
    simulateTransaction: (tx) => {
      if (answers.fail !== undefined) return Promise.reject(answers.fail);
      const op = tx.operations[0] as {
        func: { invokeContract: { functionName: { toString(): string } } };
      };
      const method = op.func.invokeContract.functionName.toString();
      const value = answers[method as 'symbol' | 'decimals' | 'balance'];
      const retval =
        typeof value === 'bigint'
          ? nativeToScVal(value, { type: 'i128' })
          : typeof value === 'number'
            ? nativeToScVal(value, { type: 'u32' })
            : nativeToScVal(String(value));
      return Promise.resolve({
        transactionData: {},
        result: { retval },
      } as unknown as rpc.Api.SimulateTransactionResponse);
    },
  };
  return { server, sent };
}

function result<T>(value: T | Error | string) {
  if (value instanceof Error || typeof value === 'string') {
    const message = value instanceof Error ? value.message : value;
    return {
      isErr: () => true,
      unwrap: () => {
        throw new Error(message);
      },
      unwrapErr: () => ({ message }),
    };
  }
  return { isErr: () => false, unwrap: () => value, unwrapErr: () => ({ message: '' }) };
}

const PLAN_VALUE = {
  merchant: MERCHANT,
  token: TOKEN,
  amount: 10_000_000n,
  period_secs: 2_592_000n,
  active: true,
};

function fakeClient(overrides: Partial<ContractClientLike> = {}): () => ContractClientLike {
  const client: ContractClientLike = {
    get_plan: () =>
      Promise.resolve({
        result: result(PLAN_VALUE),
        signAndSend: () => Promise.reject(new Error('no')),
      }),
    subscribe: () =>
      Promise.resolve({
        result: result(7n),
        signAndSend: () =>
          Promise.resolve({ result: result(7n), sendTransactionResponse: { hash: 'SUBHASH' } }),
      }),
    ...overrides,
  };
  return () => client;
}

const sign = (xdr: string) => Promise.resolve(xdr);
const noSleep = () => Promise.resolve();

describe('getPlanTerms', () => {
  it('reads the plan and the token into the terms the widget shows', async () => {
    const chain = createCheckoutChain(CONFIG, {
      server: fakeServer().server,
      makeClient: fakeClient(),
    });
    expect(await chain.getPlanTerms(1)).toEqual({
      planId: 1,
      merchant: MERCHANT,
      token: TOKEN,
      amount: 10_000_000n,
      periodSecs: 2_592_000,
      active: true,
      symbol: 'XLM',
      decimals: 7,
    });
  });

  it('reports an unknown plan from the contract error code', async () => {
    const missing = {
      result: result<never>(''),
      simulation: { error: 'HostError: Error(Contract, #3)' },
      signAndSend: () => Promise.reject(new Error('no')),
    };
    const chain = createCheckoutChain(CONFIG, {
      server: fakeServer().server,
      makeClient: fakeClient({ get_plan: () => Promise.resolve(missing) }),
    });
    await expect(chain.getPlanTerms(9)).rejects.toMatchObject({
      code: 'PLAN_NOT_FOUND',
      step: 'load',
    });
  });

  it('reports a network failure while reading the plan', async () => {
    const chain = createCheckoutChain(CONFIG, {
      server: fakeServer().server,
      makeClient: fakeClient({ get_plan: () => Promise.reject(new TypeError('fetch failed')) }),
    });
    await expect(chain.getPlanTerms(1)).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('refuses a plan whose token is not a contract, or does not answer like a token', async () => {
    const badToken = createCheckoutChain(CONFIG, {
      server: fakeServer().server,
      makeClient: fakeClient({
        get_plan: () =>
          Promise.resolve({
            result: result({ ...PLAN_VALUE, token: 'GNOTACONTRACT' }),
            signAndSend: () => Promise.reject(new Error('no')),
          }),
      }),
    });
    await expect(badToken.getPlanTerms(1)).rejects.toMatchObject({ code: 'FAILED' });

    const notAToken = createCheckoutChain(CONFIG, {
      server: fakeServer({ token: { decimals: 'seven' } }).server,
      makeClient: fakeClient(),
    });
    await expect(notAToken.getPlanTerms(1)).rejects.toMatchObject({ code: 'FAILED' });
  });
});

describe('getLedger and getBalance', () => {
  it('reads the latest ledger', async () => {
    const chain = createCheckoutChain(CONFIG, { server: fakeServer().server });
    expect(await chain.getLedger()).toBe(4242);
  });

  it('reads a balance as a bigint', async () => {
    const chain = createCheckoutChain(CONFIG, { server: fakeServer().server });
    expect(await chain.getBalance(TOKEN, SUBSCRIBER)).toBe(25_000_000n);
  });

  it('rejects an answer that is not a number, and a network failure', async () => {
    const odd = createCheckoutChain(CONFIG, {
      server: fakeServer({ token: { balance: 'lots' } }).server,
    });
    await expect(odd.getBalance(TOKEN, SUBSCRIBER)).rejects.toMatchObject({
      code: 'FAILED',
      step: 'check',
    });
    const down = createCheckoutChain(CONFIG, {
      server: fakeServer({ token: { fail: new TypeError('fetch failed') } }).server,
    });
    await expect(down.getBalance(TOKEN, SUBSCRIBER)).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

describe('approve', () => {
  const input = {
    token: TOKEN,
    owner: SUBSCRIBER,
    spender: CONTRACT,
    amount: 50_000_000n,
    liveUntilLedger: 3_004_242,
    sign,
  };

  it('builds the approve call, signs it, sends it and waits until it is included', async () => {
    const { server, sent } = fakeServer({ statuses: ['NOT_FOUND', 'NOT_FOUND', 'SUCCESS'] });
    const chain = createCheckoutChain(CONFIG, { server, sleep: noSleep });
    expect(await chain.approve(input)).toEqual({ txHash: 'TXHASH' });
    expect(sent).toHaveLength(1);
    const op = sent[0]?.operations[0] as {
      func: { invokeContract: { functionName: { toString(): string }; args: unknown[] } };
    };
    expect(op.func.invokeContract.functionName.toString()).toBe('approve');
    expect(op.func.invokeContract.args).toHaveLength(4);
  });

  it('hands the wallet the owner address to sign for', async () => {
    const signedFor: string[] = [];
    const chain = createCheckoutChain(CONFIG, { server: fakeServer().server, sleep: noSleep });
    await chain.approve({
      ...input,
      sign: (xdr, address) => {
        signedFor.push(address);
        return Promise.resolve(xdr);
      },
    });
    expect(signedFor).toEqual([SUBSCRIBER]);
  });

  it('reports a declined signature and never sends', async () => {
    const { server, sent } = fakeServer();
    const chain = createCheckoutChain(CONFIG, { server, sleep: noSleep });
    const failure = await chain
      .approve({ ...input, sign: () => Promise.reject({ code: -4, message: 'declined' }) })
      .catch((e: unknown) => e);
    expect(failure).toMatchObject({ code: 'WALLET_REJECTED', step: 'approve', approved: false });
    expect(sent).toHaveLength(0);
  });

  it('fails when the network does not accept the transaction', async () => {
    const chain = createCheckoutChain(CONFIG, {
      server: fakeServer({ sendStatus: 'ERROR' }).server,
      sleep: noSleep,
    });
    await expect(chain.approve(input)).rejects.toMatchObject({ code: 'FAILED', step: 'approve' });
  });

  it('fails when the transaction is included but failed', async () => {
    const chain = createCheckoutChain(CONFIG, {
      server: fakeServer({ statuses: ['NOT_FOUND', 'FAILED'] }).server,
      sleep: noSleep,
    });
    await expect(chain.approve(input)).rejects.toMatchObject({ code: 'FAILED' });
  });

  it('says it is pending when it is never confirmed in time, so it is not sent twice', async () => {
    const chain = createCheckoutChain(CONFIG, {
      server: fakeServer({ statuses: ['NOT_FOUND'] }).server,
      sleep: noSleep,
      confirmTimeoutMs: 3000,
    });
    await expect(chain.approve(input)).rejects.toMatchObject({ code: 'PENDING' });
  });

  it('explains an account that does not exist on the network', async () => {
    const chain = createCheckoutChain(CONFIG, {
      server: fakeServer({ account: new Error('Account not found: GABC') }).server,
      sleep: noSleep,
    });
    const failure = await chain.approve(input).catch((e: unknown) => e);
    expect(failure).toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect((failure as SubscribeError).message).toContain('no funds');
  });
});

describe('subscribe', () => {
  const input = { subscriber: SUBSCRIBER, planId: 1, sign };

  it('subscribes and returns the new id and the transaction hash', async () => {
    const chain = createCheckoutChain(CONFIG, {
      server: fakeServer().server,
      makeClient: fakeClient(),
    });
    expect(await chain.subscribe(input)).toEqual({ subscriptionId: 7, txHash: 'SUBHASH' });
  });

  it('explains a plan that was deactivated meanwhile, and keeps the approved flag', async () => {
    const refused = {
      result: result<bigint>(''),
      simulation: { error: 'HostError: Error(Contract, #4)' },
      signAndSend: () => Promise.reject(new Error('no')),
    };
    const chain = createCheckoutChain(CONFIG, {
      server: fakeServer().server,
      makeClient: fakeClient({ subscribe: () => Promise.resolve(refused) }),
    });
    await expect(chain.subscribe(input)).rejects.toMatchObject({
      code: 'PLAN_INACTIVE',
      step: 'subscribe',
      approved: true,
    });
  });

  it('turns a failed payment into a balance message', async () => {
    const chain = createCheckoutChain(CONFIG, {
      server: fakeServer().server,
      makeClient: fakeClient({
        subscribe: () =>
          Promise.reject(
            new AssembledTransaction.Errors.SimulationFailed('HostError: Error(Contract, #10)'),
          ),
      }),
    });
    await expect(chain.subscribe(input)).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
  });

  it('reports a declined signature and a pending transaction', async () => {
    const declined = createCheckoutChain(CONFIG, {
      server: fakeServer().server,
      makeClient: fakeClient({
        subscribe: () =>
          Promise.resolve({
            result: result(7n),
            signAndSend: () => Promise.reject({ code: -4, message: 'declined' }),
          }),
      }),
    });
    await expect(declined.subscribe(input)).rejects.toMatchObject({
      code: 'WALLET_REJECTED',
      approved: true,
    });

    const pending = createCheckoutChain(CONFIG, {
      server: fakeServer().server,
      makeClient: fakeClient({
        subscribe: () =>
          Promise.resolve({
            result: result(7n),
            signAndSend: () =>
              Promise.reject(new SentTransaction.Errors.TransactionStillPending('pending')),
          }),
      }),
    });
    await expect(pending.subscribe(input)).rejects.toMatchObject({ code: 'PENDING' });
  });

  it('fails when the network returns no transaction hash', async () => {
    const chain = createCheckoutChain(CONFIG, {
      server: fakeServer().server,
      makeClient: fakeClient({
        subscribe: () =>
          Promise.resolve({
            result: result(7n),
            signAndSend: () => Promise.resolve({ result: result(7n) }),
          }),
      }),
    });
    await expect(chain.subscribe(input)).rejects.toMatchObject({ code: 'FAILED' });
  });
});

describe('toSubscribeError', () => {
  it('keeps an error that is already right and re-labels one from another step', () => {
    const e = new SubscribeError('FAILED', 'check', 'x');
    expect(toSubscribeError(e, 'check')).toBe(e);
    const moved = toSubscribeError(e, 'subscribe', true);
    expect(moved).toMatchObject({ step: 'subscribe', approved: true, code: 'FAILED' });
  });

  it('never leaks raw internals for something unknown', () => {
    const e = toSubscribeError('weird', 'load');
    expect(e.code).toBe('FAILED');
    expect(e.message).not.toContain('weird');
  });

  it('recognises a user rejection raised by the SDK', () => {
    expect(
      toSubscribeError(new AssembledTransaction.Errors.UserRejected('no'), 'approve').code,
    ).toBe('WALLET_REJECTED');
  });
});
