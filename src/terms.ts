/** Seconds between ledgers on Stellar (measured on testnet: about 5). */
export const SECONDS_PER_LEDGER = 5;

/** How many later charges the approval covers unless the integrator says otherwise. */
export const DEFAULT_MAX_CHARGES = 12;

/**
 * Longest an approval may last, in ledgers. The network refuses an approval that ends more than
 * `max_entry_ttl` ledgers from now (3,110,400 on testnet, about 180 days). This stays a little
 * below that on purpose. Integrators can lower it; raising it above the network limit makes
 * approvals fail.
 */
export const DEFAULT_MAX_APPROVAL_LEDGERS = 3_000_000;

/** Extra time after the last covered charge, so a late charge still finds a valid approval. */
const SLACK_LEDGERS = 34_560; // two days

/** What the token approval will contain. */
export interface ApprovalTerms {
  /** Most the contract may take in total, in the token's smallest unit. */
  readonly cap: bigint;
  /** How many charges (after the first payment) the cap covers. */
  readonly coveredCharges: number;
  /** How long the approval lasts, counted from the moment it is made. */
  readonly durationLedgers: number;
}

/**
 * Work out how much to approve and for how long.
 *
 * The first payment is made directly at subscribe and needs no approval. The approval covers the
 * charges after it: `maxCharges` of them if the network lets an approval last that long, fewer if
 * not. If not even one charge fits (the billing period is longer than an approval can last), the
 * result has `coveredCharges` of 0 and cannot be used.
 *
 * @param input.amount - Plan amount per period, in the smallest unit.
 * @param input.periodSecs - Plan period in seconds.
 * @param input.maxCharges - How many later charges to cover at most.
 * @param input.maxLedgers - Longest an approval may last, in ledgers.
 */
export function computeApproval(input: {
  amount: bigint;
  periodSecs: number;
  maxCharges: number;
  maxLedgers: number;
}): ApprovalTerms {
  const { amount, periodSecs, maxCharges, maxLedgers } = input;
  const periodLedgers = Math.ceil(periodSecs / SECONDS_PER_LEDGER);
  const wanted = periodLedgers * maxCharges + SLACK_LEDGERS;
  const durationLedgers = Math.min(wanted, maxLedgers);
  const covered = Math.min(
    maxCharges,
    Math.max(0, Math.floor((durationLedgers - SLACK_LEDGERS) / periodLedgers)),
  );
  return { cap: amount * BigInt(covered), coveredCharges: covered, durationLedgers };
}

/**
 * When an approval made now will end, for display.
 *
 * @param durationLedgers - From {@link computeApproval}.
 * @param nowMs - The current time in milliseconds.
 */
export function approvalExpiry(durationLedgers: number, nowMs: number): Date {
  return new Date(nowMs + durationLedgers * SECONDS_PER_LEDGER * 1000);
}
