export const slugify = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const parseIntStrict = (input: string): number => {
  if (!/^-?\d+$/.test(input)) {
    throw new Error(`parseIntStrict: not an integer: ${JSON.stringify(input)}`);
  }
  return Number(input);
};

export const parseScore = (input: string): { home: number; away: number } => {
  const match = /^(\d+)-(\d+)$/.exec(input.trim());
  if (!match) {
    throw new Error(`parseScore: not a score: ${JSON.stringify(input)}`);
  }
  return { home: Number(match[1]), away: Number(match[2]) };
};
