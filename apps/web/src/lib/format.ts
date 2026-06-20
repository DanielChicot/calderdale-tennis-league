// Format an ISO date (YYYY-MM-DD) as "Thu 23 Apr 2026". Returns the input
// unchanged if it isn't a parseable date.
export const formatDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return iso;
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' });
  const month = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  const year = d.toLocaleDateString('en-GB', { year: 'numeric', timeZone: 'UTC' });
  return `${weekday} ${day} ${month} ${year}`;
};

// Format a numeric score string (drizzle returns numeric columns as strings) to a
// fixed number of decimal places so columns line up on the decimal point — e.g.
// formatScore("509.7") → "509.70", formatScore("62", 1) → "62.0". Returns the input
// unchanged if it isn't a number.
export const formatScore = (value: string, dp = 2): string => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(dp) : value;
};

// Group divisions by their group label, preserving Mens → Ladies → Mixed order.
export type Grouped<T> = { group: 'Mens' | 'Ladies' | 'Mixed'; items: T[] }[];
export const groupByDivisionGroup = <T extends { group: 'Mens' | 'Ladies' | 'Mixed' }>(items: T[]): Grouped<T> => {
  const order: Array<'Mens' | 'Ladies' | 'Mixed'> = ['Mens', 'Ladies', 'Mixed'];
  return order
    .map((group) => ({ group, items: items.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0);
};
