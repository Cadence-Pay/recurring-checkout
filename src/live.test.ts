// @vitest-environment node
/* eslint-disable @typescript-eslint/prefer-promise-reject-errors --
   Wallets really do reject with plain { code, message } objects, which this test reproduces. */
import { describe, expect, it } from 'vitest';
import { createCheckoutChain } from './chain';
import { CONTRACT, SUBSCRIBER, TESTNET, TOKEN } from './testing/fakes';

/**
 * Checks of the real network layer against the real testnet deployment from the repository's
 * docs/TESTNET.md. They read and simulate only: nothing is signed or sent, because the stand-in
 * wallet always declines at the signing step. They need the network and the testnet contract, which
 * is wiped when testnet resets, so they run only with LIVE_TESTNET=1.
 */
describe.skipIf(process.env['LIVE_TESTNET'] !== '1')(
  'live testnet (read and simulate only)',
  () => {
    const chain = createCheckoutChain({
      contractId: CONTRACT,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: TESTNET,
    });
    const decline = () => Promise.reject({ code: -4, message: 'declined by the test' });

    it('reads plan 1 and its token', async () => {
      const terms = await chain.getPlanTerms(1);
      expect(terms).toMatchObject({
        planId: 1,
        token: TOKEN,
        amount: 10_000_000n,
        periodSecs: 60,
        symbol: 'XLM',
        decimals: 7,
      });
    }, 120_000);

    it('reports an unknown plan', async () => {
      await expect(chain.getPlanTerms(999_999)).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
    }, 120_000);

    it('reads the ledger and a balance', async () => {
      expect(await chain.getLedger()).toBeGreaterThan(5_000_000);
      expect(await chain.getBalance(TOKEN, SUBSCRIBER)).toBeGreaterThan(0n);
    }, 120_000);

    it('builds and prepares a real approve transaction, then stops when the wallet declines', async () => {
      const ledger = await chain.getLedger();
      const failure = await chain
        .approve({
          token: TOKEN,
          owner: SUBSCRIBER,
          spender: CONTRACT,
          amount: 50_000_000n,
          liveUntilLedger: ledger + 100_000,
          sign: decline,
        })
        .catch((e: unknown) => e);
      // Reaching the signing step proves the account was found and the transaction simulated.
      expect(failure).toMatchObject({ code: 'WALLET_REJECTED', step: 'approve' });
    }, 120_000);

    it('simulates a real subscribe, then stops when the wallet declines', async () => {
      const failure = await chain
        .subscribe({ subscriber: SUBSCRIBER, planId: 1, sign: decline })
        .catch((e: unknown) => e);
      expect(failure).toMatchObject({ code: 'WALLET_REJECTED', step: 'subscribe', approved: true });
    }, 120_000);
  },
);
