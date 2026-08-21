import type { BattleId } from "@grid-game/shared";
import { useLayoutEffect, useRef } from "react";
import type { RefCallback } from "react";

import {
  getFlipDelta,
  type FlipRect,
} from "./battleFlip.ts";
import { BattleTile, type BattleTileModel } from "./BattleTile.tsx";
import styles from "./BattleWorkspace.module.css";

const REORDER_DURATION_MS = 180;
const REORDER_EASING = "cubic-bezier(.2, .8, .2, 1)";

type PendingMove = Readonly<{
  before: ReadonlyMap<BattleId, FlipRect>;
  battleId: BattleId;
  direction: -1 | 1;
}>;

export function BattleWorkspace({
  battles,
  order,
  onMove,
  onLeave,
}: Readonly<{
  battles: ReadonlyMap<BattleId, BattleTileModel>;
  order: readonly BattleId[];
  onMove(battleId: BattleId, direction: -1 | 1): void;
  onLeave(battleId: BattleId): void;
}>) {
  const visible = order.flatMap((battleId) => {
    const battle = battles.get(battleId);
    return battle === undefined ? [] : [battle];
  });

  const tilesRef = useRef(new Map<BattleId, HTMLElement>());
  const tileCallbacksRef = useRef(new Map<BattleId, RefCallback<HTMLElement>>());
  const pendingMoveRef = useRef<PendingMove | null>(null);
  const cancelAnimationRef = useRef<(() => void) | null>(null);

  const getTileRef = (battleId: BattleId): RefCallback<HTMLElement> => {
    const existing = tileCallbacksRef.current.get(battleId);
    if (existing !== undefined) return existing;

    const callback: RefCallback<HTMLElement> = (node) => {
      if (node === null) {
        tilesRef.current.delete(battleId);
        tileCallbacksRef.current.delete(battleId);
      } else {
        tilesRef.current.set(battleId, node);
      }
    };
    tileCallbacksRef.current.set(battleId, callback);
    return callback;
  };

  const moveWithAnimation = (battleId: BattleId, direction: -1 | 1) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cancelAnimationRef.current?.();
      pendingMoveRef.current = null;
      onMove(battleId, direction);
      return;
    }

    const before = new Map<BattleId, FlipRect>();
    for (const [id, node] of tilesRef.current) {
      if (!node.isConnected) continue;
      const rect = node.getBoundingClientRect();
      before.set(id, { left: rect.left, top: rect.top });
    }

    cancelAnimationRef.current?.();
    pendingMoveRef.current = { before, battleId, direction };
    onMove(battleId, direction);
  };

  useLayoutEffect(() => {
    const pending = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (pending === null) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const animated: HTMLElement[] = [];
    for (const [battleId, node] of tilesRef.current) {
      if (!node.isConnected) continue;

      const rect = node.getBoundingClientRect();
      const delta = getFlipDelta(
        pending.before.get(battleId),
        { left: rect.left, top: rect.top },
      );
      if (delta === null) continue;

      node.style.transition = "none";
      node.style.transform = `translate3d(${delta.x}px, ${delta.y}px, 0)`;
      node.style.zIndex = battleId === pending.battleId
        ? pending.direction === 1 ? "0" : "1"
        : pending.direction === 1 ? "1" : "0";
      node.style.willChange = "transform";
      animated.push(node);
    }

    if (animated.length === 0) return;

    // Flush the inverted positions before starting the transition on the next frame.
    animated[0]!.getBoundingClientRect();

    let frame = requestAnimationFrame(() => {
      frame = 0;
      for (const node of animated) {
        node.style.transition = `transform ${REORDER_DURATION_MS}ms ${REORDER_EASING}`;
        node.style.transform = "translate3d(0, 0, 0)";
      }
    });

    let timer = window.setTimeout(() => cleanup(), REORDER_DURATION_MS + 80);

    const cleanup = () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      if (timer !== 0) window.clearTimeout(timer);
      timer = 0;
      for (const node of animated) {
        node.removeEventListener("transitionend", handleTransitionEnd);
        node.style.removeProperty("transform");
        node.style.removeProperty("transition");
        node.style.removeProperty("z-index");
        node.style.removeProperty("will-change");
      }
      if (cancelAnimationRef.current === cleanup) cancelAnimationRef.current = null;
    };

    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target === event.currentTarget && event.propertyName === "transform") cleanup();
    };

    for (const node of animated) node.addEventListener("transitionend", handleTransitionEnd);
    cancelAnimationRef.current = cleanup;
  });

  useLayoutEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cancelAndDiscardPending = () => {
      pendingMoveRef.current = null;
      cancelAnimationRef.current?.();
    };

    reducedMotion.addEventListener("change", cancelAndDiscardPending);
    window.addEventListener("resize", cancelAndDiscardPending);
    window.addEventListener("orientationchange", cancelAndDiscardPending);
    return () => {
      reducedMotion.removeEventListener("change", cancelAndDiscardPending);
      window.removeEventListener("resize", cancelAndDiscardPending);
      window.removeEventListener("orientationchange", cancelAndDiscardPending);
      cancelAndDiscardPending();
    };
  }, []);

  if (visible.length === 0) {
    return <p className={styles.empty}>You are not participating in any active battles.</p>;
  }
  return (
    <section className={styles.workspace} aria-label="Your active battles">
      {visible.map((battle, index) => (
        <BattleTile
          key={battle.battleId}
          model={battle}
          index={index}
          count={visible.length}
          articleRef={getTileRef(battle.battleId)}
          onMove={(direction) => moveWithAnimation(battle.battleId, direction)}
          onLeave={() => onLeave(battle.battleId)}
        />
      ))}
    </section>
  );
}
