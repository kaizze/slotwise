import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';

dayjs.extend(relativeTime);

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency}`;
  }
}

export function formatLastVisit(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = dayjs(iso);
  if (!d.isValid()) return 'Never';
  if (d.isAfter(dayjs().subtract(1, 'day'))) return 'Today';
  return d.fromNow();
}
