/** "1 parola", "3 parole": a number with the right form of its noun. */
export const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
