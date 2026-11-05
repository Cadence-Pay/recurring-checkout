/**
 * Show an amount in a token's smallest unit as whole tokens, without trailing zeros.
 *
 * @param raw - Amount in the smallest unit.
 * @param decimals - How many decimal places the token has.
 */
export function formatAmount(raw: bigint, decimals: number): string {
  const digits = raw.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

function plural(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? '' : 's'}`;
}

/** Describe a period in plain words, using the largest unit that divides it exactly. */
export function describePeriod(secs: number): string {
  if (secs % 86_400 === 0) return plural(secs / 86_400, 'day');
  if (secs % 3600 === 0) return plural(secs / 3600, 'hour');
  if (secs % 60 === 0) return plural(secs / 60, 'minute');
  return plural(secs, 'second');
}

/** A date for people, such as `12 March 2027`, in the browser's language. */
export function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}
