import { describe, expect, it } from 'vitest';
import { describePeriod, formatAmount, formatDate } from './amount';
import { SubscribeError, plainMessage } from './errors';
import { networkName } from './messages';
import {
  DEFAULT_MAX_APPROVAL_LEDGERS,
  SECONDS_PER_LEDGER,
  approvalExpiry,
  computeApproval,
} from './terms';

const DAY = 86_400;

describe('computeApproval', () => {
  it('covers all requested charges when the network allows it', () => {
    const t = computeApproval({
      amount: 10n,
      periodSecs: 60,
      maxCharges: 12,
      maxLedgers: 3_000_000,
    });
    expect(t.coveredCharges).toBe(12);
    expect(t.cap).toBe(120n);
    // 12 charges of 60 s is 144 ledgers, plus two days of slack for a late charge.
    expect(t.durationLedgers).toBe(12 * 12 + 34_560);
  });

  it('covers fewer charges when the network limit is reached, and says so through coveredCharges', () => {
    const t = computeApproval({
      amount: 10_000_000n,
      periodSecs: 30 * DAY,
      maxCharges: 12,
      maxLedgers: DEFAULT_MAX_APPROVAL_LEDGERS,
    });
    expect(t.coveredCharges).toBe(5);
    expect(t.cap).toBe(50_000_000n);
    expect(t.durationLedgers).toBe(DEFAULT_MAX_APPROVAL_LEDGERS);
  });

  it('never lets the last covered charge fall after the approval ends', () => {
    for (const periodDays of [1, 7, 30, 90, 160]) {
      const t = computeApproval({
        amount: 1n,
        periodSecs: periodDays * DAY,
        maxCharges: 12,
        maxLedgers: DEFAULT_MAX_APPROVAL_LEDGERS,
      });
      const lastChargeLedger =
        t.coveredCharges * Math.ceil((periodDays * DAY) / SECONDS_PER_LEDGER);
      expect(lastChargeLedger, `${String(periodDays)} days`).toBeLessThanOrEqual(t.durationLedgers);
    }
  });

  it('covers zero charges when the period is longer than any approval can last', () => {
    const t = computeApproval({
      amount: 10n,
      periodSecs: 365 * DAY,
      maxCharges: 12,
      maxLedgers: DEFAULT_MAX_APPROVAL_LEDGERS,
    });
    expect(t.coveredCharges).toBe(0);
    expect(t.cap).toBe(0n);
  });

  it('keeps the cap exact for a huge amount', () => {
    const t = computeApproval({
      amount: 2n ** 100n,
      periodSecs: 60,
      maxCharges: 3,
      maxLedgers: 3_000_000,
    });
    expect(t.cap).toBe(3n * 2n ** 100n);
  });

  it('respects a lower limit chosen by the integrator', () => {
    const t = computeApproval({
      amount: 1n,
      periodSecs: 7 * DAY,
      maxCharges: 12,
      maxLedgers: 400_000,
    });
    expect(t.coveredCharges).toBe(
      Math.floor((400_000 - 34_560) / ((7 * DAY) / SECONDS_PER_LEDGER)),
    );
    expect(t.durationLedgers).toBe(400_000);
  });
});

describe('approvalExpiry', () => {
  it('adds the duration to now', () => {
    const now = Date.UTC(2026, 10, 5);
    expect(approvalExpiry(17_280, now).getTime()).toBe(now + 17_280 * 5 * 1000);
  });
});

describe('amount helpers', () => {
  it('formatAmount shows whole tokens without trailing zeros', () => {
    expect(formatAmount(10_000_000n, 7)).toBe('1');
    expect(formatAmount(125_000_000n, 7)).toBe('12.5');
    expect(formatAmount(1n, 7)).toBe('0.0000001');
    expect(formatAmount(0n, 7)).toBe('0');
    expect(formatAmount(7n, 0)).toBe('7');
    expect(formatAmount(2n ** 100n, 0)).toBe((2n ** 100n).toString());
  });

  it('describePeriod uses the largest exact unit', () => {
    expect(describePeriod(60)).toBe('1 minute');
    expect(describePeriod(7200)).toBe('2 hours');
    expect(describePeriod(30 * DAY)).toBe('30 days');
    expect(describePeriod(90)).toBe('90 seconds');
    expect(describePeriod(1)).toBe('1 second');
  });

  it('formatDate gives a readable date', () => {
    expect(formatDate(new Date(Date.UTC(2027, 2, 12, 12)))).toMatch(/2027/);
  });
});

describe('messages and errors', () => {
  it('networkName names the public networks and passes others through', () => {
    expect(networkName('Test SDF Network ; September 2015')).toBe('Testnet');
    expect(networkName('Public Global Stellar Network ; September 2015')).toBe('Mainnet');
    expect(networkName('Standalone Network ; February 2017')).toBe(
      'Standalone Network ; February 2017',
    );
  });

  it('SubscribeError carries its code, step and approved flag', () => {
    const e = new SubscribeError('PENDING', 'subscribe', 'wait', { approved: true });
    expect(e).toMatchObject({
      code: 'PENDING',
      step: 'subscribe',
      approved: true,
      name: 'SubscribeError',
    });
    expect(new SubscribeError('FAILED', 'load', 'x').approved).toBe(false);
  });

  it('plainMessage returns the sentence for a code', () => {
    expect(plainMessage('PLAN_NOT_FOUND')).toContain('does not exist');
  });
});
