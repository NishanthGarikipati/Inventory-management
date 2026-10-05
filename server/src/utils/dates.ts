/**
 * Date helpers. Shops think in "today", "this month" - not in ISO ranges - so
 * every report accepts a preset and turns it into an inclusive range here.
 */

export type DatePreset = 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_YEAR' | 'CUSTOM';

export function dayRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function resolveRange(
  preset: DatePreset | undefined,
  from?: Date | string,
  to?: Date | string,
): { start: Date; end: Date; label: string } {
  const now = new Date();

  switch (preset) {
    case 'YESTERDAY': {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const range = dayRange(yesterday);
      return { ...range, label: 'Yesterday' };
    }
    case 'THIS_WEEK': {
      const start = new Date(now);
      const weekday = (start.getDay() + 6) % 7; // Monday start
      start.setDate(start.getDate() - weekday);
      start.setHours(0, 0, 0, 0);
      return { start, end: dayRange(now).end, label: 'This Week' };
    }
    case 'THIS_MONTH': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { start, end: dayRange(now).end, label: 'This Month' };
    }
    case 'LAST_MONTH': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { start, end, label: 'Last Month' };
    }
    case 'THIS_YEAR': {
      const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      return { start, end: dayRange(now).end, label: 'This Year' };
    }
    case 'CUSTOM': {
      const start = from ? new Date(from) : dayRange(now).start;
      const end = to ? new Date(to) : dayRange(now).end;
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end, label: 'Custom' };
    }
    default: {
      const range = dayRange(now);
      return { ...range, label: 'Today' };
    }
  }
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
