import assert from "node:assert/strict";
import test from "node:test";

import type { WorldCell } from "@grid-game/shared";
import {
  WAITING_CHALLENGE_DESCRIPTION,
  isWorldCellActionable,
  isWorldChallengeCell,
  worldCellDescription,
  worldCellLabel,
  worldDetailHeading,
} from "../src/world/worldCellPresentation.ts";

const waitingCell: WorldCell = {
  kind: "challengeWaiting",
  challengeId: "challenge-4",
  waitingId: 91,
  defenderId: "defender",
  participantIds: ["defender", "challenger"],
};

test("presents waiting challenges without exposing their internal queue ID", () => {
  const visibleText = [
    worldCellLabel(waitingCell, 10_000),
    worldCellDescription(waitingCell, 2, 3),
    worldDetailHeading(waitingCell, "challenger"),
    WAITING_CHALLENGE_DESCRIPTION,
  ].join(" ");

  assert.equal(worldCellLabel(waitingCell, 10_000), "Waiting");
  assert.match(visibleText, /waiting for battle capacity/i);
  assert.doesNotMatch(visibleText, /91|queue/i);
  assert.equal(isWorldChallengeCell(waitingCell), true);
  assert.equal(isWorldCellActionable(waitingCell, "spectator"), true);
});

test("uses the countdown label as soon as a waiting challenge is promoted", () => {
  const countdownCell: WorldCell = {
    kind: "challengePending",
    challengeId: "challenge-4",
    defenderId: "defender",
    participantIds: ["defender", "challenger"],
    closesAt: 12_001,
  };

  assert.equal(worldCellLabel(countdownCell, 10_000), "3s");
  assert.equal(worldDetailHeading(countdownCell, "challenger"), "Challenge gathering players");
});
