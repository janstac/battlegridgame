import assert from "node:assert/strict";
import test from "node:test";

import { handleConfirmationKeyDown } from "../src/view/confirmationFocus.ts";

type FocusTarget = Readonly<{ focus(): void }>;

function setup(active: "yes" | "no" | "outside") {
  const focused: string[] = [];
  const yes = { focus: () => focused.push("yes") } as FocusTarget as HTMLElement;
  const no = { focus: () => focused.push("no") } as FocusTarget as HTMLElement;
  const outside = { focus: () => focused.push("outside") } as FocusTarget as HTMLElement;
  const dialog = {
    querySelectorAll: () => [yes, no],
    contains: (element: Element | null) => element === yes || element === no,
    focus: () => focused.push("dialog"),
  } as unknown as HTMLElement;
  const prevented: string[] = [];
  const event = (key: string, shiftKey = false) => ({
    key,
    shiftKey,
    preventDefault: () => prevented.push("prevented"),
    stopPropagation: () => prevented.push("stopped"),
  });
  return {
    activeElement: { yes, no, outside }[active],
    dialog,
    event,
    focused,
    prevented,
  };
}

test("Tab wraps in both directions and pulls escaped focus back into the dialog", () => {
  const forwards = setup("no");
  handleConfirmationKeyDown(
    forwards.event("Tab"), forwards.dialog, forwards.activeElement, () => undefined,
  );
  assert.deepEqual(forwards.focused, ["yes"]);
  assert.deepEqual(forwards.prevented, ["prevented"]);

  const backwards = setup("yes");
  handleConfirmationKeyDown(
    backwards.event("Tab", true), backwards.dialog, backwards.activeElement, () => undefined,
  );
  assert.deepEqual(backwards.focused, ["no"]);

  const escaped = setup("outside");
  handleConfirmationKeyDown(
    escaped.event("Tab"), escaped.dialog, escaped.activeElement, () => undefined,
  );
  assert.deepEqual(escaped.focused, ["yes"]);
});

test("Escape is consumed and cancels the confirmation", () => {
  const setupResult = setup("no");
  let cancellations = 0;
  handleConfirmationKeyDown(
    setupResult.event("Escape"),
    setupResult.dialog,
    setupResult.activeElement,
    () => cancellations += 1,
  );
  assert.equal(cancellations, 1);
  assert.deepEqual(setupResult.prevented, ["prevented", "stopped"]);
});
