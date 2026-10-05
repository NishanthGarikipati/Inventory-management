/**
 * The date windows a shop actually thinks in. Report endpoints take the preset
 * name; list endpoints take explicit from/to, so both are produced here from
 * one choice.
 */
export type RangeKey = 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_YEAR';

export const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'YESTERDAY', label: 'Yesterday' },
  { value: 'THIS_WEEK', label: 'This week' },
  { value: 'THIS_MONTH', label: 'This month' },
  { value: 'LAST_MONTH', label: 'Last month' },
  { value: 'THIS_YEAR', label: 'This year' },
];

const startOfDay = (date: Date): Date => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const endOfDay = (date: Date): Date => {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
};

export function rangeFor(key: RangeKey): { from: string; to: string; label: string } {
  const now = new Date();
  switch (key) {
    case 'YESTERDAY': {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      return { from: startOfDay(yesterday).toISOString(), to: endOfDay(yesterday).toISOString(), label: 'Yesterday' };
    }
    case 'THIS_WEEK': {
      const start = new Date(now);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      return { from: startOfDay(start).toISOString(), to: endOfDay(now).toISOString(), label: 'This week' };
    }
    case 'THIS_MONTH': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(start).toISOString(), to: endOfDay(now).toISOString(), label: 'This month' };
    }
    case 'LAST_MONTH': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: startOfDay(start).toISOString(), to: endOfDay(end).toISOString(), label: 'Last month' };
    }
    case 'THIS_YEAR': {
      const start = new Date(now.getFullYear(), 0, 1);
      return { from: startOfDay(start).toISOString(), to: endOfDay(now).toISOString(), label: 'This year' };
    }
    default:
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString(), label: 'Today' };
  }
}
