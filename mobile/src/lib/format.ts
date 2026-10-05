/**
 * All money crosses the wire as whole paise. It is only turned into rupees
 * at the edge, here, so no arithmetic in the app ever sees a float.
 */
export const rupees = (paise: number): number => paise / 100;

export const paise = (rupeeValue: number | string): number =>
  Math.round(Number(rupeeValue || 0) * 100);

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const inrExact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Shop-owner money: ₹25,450. Paise are hidden unless they matter. */
export function money(value: number, options: { exact?: boolean } = {}): string {
  const amount = rupees(value);
  if (options.exact || Math.abs(amount % 1) > 0.001) return inrExact.format(amount);
  return inr.format(amount);
}

/** Compact form for dashboard tiles: ₹1.2L, ₹25.4k. */
export function moneyShort(value: number): string {
  const amount = Math.abs(rupees(value));
  const sign = value < 0 ? '-' : '';
  if (amount >= 10_000_000) return `${sign}₹${(amount / 10_000_000).toFixed(2)}Cr`;
  if (amount >= 100_000) return `${sign}₹${(amount / 100_000).toFixed(2)}L`;
  if (amount >= 1_000) return `${sign}₹${(amount / 1_000).toFixed(1)}k`;
  return money(value);
}

export const quantity = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));

export const dateLabel = (value: string | Date): string =>
  new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export const timeLabel = (value: string | Date): string =>
  new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

export const dateTimeLabel = (value: string | Date): string =>
  `${dateLabel(value)}, ${timeLabel(value)}`;

export const percent = (value: number): string => `${Math.round(value * 100)}%`;

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
