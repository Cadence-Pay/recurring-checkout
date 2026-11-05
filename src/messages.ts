/**
 * Every sentence the widget shows lives in this file.
 *
 * WAVE-ISSUE(checkout-3): translating the widget means replacing this object with a message
 * catalog chosen by locale. The MVP has English only, in one place, so that work stays small.
 */
export const messages = {
  loadingPlan: 'Loading the plan…',
  planUnavailableTitle: 'This plan cannot be shown',
  retry: 'Try again',

  termsHeading: 'Subscription',
  priceLine: (amount: string, symbol: string, period: string) =>
    `${amount} ${symbol} every ${period}`,
  firstPayment: (amount: string, symbol: string) =>
    `You pay ${amount} ${symbol} now, for the first period.`,
  laterPayments: (amount: string, symbol: string, period: string) =>
    `After that, ${amount} ${symbol} is charged automatically every ${period} until you cancel.`,
  allowanceLine: (cap: string, symbol: string, charges: number, until: string) =>
    `To allow those later charges you approve up to ${cap} ${symbol} (${String(charges)} ${
      charges === 1 ? 'charge' : 'charges'
    }), valid until about ${until}. After that date charging stops until you approve again.`,
  allowanceNote:
    'You can cancel at any time, and you can remove the approval in your wallet. The approval lets only this plan’s contract take the plan amount once per period.',
  twoSteps: 'Your wallet will ask you to sign twice: first the approval, then the subscription.',

  subscribe: 'Subscribe',
  subscribeWith: (amount: string, symbol: string) => `Subscribe for ${amount} ${symbol}`,
  tryAgain: 'Try again',

  stepConnecting: 'Connecting to your wallet…',
  stepChecking: 'Checking your balance…',
  stepApproving: 'Step 1 of 2: approve the payments in your wallet…',
  stepSubscribing: 'Step 2 of 2: confirm the subscription in your wallet…',
  stepSubscribingOnly: 'Confirm the subscription in your wallet…',

  successTitle: 'You are subscribed',
  success: (subscriptionId: number) =>
    `Subscription ${String(subscriptionId)} is active. The first payment has been made.`,

  errors: {
    CONFIG: 'The widget is not set up correctly. Contact the site owner.',
    PLAN_NOT_FOUND: 'This plan does not exist.',
    PLAN_INACTIVE: 'This plan no longer accepts new subscribers.',
    PERIOD_TOO_LONG:
      'This plan’s billing period is longer than the network allows a payment approval to last, so it cannot be subscribed to here.',
    WALLET_UNAVAILABLE:
      'No wallet is available. Install a Stellar wallet or reload the page and try again.',
    WALLET_REJECTED: 'You closed or declined the request in your wallet. Nothing was charged.',
    WRONG_NETWORK: (expected: string) =>
      `Your wallet is on a different network. Switch it to ${expected} and try again.`,
    INSUFFICIENT_BALANCE: (have: string, need: string, symbol: string) =>
      `Your balance is ${have} ${symbol}, but the first payment is ${need} ${symbol}.`,
    NETWORK: 'Could not reach the network. Check your connection and try again.',
    PENDING:
      'The transaction was sent but is not confirmed yet. Wait a minute and check your wallet before trying again.',
    FAILED: 'Something went wrong and nothing was charged. Please try again.',
  },
  paymentFailed:
    'The payment could not be made. Your balance may be too low for the first payment.',
  accountNotFunded: 'This account has no funds on this network yet, so it cannot pay.',
  approvedButNotSubscribed:
    'Your approval went through, but the subscription did not. Press the button to finish; you will not be asked to approve again.',
} as const;

/** A name for a network passphrase: the well-known ones by name, any other as it is. */
export function networkName(passphrase: string): string {
  if (passphrase === 'Test SDF Network ; September 2015') return 'Testnet';
  if (passphrase === 'Public Global Stellar Network ; September 2015') return 'Mainnet';
  return passphrase;
}
