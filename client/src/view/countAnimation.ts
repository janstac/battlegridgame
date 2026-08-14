/** A displayed count change has feedback only when it increased. */
export function shouldAnimateCountChange(
  previousCount: number,
  count: number,
): boolean {
  return count > previousCount;
}
