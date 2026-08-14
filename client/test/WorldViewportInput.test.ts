import assert from "node:assert/strict";
import test from "node:test";

import { MAX_WORLD_SCALE, MIN_WORLD_SCALE } from "../src/world/viewportMath.ts";
import {
  addWorldWheelListener,
  normalizeWorldWheelDelta,
  worldWheelTransform,
  worldWheelZoomFactor,
} from "../src/world/worldViewportInput.ts";

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
