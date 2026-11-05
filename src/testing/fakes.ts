/* eslint-disable @typescript-eslint/prefer-promise-reject-errors --
   Wallets really do reject with plain { code, message } objects, which the fakes reproduce. */
/**
 * Fakes for tests: an in-memory network layer and a scriptable wallet. Not part of the build.
 */

import type { CheckoutChain, PlanTerms, SignFn } from '../chain';
import type { WalletAdapter, WalletSession } from '../wallet';

export const TESTNET = 'Test SDF Network ; September 2015';
export const MAINNET = 'Public Global Stellar Network ; September 2015';
export const CONTRACT = 'CCUXOGU3N5HWMLRDXC5TCQ3QDA23X3RJCDXWHMBIC4SFLD2IABQT465E';
export const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
export const MERCHANT = 'GAIPBT4WCBUALPT77TFYIK4LAHN67QNFM4OOTX3VEH4L6URNOUFJOTSQ';
export const SUBSCRIBER = 'GACJH7JXHQWIW66GHZFNMCK2I7WOZ562QAOF7B7PUENTAPRGC5RLW24A';

/** 1 XLM every 30 days. */
export const PLAN: PlanTerms = {
  planId: 1,
  merchant: MERCHANT,
  token: TOKEN,
  amount: 10_000_000n,
  periodSecs: 30 * 86_400,
  active: true,
  symbol: 'XLM',
  decimals: 7,
};

export interface Call {
  readonly method: string;
  readonly args: unknown;
}

/** A network layer that records its calls. Any method can be made to fail. */
export class FakeChain implements CheckoutChain {
  calls: Call[] = [];
  plan: PlanTerms = PLAN;
  ledger = 1_000_000;
  balance = 50_000_000n;
  planError: Error | undefined;
  balanceError: Error | undefined;
  approveError: Error | undefined;
  /** Errors for the next subscribe calls, consumed in order. */
  subscribeErrors: Error[] = [];
  nextSubscriptionId = 7;

  getPlanTerms(planId: number): Promise<PlanTerms> {
    this.calls.push({ method: 'getPlanTerms', args: planId });
    return this.planError === undefined
      ? Promise.resolve(this.plan)
      : Promise.reject(this.planError);
  }

  getLedger(): Promise<number> {
    this.calls.push({ method: 'getLedger', args: undefined });
    return Promise.resolve(this.ledger);
  }

  getBalance(token: string, account: string): Promise<bigint> {
    this.calls.push({ method: 'getBalance', args: { token, account } });
    return this.balanceError === undefined
      ? Promise.resolve(this.balance)
      : Promise.reject(this.balanceError);
  }

  async approve(input: {
    token: string;
    owner: string;
    spender: string;
    amount: bigint;
    liveUntilLedger: number;
    sign: SignFn;
  }): Promise<{ txHash: string }> {
    const { sign, ...rest } = input;
    this.calls.push({ method: 'approve', args: rest });
    if (this.approveError !== undefined) throw this.approveError;
    await sign('APPROVE_XDR', input.owner);
    return { txHash: 'APPROVE_HASH' };
  }

  async subscribe(input: {
    subscriber: string;
    planId: number;
    sign: SignFn;
  }): Promise<{ subscriptionId: number; txHash: string }> {
    const { sign, ...rest } = input;
    this.calls.push({ method: 'subscribe', args: rest });
    const failure = this.subscribeErrors.shift();
    if (failure !== undefined) throw failure;
    await sign('SUBSCRIBE_XDR', input.subscriber);
    return { subscriptionId: this.nextSubscriptionId, txHash: 'SUBSCRIBE_HASH' };
  }

  count(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }
}

/** A wallet that records what it was asked to sign. */
export class FakeWallet implements WalletAdapter {
  signed: { xdr: string; networkPassphrase: string; address: string }[] = [];
  session: WalletSession = { address: SUBSCRIBER, networkPassphrase: TESTNET };
  connectError: unknown;
  signError: unknown;
  connects = 0;

  connect(): Promise<WalletSession> {
    this.connects++;
    return this.connectError === undefined
      ? Promise.resolve(this.session)
      : Promise.reject(this.connectError);
  }

  signTransaction(
    xdr: string,
    options: { networkPassphrase: string; address: string },
  ): Promise<string> {
    if (this.signError !== undefined) return Promise.reject(this.signError);
    this.signed.push({ xdr, ...options });
    return Promise.resolve(`SIGNED(${xdr})`);
  }
}
