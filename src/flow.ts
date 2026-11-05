import { formatAmount } from './amount';
import type { CheckoutChain, PlanTerms, SignFn } from './chain';
import { toSubscribeError } from './chain';
import { SubscribeError } from './errors';
import { messages, networkName } from './messages';
import type { ApprovalTerms } from './terms';
import { isRejection, type WalletAdapter } from './wallet';

/** The step the flow is on, for a progress message. */
export type FlowStep = 'connecting' | 'checking' | 'approving' | 'subscribing';

/** What `onSuccess` receives. */
export interface SubscribeResult {
  readonly planId: number;
  readonly subscriptionId: number;
  /** The address that subscribed and paid. */
  readonly subscriber: string;
  /** Hash of the approval transaction, or null if no approval was needed in this attempt. */
  readonly approveTxHash: string | null;
  /** Hash of the subscribe transaction. */
  readonly subscribeTxHash: string;
}

/** What {@link runSubscribeFlow} needs. */
export interface FlowInput {
  readonly chain: CheckoutChain;
  readonly wallet: WalletAdapter;
  readonly contractId: string;
  readonly networkPassphrase: string;
  readonly terms: PlanTerms;
  readonly approval: ApprovalTerms;
  /** True when the approval was already made earlier in this session and only the subscription is left. */
  readonly skipApproval: boolean;
  readonly onStep: (step: FlowStep) => void;
}

/**
 * Subscribe a person to a plan: connect the wallet, check the balance, approve the later
 * payments, then subscribe (which makes the first payment).
 *
 * This is two transactions, because a contract transaction can hold only one operation. If the
 * approval succeeds and the subscription then fails, the thrown error has `approved: true`, and
 * calling this again with `skipApproval: true` finishes the job without a second approval.
 * Nothing is sent before the balance has been checked.
 *
 * @param input - Chain, wallet, plan terms and approval terms.
 * @returns The new subscription and the transaction hashes.
 * @throws SubscribeError with a code and a message written for the person.
 */
export async function runSubscribeFlow(input: FlowInput): Promise<SubscribeResult> {
  const { chain, wallet, terms, approval } = input;
  if (!terms.active) {
    throw new SubscribeError('PLAN_INACTIVE', 'load', messages.errors.PLAN_INACTIVE);
  }
  if (approval.coveredCharges < 1) {
    throw new SubscribeError('PERIOD_TOO_LONG', 'load', messages.errors.PERIOD_TOO_LONG);
  }

  input.onStep('connecting');
  let address: string;
  try {
    const session = await wallet.connect();
    address = session.address;
    if (
      session.networkPassphrase !== null &&
      session.networkPassphrase !== input.networkPassphrase
    ) {
      throw new SubscribeError(
        'WRONG_NETWORK',
        'connect',
        messages.errors.WRONG_NETWORK(networkName(input.networkPassphrase)),
      );
    }
  } catch (error) {
    if (error instanceof SubscribeError) throw error;
    throw new SubscribeError(
      isRejection(error) ? 'WALLET_REJECTED' : 'WALLET_UNAVAILABLE',
      'connect',
      isRejection(error) ? messages.errors.WALLET_REJECTED : messages.errors.WALLET_UNAVAILABLE,
      { cause: error },
    );
  }

  input.onStep('checking');
  let balance: bigint;
  try {
    balance = await chain.getBalance(terms.token, address);
  } catch (error) {
    throw toSubscribeError(error, 'check');
  }
  if (balance < terms.amount) {
    throw new SubscribeError(
      'INSUFFICIENT_BALANCE',
      'check',
      messages.errors.INSUFFICIENT_BALANCE(
        formatAmount(balance, terms.decimals),
        formatAmount(terms.amount, terms.decimals),
        terms.symbol,
      ),
    );
  }

  const sign: SignFn = (xdr, signer) =>
    wallet.signTransaction(xdr, { networkPassphrase: input.networkPassphrase, address: signer });

  let approveTxHash: string | null = null;
  if (!input.skipApproval) {
    input.onStep('approving');
    try {
      const ledger = await chain.getLedger();
      const approved = await chain.approve({
        token: terms.token,
        owner: address,
        spender: input.contractId,
        amount: approval.cap,
        liveUntilLedger: ledger + approval.durationLedgers,
        sign,
      });
      approveTxHash = approved.txHash;
    } catch (error) {
      throw toSubscribeError(error, 'approve');
    }
  }

  input.onStep('subscribing');
  try {
    const subscribed = await chain.subscribe({ subscriber: address, planId: terms.planId, sign });
    return {
      planId: terms.planId,
      subscriptionId: subscribed.subscriptionId,
      subscriber: address,
      approveTxHash,
      subscribeTxHash: subscribed.txHash,
    };
  } catch (error) {
    throw toSubscribeError(error, 'subscribe', input.skipApproval || approveTxHash !== null);
  }
}
