export const CONFIRMATION_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export type ConfirmationKeyEvent = Pick<
  KeyboardEvent,
  "key" | "shiftKey" | "preventDefault" | "stopPropagation"
>;

/** Keeps keyboard navigation inside a non-native confirmation dialog. */
export function handleConfirmationKeyDown(
  event: ConfirmationKeyEvent,
  dialog: HTMLElement,
  activeElement: Element | null,
  onCancel: () => void,
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    onCancel();
    return;
  }
  if (event.key !== "Tab") return;

  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(CONFIRMATION_FOCUSABLE_SELECTOR),
  );
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const focusEscapesBackwards = event.shiftKey
    && (activeElement === first || !dialog.contains(activeElement));
  const focusEscapesForwards = !event.shiftKey
    && (activeElement === last || !dialog.contains(activeElement));
  if (!focusEscapesBackwards && !focusEscapesForwards) return;

  event.preventDefault();
  (focusEscapesBackwards ? last : first).focus();
}
