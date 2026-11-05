import { StrKey } from '@stellar/stellar-sdk';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { describePeriod, formatAmount, formatDate } from './amount';
import { createCheckoutChain, toSubscribeError, type CheckoutChain, type PlanTerms } from './chain';
import { SubscribeError } from './errors';
import { runSubscribeFlow, type FlowStep, type SubscribeResult } from './flow';
import { messages } from './messages';
import {
  DEFAULT_MAX_APPROVAL_LEDGERS,
  DEFAULT_MAX_CHARGES,
  approvalExpiry,
  computeApproval,
} from './terms';
import { createKitAdapter, type WalletAdapter } from './wallet';

/** Props of {@link SubscribeButton}. */
export interface SubscribeButtonProps {
  /** The plan to subscribe to. A whole number from 1. */
  planId: number;
  /** The recurring contract (starts with C). */
  contractId: string;
  /** Stellar RPC server URL. */
  rpcUrl: string;
  /** Network passphrase, for example `Test SDF Network ; September 2015`. */
  networkPassphrase: string;
  /** Called once when the person is subscribed. */
  onSuccess?: (result: SubscribeResult) => void;
  /** Called when subscribing fails or cannot start. The error has a code and a readable message. */
  onError?: (error: SubscribeError) => void;
  /**
   * How many later charges the token approval covers at most. Default 12. The approval may cover
   * fewer if the network does not let it last that long; the widget says how many.
   */
  maxCharges?: number;
  /** Longest the approval may last, in ledgers. Default 3,000,000 (about 174 days). */
  maxApprovalLedgers?: number;
  /** Wallet to use. Defaults to the Stellar Wallets Kit chooser, which must then be installed. */
  wallet?: WalletAdapter;
  /** Replaces the network layer. For tests and advanced use. */
  chain?: CheckoutChain;
  /** Extra class name for the outer element. */
  className?: string;
}

type View =
  | { readonly kind: 'config'; readonly error: SubscribeError }
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable'; readonly error: SubscribeError }
  | { readonly kind: 'ready' }
  | { readonly kind: 'working'; readonly step: FlowStep }
  | { readonly kind: 'failed'; readonly error: SubscribeError }
  | { readonly kind: 'done'; readonly result: SubscribeResult };

const STEP_MESSAGE: Record<FlowStep, (onlySubscribe: boolean) => string> = {
  connecting: () => messages.stepConnecting,
  checking: () => messages.stepChecking,
  approving: () => messages.stepApproving,
  subscribing: (only) => (only ? messages.stepSubscribingOnly : messages.stepSubscribing),
};

/** Check the props before any network call. Returns an error describing the first problem. */
export function validateProps(props: SubscribeButtonProps): SubscribeError | undefined {
  const bad = (what: string) =>
    new SubscribeError('CONFIG', 'load', `${messages.errors.CONFIG} (${what})`);
  if (!Number.isSafeInteger(props.planId) || props.planId < 1) return bad('planId');
  if (!StrKey.isValidContract(props.contractId)) return bad('contractId');
  if (!/^https?:\/\/.+/.test(props.rpcUrl)) return bad('rpcUrl');
  if (props.networkPassphrase.trim() === '') return bad('networkPassphrase');
  if (
    props.maxCharges !== undefined &&
    (!Number.isSafeInteger(props.maxCharges) || props.maxCharges < 1)
  ) {
    return bad('maxCharges');
  }
  return undefined;
}

/**
 * A button that subscribes the person to a recurring plan.
 *
 * It loads the plan and shows the terms in plain words: the price, the period, and exactly what the
 * person authorizes (how much the plan may take later, and until when). On click it connects the
 * wallet, checks the balance, asks for the token approval, then subscribes, which makes the first
 * payment. Every failure is shown as a readable message and reported through `onError`.
 *
 * Style it with the CSS variables in `style.css` (see the README).
 */
