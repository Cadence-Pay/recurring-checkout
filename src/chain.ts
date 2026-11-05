import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  type Transaction,
  type xdr,
} from '@stellar/stellar-sdk';
import { AssembledTransaction, NULL_ACCOUNT, SentTransaction } from '@stellar/stellar-sdk/contract';
import { Client, Error as ContractErrors } from './contract';
import { SubscribeError, type SubscribeStep } from './errors';
import { messages } from './messages';
import { isRejection } from './wallet';

/** The terms of a plan as the widget needs to show them. */
export interface PlanTerms {
  readonly planId: number;
  readonly merchant: string;
  /** Token contract id. */
  readonly token: string;
  /** Amount per period in the token's smallest unit. */
  readonly amount: bigint;
  readonly periodSecs: number;
  readonly active: boolean;
  readonly symbol: string;
  readonly decimals: number;
}

/** Signs a transaction (base64 XDR) for an address and returns the signed XDR. */
export type SignFn = (xdr: string, address: string) => Promise<string>;

/** Everything the widget does on the network. Tests replace it with a fake. */
export interface CheckoutChain {
  /** @throws SubscribeError PLAN_NOT_FOUND, NETWORK or FAILED. */
  getPlanTerms(planId: number): Promise<PlanTerms>;
  /** The latest ledger number. */
  getLedger(): Promise<number>;
  /** Balance of `account` in `token`, in the smallest unit. */
  getBalance(token: string, account: string): Promise<bigint>;
  /** Let `spender` take up to `amount` from `owner` until `liveUntilLedger`. Signs and sends. */
  approve(input: {
    token: string;
    owner: string;
    spender: string;
    amount: bigint;
    liveUntilLedger: number;
    sign: SignFn;
  }): Promise<{ txHash: string }>;
  /** Subscribe and pay the first period. Signs and sends. */
  subscribe(input: {
    subscriber: string;
    planId: number;
    sign: SignFn;
  }): Promise<{ subscriptionId: number; txHash: string }>;
}

/** Where the contract lives. */
export interface ChainConfig {
  readonly contractId: string;
  readonly rpcUrl: string;
  readonly networkPassphrase: string;
}

/** The RPC calls the chain layer uses. `rpc.Server` satisfies it. */
export interface ServerLike {
  getLatestLedger(): Promise<{ sequence: number }>;
  getAccount(address: string): Promise<Account>;
  prepareTransaction(tx: Transaction): Promise<Transaction>;
  sendTransaction(tx: Transaction): Promise<{ status: string; hash: string }>;
  getTransaction(hash: string): Promise<{ status: string }>;
  simulateTransaction(tx: Transaction): Promise<rpc.Api.SimulateTransactionResponse>;
}

interface ResultLike<T> {
  isErr(): boolean;
  unwrap(): T;
  unwrapErr(): { message: string };
}

interface SimulatedLike<T> {
  readonly result: ResultLike<T>;
  readonly simulation?: unknown;
  signAndSend(): Promise<{
    readonly result: ResultLike<T>;
    readonly sendTransactionResponse?: { readonly hash: string } | undefined;
  }>;
}

/** The calls of the generated contract client that the widget uses. */
export interface ContractClientLike {
  get_plan(args: { plan_id: bigint }): Promise<
    SimulatedLike<{
      merchant: string;
      token: string;
      amount: bigint;
      period_secs: bigint;
      active: boolean;
    }>
  >;
  subscribe(args: { subscriber: string; plan_id: bigint }): Promise<SimulatedLike<bigint>>;
}

/** Replaceable parts, for tests. */
export interface ChainDeps {
  readonly server?: ServerLike;
  readonly makeClient?: (
    account: string | undefined,
    sign: SignFn | undefined,
  ) => ContractClientLike;
  readonly sleep?: (ms: number) => Promise<void>;
  /** How long to wait for a sent transaction to be included. Default 60 seconds. */
  readonly confirmTimeoutMs?: number;
}

/**
 * The symbol to show for a token. The contract of native XLM answers `native`, which means
 * nothing to a customer, so it is shown as XLM.
 */
export function displaySymbol(symbol: string): string {
  return symbol === 'native' ? 'XLM' : symbol;
}

/** The error text of a raw simulation response, if it has one. */
function simulationErrorText(simulation: unknown): string | undefined {
  if (typeof simulation !== 'object' || simulation === null || !('error' in simulation)) {
    return undefined;
  }
  return typeof simulation.error === 'string' ? simulation.error : undefined;
}

