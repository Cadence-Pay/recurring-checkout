import { messages } from './messages';

/** Why subscribing did not finish. */
export type SubscribeErrorCode =
  | 'CONFIG'
  | 'PLAN_NOT_FOUND'
  | 'PLAN_INACTIVE'
  | 'PERIOD_TOO_LONG'
  | 'WALLET_UNAVAILABLE'
  | 'WALLET_REJECTED'
  | 'WRONG_NETWORK'
  | 'INSUFFICIENT_BALANCE'
  | 'NETWORK'
  | 'PENDING'
  | 'FAILED';

/** Where in the flow it happened. */
export type SubscribeStep = 'load' | 'connect' | 'check' | 'approve' | 'subscribe';

/**
 * Subscribing did not finish. `message` is written for the person using the widget.
 *
 * `approved` is true when the token approval already went through before the failure, so a retry
 * only needs the subscription step. `pending` errors mean a transaction may still go through.
 */
export class SubscribeError extends Error {
  readonly code: SubscribeErrorCode;
  readonly step: SubscribeStep;
  readonly approved: boolean;

  constructor(
    code: SubscribeErrorCode,
    step: SubscribeStep,
    message: string,
    options: { approved?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SubscribeError';
    this.code = code;
    this.step = step;
    this.approved = options.approved ?? false;
  }
}

/** The plain-words message for a code that needs no extra details. */
export function plainMessage(
  code: Exclude<SubscribeErrorCode, 'WRONG_NETWORK' | 'INSUFFICIENT_BALANCE'>,
): string {
  return messages.errors[code];
}