export function SubscribeButton(props: SubscribeButtonProps) {
  const { planId, contractId, rpcUrl, networkPassphrase } = props;
  const headingId = useId();
  const configError = useMemo(() => validateProps(props), [props]);
  const [view, setView] = useState<View>(
    configError === undefined ? { kind: 'loading' } : { kind: 'config', error: configError },
  );
  const [terms, setTerms] = useState<PlanTerms | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  const approvedInSession = useRef(false);
  const onSuccess = useRef(props.onSuccess);
  const onError = useRef(props.onError);
  onSuccess.current = props.onSuccess;
  onError.current = props.onError;

  const chain = useMemo(
    () => props.chain ?? createCheckoutChain({ contractId, rpcUrl, networkPassphrase }),
    [props.chain, contractId, rpcUrl, networkPassphrase],
  );
  const wallet = useMemo(
    () => props.wallet ?? createKitAdapter(networkPassphrase),
    [props.wallet, networkPassphrase],
  );
  const maxCharges = props.maxCharges ?? DEFAULT_MAX_CHARGES;
  const maxLedgers = props.maxApprovalLedgers ?? DEFAULT_MAX_APPROVAL_LEDGERS;
  const approval = useMemo(
    () =>
      terms === undefined
        ? undefined
        : computeApproval({
            amount: terms.amount,
            periodSecs: terms.periodSecs,
            maxCharges,
            maxLedgers,
          }),
    [terms, maxCharges, maxLedgers],
  );

  useEffect(() => {
    if (configError !== undefined) {
      setView({ kind: 'config', error: configError });
      onError.current?.(configError);
      return undefined;
    }
    let cancelled = false;
    setView({ kind: 'loading' });
    approvedInSession.current = false;
    chain.getPlanTerms(planId).then(
      (loaded) => {
        if (cancelled) return;
        setTerms(loaded);
        const blocked = !loaded.active
          ? new SubscribeError('PLAN_INACTIVE', 'load', messages.errors.PLAN_INACTIVE)
          : computeApproval({
                amount: loaded.amount,
                periodSecs: loaded.periodSecs,
                maxCharges,
                maxLedgers,
              }).coveredCharges < 1
            ? new SubscribeError('PERIOD_TOO_LONG', 'load', messages.errors.PERIOD_TOO_LONG)
            : undefined;
        if (blocked === undefined) {
          setView({ kind: 'ready' });
        } else {
          setView({ kind: 'unavailable', error: blocked });
          onError.current?.(blocked);
        }
      },
      (error: unknown) => {
        if (cancelled) return;
        const failure = toSubscribeError(error, 'load');
        setView({ kind: 'unavailable', error: failure });
        onError.current?.(failure);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [chain, planId, configError, maxCharges, maxLedgers, reloadKey]);

  async function subscribe() {
    if (terms === undefined || approval === undefined || view.kind === 'working') return;
    const onlySubscribe = approvedInSession.current;
    setView({ kind: 'working', step: 'connecting' });
    try {
      const result = await runSubscribeFlow({
        chain,
        wallet,
        contractId,
        networkPassphrase,
        terms,
        approval,
        skipApproval: onlySubscribe,
        onStep: (step) => {
          setView({ kind: 'working', step });
        },
      });
      setView({ kind: 'done', result });
      onSuccess.current?.(result);
    } catch (error) {
      const failure =
        error instanceof SubscribeError ? error : toSubscribeError(error, 'subscribe');
      if (failure.approved) approvedInSession.current = true;
      setView({ kind: 'failed', error: failure });
      onError.current?.(failure);
    }
  }

  const root = `rc-root${props.className === undefined ? '' : ` ${props.className}`}`;

  if (view.kind === 'config' || view.kind === 'unavailable') {
    return (
      <section className={root} aria-labelledby={headingId}>
        <h2 id={headingId} className="rc-heading">
          {messages.planUnavailableTitle}
        </h2>
        <p role="alert" className="rc-error">
          {view.error.message}
        </p>
        {view.kind === 'unavailable' &&
        (view.error.code === 'NETWORK' || view.error.code === 'FAILED') ? (
          <button
            type="button"
            className="rc-button rc-button--secondary"
            onClick={() => {
              setReloadKey((n) => n + 1);
            }}
          >
            {messages.retry}
          </button>
        ) : null}
      </section>
    );
  }

  if (view.kind === 'loading' || terms === undefined || approval === undefined) {
    return (
      <section className={root} aria-labelledby={headingId} aria-busy="true">
        <h2 id={headingId} className="rc-heading">
          {messages.termsHeading}
        </h2>
        <p role="status" className="rc-muted">
          {messages.loadingPlan}
        </p>
      </section>
    );
  }

  const amount = formatAmount(terms.amount, terms.decimals);
  const period = describePeriod(terms.periodSecs);
  const cap = formatAmount(approval.cap, terms.decimals);
  const until = formatDate(approvalExpiry(approval.durationLedgers, Date.now()));
  const working = view.kind === 'working';
  const pending = view.kind === 'failed' && view.error.code === 'PENDING';

  return (
    <section className={root} aria-labelledby={headingId} aria-busy={working}>
      <h2 id={headingId} className="rc-heading">
        {messages.termsHeading}
      </h2>
      <p className="rc-price">{messages.priceLine(amount, terms.symbol, period)}</p>
      <ul className="rc-terms">
        <li>{messages.firstPayment(amount, terms.symbol)}</li>
        <li>{messages.laterPayments(amount, terms.symbol, period)}</li>
        <li>{messages.allowanceLine(cap, terms.symbol, approval.coveredCharges, until)}</li>
      </ul>
      <p className="rc-muted">{messages.allowanceNote}</p>
      <p className="rc-muted">{messages.twoSteps}</p>

      {view.kind === 'done' ? (
        <div role="status" className="rc-success">
          <strong>{messages.successTitle}</strong>
          <p>{messages.success(view.result.subscriptionId)}</p>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="rc-button"
            disabled={working || pending}
            onClick={() => void subscribe()}
          >
            {view.kind === 'failed'
              ? messages.tryAgain
              : messages.subscribeWith(amount, terms.symbol)}
          </button>
          {working ? (
            <p role="status" className="rc-muted">
              {STEP_MESSAGE[view.step](approvedInSession.current)}
            </p>
          ) : null}
          {view.kind === 'failed' ? (
            <>
              <p role="alert" className="rc-error">
                {view.error.message}
              </p>
              {view.error.approved ? (
                <p className="rc-muted">{messages.approvedButNotSubscribed}</p>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