function contractErrorName(text: string): string | undefined {
  const match = /Error\(Contract, #(\d+)\)/.exec(text);
  const code = match?.[1];
  if (code === undefined) return undefined;
  return (ContractErrors as Record<number, { message: string } | undefined>)[Number(code)]?.message;
}

/** The widget's error for a contract refusal the person can understand, if there is one. */
function fromContractName(
  name: string | undefined,
  step: SubscribeStep,
  approved: boolean,
  cause: unknown,
): SubscribeError | undefined {
  if (name === 'PlanNotFound') {
    return new SubscribeError('PLAN_NOT_FOUND', step, messages.errors.PLAN_NOT_FOUND, {
      approved,
      cause,
    });
  }
  if (name === 'PlanInactive') {
    return new SubscribeError('PLAN_INACTIVE', step, messages.errors.PLAN_INACTIVE, {
      approved,
      cause,
    });
  }
  if (name === 'PaymentFailed') {
    return new SubscribeError('INSUFFICIENT_BALANCE', step, messages.paymentFailed, {
      approved,
      cause,
    });
  }
  return undefined;
}

/**
 * Turn anything thrown on the network side into a SubscribeError.
 *
 * @param error - What was thrown.
 * @param step - Where in the flow it happened.
 * @param approved - Whether the token approval had already gone through.
 */
export function toSubscribeError(
  error: unknown,
  step: SubscribeStep,
  approved = false,
): SubscribeError {
  if (error instanceof SubscribeError) {
    return error.step === step && error.approved === approved
      ? error
      : new SubscribeError(error.code, step, error.message, { approved, cause: error });
  }
  if (isRejection(error) || error instanceof AssembledTransaction.Errors.UserRejected) {
    return new SubscribeError('WALLET_REJECTED', step, messages.errors.WALLET_REJECTED, {
      approved,
      cause: error,
    });
  }
  if (error instanceof SentTransaction.Errors.TransactionStillPending) {
    return new SubscribeError('PENDING', step, messages.errors.PENDING, { approved, cause: error });
  }
  const text = error instanceof Error ? error.message : '';
  const raw = error instanceof AssembledTransaction.Errors.SimulationFailed ? text : undefined;
  const name = raw === undefined ? undefined : contractErrorName(raw);
  const known = fromContractName(name, step, approved, error);
  if (known !== undefined) return known;
  if (/account not found|not found: G/i.test(text)) {
    return new SubscribeError('INSUFFICIENT_BALANCE', step, messages.accountNotFunded, {
      approved,
      cause: error,
    });
  }
  if (error instanceof TypeError || /fetch|network|timeout|ECONN/i.test(text)) {
    return new SubscribeError('NETWORK', step, messages.errors.NETWORK, { approved, cause: error });
  }
  return new SubscribeError('FAILED', step, messages.errors.FAILED, { approved, cause: error });
}

function hashOf(response: { hash: string } | undefined, step: SubscribeStep): string {
  if (response === undefined) {
    throw new SubscribeError('FAILED', step, messages.errors.FAILED);
  }
  return response.hash;
}

/**
 * Create the network layer for one contract.
 *
 * @param config - Contract id, RPC URL and network passphrase.
 * @param deps - Replaceable parts, for tests.
 */
export function createCheckoutChain(config: ChainConfig, deps: ChainDeps = {}): CheckoutChain {
  const server: ServerLike =
    deps.server ??
    new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith('http://') });
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const confirmTimeoutMs = deps.confirmTimeoutMs ?? 60_000;

  const makeClient =
    deps.makeClient ??
    ((account: string | undefined, sign: SignFn | undefined): ContractClientLike =>
      new Client({
        contractId: config.contractId,
        networkPassphrase: config.networkPassphrase,
        rpcUrl: config.rpcUrl,
        allowHttp: config.rpcUrl.startsWith('http://'),
        ...(account === undefined || sign === undefined
          ? {}
          : {
              publicKey: account,
              signTransaction: async (xdr: string) => ({
                signedTxXdr: await sign(xdr, account),
              }),
            }),
      }));

  /** Read-only call to a token contract by simulation. Nothing is signed or sent. */
  async function view(token: string, method: string, ...args: xdr.ScVal[]): Promise<unknown> {
    const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, '0'), {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(new Contract(token).call(method, ...args))
      .setTimeout(30)
      .build();
    const result = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(result) || result.result === undefined) {
      throw new SubscribeError('FAILED', 'load', messages.errors.FAILED);
    }
    const native: unknown = scValToNative(result.result.retval);
    return native;
  }

  /** Wait until a sent transaction is included. Throws PENDING if it takes too long. */
  async function confirm(hash: string, step: SubscribeStep, approved: boolean): Promise<void> {
    const deadline = confirmTimeoutMs;
    let waited = 0;
    while (waited <= deadline) {
      const result = await server.getTransaction(hash);
      if (result.status === 'SUCCESS') return;
      if (result.status === 'FAILED') {
        throw new SubscribeError('FAILED', step, messages.errors.FAILED, { approved });
      }
      await sleep(1000);
      waited += 1000;
    }
    throw new SubscribeError('PENDING', step, messages.errors.PENDING, { approved });
  }

  return {
    async getPlanTerms(planId) {
      try {
        const call = await makeClient(undefined, undefined).get_plan({ plan_id: BigInt(planId) });
        if (call.result.isErr()) {
          const name = contractErrorName(simulationErrorText(call.simulation) ?? '');
          if (name === 'PlanNotFound' || name === undefined) {
            throw new SubscribeError('PLAN_NOT_FOUND', 'load', messages.errors.PLAN_NOT_FOUND);
          }
          throw new SubscribeError('FAILED', 'load', messages.errors.FAILED);
        }
        const plan = call.result.unwrap();
        if (!StrKey.isValidContract(plan.token)) {
          throw new SubscribeError('FAILED', 'load', messages.errors.FAILED);
        }
        const [symbol, decimals] = await Promise.all([
          view(plan.token, 'symbol'),
          view(plan.token, 'decimals'),
        ]);
        if (typeof symbol !== 'string' || typeof decimals !== 'number') {
          throw new SubscribeError('FAILED', 'load', messages.errors.FAILED);
        }
        return {
          planId,
          merchant: plan.merchant,
          token: plan.token,
          amount: plan.amount,
          periodSecs: Number(plan.period_secs),
          active: plan.active,
          symbol: displaySymbol(symbol),
          decimals,
        };
      } catch (error) {
        throw toSubscribeError(error, 'load');
      }
    },

    async getLedger() {
      try {
        return (await server.getLatestLedger()).sequence;
      } catch (error) {
        throw toSubscribeError(error, 'check');
      }
    },

    async getBalance(token, account) {
      try {
        const value = await view(token, 'balance', new Address(account).toScVal());
        if (typeof value !== 'bigint')
          throw new SubscribeError('FAILED', 'check', messages.errors.FAILED);
        return value;
      } catch (error) {
        throw toSubscribeError(error, 'check');
      }
    },

    async approve(input) {
      try {
        const source = await server.getAccount(input.owner);
        const tx = new TransactionBuilder(source, {
          fee: BASE_FEE,
          networkPassphrase: config.networkPassphrase,
        })
          .addOperation(
            new Contract(input.token).call(
              'approve',
              new Address(input.owner).toScVal(),
              new Address(input.spender).toScVal(),
              nativeToScVal(input.amount, { type: 'i128' }),
              nativeToScVal(input.liveUntilLedger, { type: 'u32' }),
            ),
          )
          .setTimeout(120)
          .build();
        const prepared = await server.prepareTransaction(tx);
        const signedXdr = await input.sign(prepared.toXdr(), input.owner);
        const signed = TransactionBuilder.fromXdr(
          signedXdr,
          config.networkPassphrase,
        ) as Transaction;
        const sent = await server.sendTransaction(signed);
        if (sent.status !== 'PENDING') {
          throw new SubscribeError('FAILED', 'approve', messages.errors.FAILED);
        }
        await confirm(sent.hash, 'approve', false);
        return { txHash: sent.hash };
      } catch (error) {
        throw toSubscribeError(error, 'approve');
      }
    },

    async subscribe(input) {
      try {
        const call = await makeClient(input.subscriber, input.sign).subscribe({
          subscriber: input.subscriber,
          plan_id: BigInt(input.planId),
        });
        if (call.result.isErr()) {
          const name = contractErrorName(simulationErrorText(call.simulation) ?? '');
          throw (
            fromContractName(name, 'subscribe', true, undefined) ??
            new SubscribeError('FAILED', 'subscribe', messages.errors.FAILED, { approved: true })
          );
        }
        const sent = await call.signAndSend();
        if (sent.result.isErr())
          throw new SubscribeError('FAILED', 'subscribe', messages.errors.FAILED, {
            approved: true,
          });
        return {
          subscriptionId: Number(sent.result.unwrap()),
          txHash: hashOf(sent.sendTransactionResponse, 'subscribe'),
        };
      } catch (error) {
        throw toSubscribeError(error, 'subscribe', true);
      }
    },
  };
}
