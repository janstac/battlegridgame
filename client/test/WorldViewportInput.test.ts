import assert from "node:assert/strict";
import test from "node:test";

import { MAX_WORLD_SCALE, MIN_WORLD_SCALE } from "../src/world/viewportMath.ts";
import {
  addWorldPointerTerminationListener,
  addWorldWheelListener,
  isWorldPointerContactActive,
  normalizeWorldWheelDelta,
  WorldPointerContacts,
  worldWheelTransform,
  worldWheelZoomFactor,
} from "../src/world/worldViewportInput.ts";

test("world pointer tracking discards a mouse released outside the viewer", () => {
  assert.equal(isWorldPointerContactActive({ pointerType: "mouse", buttons: 1 }), true);
  assert.equal(isWorldPointerContactActive({ pointerType: "mouse", buttons: 0 }), false);
  assert.equal(isWorldPointerContactActive({ pointerType: "mouse", buttons: 2 }), false);
  assert.equal(isWorldPointerContactActive({ pointerType: "touch", buttons: 0 }), true);
  assert.equal(isWorldPointerContactActive({ pointerType: "pen", buttons: 0 }), true);
});

class RecordingPointerCaptureTarget {
  readonly captures: number[] = [];
  readonly releases: number[] = [];
  readonly captured = new Set<number>();

  hasPointerCapture(pointerId: number): boolean {
    return this.captured.has(pointerId);
  }

  setPointerCapture(pointerId: number): void {
    this.captures.push(pointerId);
    this.captured.add(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.releases.push(pointerId);
    this.captured.delete(pointerId);
  }
}

test("touch tracking captures on contact and remains active across repeated moves until release", () => {
  const contacts = new WorldPointerContacts();
  const target = new RecordingPointerCaptureTarget();
  const touch = { pointerId: 7, pointerType: "touch", button: 0, buttons: 0 };

  assert.equal(contacts.begin(touch, { x: 10, y: 12 }, target), true);
  assert.deepEqual(target.captures, [7]);
  assert.equal(contacts.update(touch, { x: 12, y: 13 }), true);
  assert.equal(contacts.update(touch, { x: 18, y: 16 }), true);
  assert.equal(contacts.update(touch, { x: 46, y: 29 }), true);
  assert.deepEqual(contacts.values(), [{ x: 46, y: 29 }]);

  assert.equal(contacts.finish(7, target), true);
  assert.deepEqual(target.releases, [7]);
  assert.equal(contacts.size, 0);
  assert.equal(contacts.update(touch, { x: 80, y: 80 }), false);
});

test("pen and pinch contacts capture immediately while mouse capture remains drag-driven", () => {
  const contacts = new WorldPointerContacts();
  const target = new RecordingPointerCaptureTarget();

  assert.equal(contacts.begin(
    { pointerId: 1, pointerType: "pen", button: 0, buttons: 1 },
    { x: 5, y: 5 },
    target,
  ), true);
  assert.equal(contacts.begin(
    { pointerId: 2, pointerType: "touch", button: 0, buttons: 0 },
    { x: 25, y: 5 },
    target,
  ), true);
  assert.deepEqual(target.captures, [1, 2]);
  assert.equal(contacts.begin(
    { pointerId: 3, pointerType: "touch", button: 0, buttons: 0 },
    { x: 40, y: 5 },
    target,
  ), false);

  contacts.finish(1, target);
  contacts.finish(2, target);
  assert.equal(contacts.begin(
    { pointerId: 4, pointerType: "mouse", button: 0, buttons: 1 },
    { x: 10, y: 10 },
    target,
  ), true);
  assert.deepEqual(target.captures, [1, 2]);
  contacts.captureAll(target);
  assert.deepEqual(target.captures, [1, 2, 4]);
  assert.equal(contacts.update(
    { pointerId: 4, pointerType: "mouse", buttons: 0 },
    { x: 11, y: 10 },
  ), false);
});

class RecordingWheelTarget {
  readonly additions: Array<{
    listener: EventListenerOrEventListenerObject;
    options?: boolean | AddEventListenerOptions;
    type: string;
  }> = [];
  readonly removals: Array<{
    listener: EventListenerOrEventListenerObject;
    options?: boolean | EventListenerOptions;
    type: string;
  }> = [];

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.additions.push({ type, listener, ...(options === undefined ? {} : { options }) });
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    this.removals.push({ type, listener, ...(options === undefined ? {} : { options }) });
  }
}

function invokeListener(listener: EventListenerOrEventListenerObject, event: Event): void {
  if (typeof listener === "function") listener(event);
  else listener.handleEvent(event);
}

