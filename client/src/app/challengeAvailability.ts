/** Native Challenge-button state derived from the server-authoritative capacity flag. */
export function challengeActionDisabled(
  busy: boolean,
  challengeable: boolean,
): boolean {
  return busy || !challengeable;
}