test("world pointer termination follows contacts released outside the viewer", () => {
  const target = new RecordingWheelTarget();
  const finished: number[] = [];
  const cleanup = addWorldPointerTerminationListener(
    target as unknown as EventTarget,
    (pointerId) => finished.push(pointerId),
  );

  assert.deepEqual(target.additions.map(({ type }) => type), ["pointerup", "pointercancel"]);
  for (const [index, addition] of target.additions.entries()) {
    invokeListener(addition.listener, { pointerId: index + 3 } as unknown as Event);
  }
  assert.deepEqual(finished, [3, 4]);

  cleanup();
  assert.deepEqual(target.removals.map(({ type }) => type), ["pointerup", "pointercancel"]);
  assert.strictEqual(target.removals[0]?.listener, target.additions[0]?.listener);
  assert.strictEqual(target.removals[1]?.listener, target.additions[1]?.listener);
});

test("world wheel deltas preserve the existing pixel, line, and page scaling", () => {
  assert.equal(normalizeWorldWheelDelta(12, 0, 480), 12);
  assert.equal(normalizeWorldWheelDelta(3, 1, 480), 48);
  assert.equal(normalizeWorldWheelDelta(2, 2, 480), 960);
  assert.equal(normalizeWorldWheelDelta(2, 2, 0), 2);
  assert.equal(normalizeWorldWheelDelta(7, 99, 480), 7);
});

test("world wheel direction and rate match the previous exponential zoom", () => {
  assert.equal(worldWheelZoomFactor(0, 0, 600), 1);
  assert.equal(worldWheelZoomFactor(100, 0, 600), Math.exp(-0.15));
  assert.equal(worldWheelZoomFactor(-100, 0, 600), Math.exp(0.15));
  assert.ok(worldWheelZoomFactor(1, 0, 600) < 1);
  assert.ok(worldWheelZoomFactor(-1, 0, 600) > 1);
});

test("world wheel zoom stays anchored beneath the pointer and clamps scale", () => {
  const viewport = { width: 500, height: 400 };
  const content = { width: 1_000, height: 1_000 };
  const bounds = { left: 40, top: 25 };
  const anchor = { x: 210, y: 135 };
  const before = { x: -100, y: -80, scale: 1 };
  const after = worldWheelTransform(
    before,
    { clientX: anchor.x + bounds.left, clientY: anchor.y + bounds.top, deltaMode: 0, deltaY: -200 },
    bounds,
    viewport,
    content,
  );

  assert.equal((anchor.x - before.x) / before.scale, (anchor.x - after.x) / after.scale);
  assert.equal((anchor.y - before.y) / before.scale, (anchor.y - after.y) / after.scale);
  assert.equal(
    worldWheelTransform(after, { clientX: 250, clientY: 200, deltaMode: 2, deltaY: -100 }, bounds, viewport, content).scale,
    MAX_WORLD_SCALE,
  );
  assert.equal(
    worldWheelTransform(after, { clientX: 250, clientY: 200, deltaMode: 2, deltaY: 100 }, bounds, viewport, content).scale,
    MIN_WORLD_SCALE,
  );
  assert.equal(
    worldWheelTransform(before, { clientX: 250, clientY: 200, deltaMode: 0, deltaY: 0 }, bounds, viewport, content),
    before,
  );
});

test("world wheel listener is non-passive, modifier-independent, and removed cleanly", () => {
  const target = new RecordingWheelTarget();
  const received: WheelEvent[] = [];
  let preventDefaultCount = 0;
  const cleanup = addWorldWheelListener(target as unknown as HTMLElement, (event) => {
    assert.equal(preventDefaultCount, 1);
    received.push(event);
  });

  assert.equal(target.additions.length, 1);
  assert.equal(target.additions[0]?.type, "wheel");
  assert.deepEqual(target.additions[0]?.options, { passive: false });

  const listener = target.additions[0]!.listener;
  for (const modifiers of [
    { ctrlKey: false, metaKey: false },
    { ctrlKey: true, metaKey: false },
    { ctrlKey: false, metaKey: true },
  ]) {
    preventDefaultCount = 0;
    const event = {
      ...modifiers,
      preventDefault: () => { preventDefaultCount += 1; },
    } as unknown as WheelEvent;
    invokeListener(listener, event);
    assert.equal(preventDefaultCount, 1);
  }
  assert.equal(received.length, 3);

  cleanup();
  assert.equal(target.removals.length, 1);
  assert.equal(target.removals[0]?.type, "wheel");
  assert.equal(target.removals[0]?.listener, listener);
});
