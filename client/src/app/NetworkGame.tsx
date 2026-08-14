import type {
  BattleId,
  BattleParticipantId,
  ChallengeId,
  PlayerId,
  Position,
  WorldCell,
} from "@grid-game/shared";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

import {
  BattleWorkspace,
  moveBattle,
  type BattleTileModel,
} from "../battle/index.ts";
import { ClientBattleState, type ClientWorldState } from "../model/index.ts";
import { getNetworkUrl } from "../network/networkUrl.ts";
import {
  NetworkClient,
  type NetworkBattleSession,
  type NetworkClientEvent,
} from "../session/index.ts";
import { ActionButton } from "../ui/ActionButton.tsx";
import { GamePage } from "../ui/GamePage.tsx";
import { StatusNotice } from "../ui/StatusNotice.tsx";
import type { PlayerColorId } from "../view/index.ts";
import {
  WorldCellPopup,
  WorldGridView,
  WorldViewport,
  worldPlayerColor,
} from "../world/index.ts";
import styles from "./NetworkGame.module.css";
import {
  createWorldDisclosureState,
  getCompactWorldMode,
  reduceWorldDisclosure,
  subscribeToCompactWorldMode,
  WorldDisclosureRegion,
  type WorldDisclosureState,
} from "./worldDisclosure.ts";

const WORLD_PANEL_ID = "network-world-panel";

type ConnectionState =
  | { kind: "connecting" }
  | { kind: "ready"; client: NetworkClient }
  | { kind: "error"; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected network error occurred.";
}

function createBattleModel(session: NetworkBattleSession): BattleTileModel {
  const battle = new ClientBattleState(session, session.localParticipantId);
  const participantColorIds = new Map<BattleParticipantId, PlayerColorId>();
  const participantLabels = new Map<BattleParticipantId, string>();
  session.roster.forEach(({ participantId, playerId }, index) => {
    participantColorIds.set(participantId, index as PlayerColorId);
    participantLabels.set(participantId, playerId);
  });
  return {
    battleId: session.battleId,
    battle,
    worldPosition: session.worldPosition,
    participantColorIds,
    participantLabels,
  };
}

function useWorldState(world: ClientWorldState) {
  return useSyncExternalStore(world.subscribe, world.getSnapshot, world.getSnapshot);
}

function useCompactWorldMode() {
  return useSyncExternalStore(
    subscribeToCompactWorldMode,
    getCompactWorldMode,
    () => false,
  );
}

function positionIndex(position: Position, width: number): number {
  return position.y * width + position.x;
}

function WorldDetail({
  cell,
  localPlayerId,
  busy,
  onChallenge,
  onJoin,
  onLeave,
}: Readonly<{
  cell: WorldCell;
  localPlayerId: PlayerId;
  busy: boolean;
  onChallenge(): void;
  onJoin(challengeId: ChallengeId): void;
  onLeave(challengeId: ChallengeId): void;
}>) {
  return (
    <aside className={styles.worldDetail} aria-live="polite">
      <div>
        {cell.kind === "unoccupied" && <strong>Unoccupied</strong>}
        {cell.kind === "occupied" && (
          <strong>{cell.playerId === localPlayerId ? "Your cell" : `Owned by ${cell.playerId}`}</strong>
        )}
        {cell.kind === "challengePending" && <strong>Challenge gathering players</strong>}
        {cell.kind === "battle" && <strong>Battle in progress</strong>}
      </div>
      {cell.kind === "occupied" && cell.playerId !== localPlayerId && (
        <ActionButton className={styles.challengeAction} type="button" disabled={busy} onClick={onChallenge}>Challenge</ActionButton>
      )}
      {cell.kind === "challengePending" && (
        <div className={styles.challengeDetail}>
          <span>{cell.participantIds.length}/4 participants</span>
          <div className={styles.roster}>
            {cell.participantIds.map((playerId) => (
              <span key={playerId}><i style={{ background: worldPlayerColor(playerId) }} />{playerId}</span>
            ))}
          </div>
          {cell.participantIds.includes(localPlayerId) ? (
            <ActionButton variant="secondary" type="button" disabled={busy} onClick={() => onLeave(cell.challengeId)}>
              Leave challenge
            </ActionButton>
          ) : (
            <ActionButton type="button" disabled={busy || cell.participantIds.length >= 4} onClick={() => onJoin(cell.challengeId)}>
              {cell.participantIds.length >= 4 ? "Challenge full" : "Join challenge"}
            </ActionButton>
          )}
        </div>
      )}
      {cell.kind === "battle" && (
        <div className={styles.challengeDetail}>
          <span>{cell.playerIds.length} participants</span>
          <div className={styles.roster}>
            {cell.playerIds.map((playerId) => (
              <span key={playerId}><i style={{ background: worldPlayerColor(playerId) }} />{playerId}</span>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function NetworkViewer({
  world,
  localPlayerId,
  battles,
  order,
  now,
  onMove,
  disclosure,
  onToggleWorld,
  worldPanelRef,
  worldToggleRef,
}: Readonly<{
  world: NetworkClient["world"];
  localPlayerId: PlayerId;
  battles: ReadonlyMap<BattleId, BattleTileModel>;
  order: readonly BattleId[];
  now: number;
  onMove(battleId: BattleId, direction: -1 | 1): void;
  disclosure: WorldDisclosureState;
  onToggleWorld(): void;
  worldPanelRef: RefObject<HTMLElement | null>;
  worldToggleRef: RefObject<HTMLButtonElement | null>;
}>) {
  const state = useWorldState(world.state);
  const [selected, setSelected] = useState<Position | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state.ready || state.snapshot === null) {
    return <StatusNotice kind="progress">Loading the World…</StatusNotice>;
  }
  const snapshot = state.snapshot;
  const selectedCell = selected === null
    ? null
    : snapshot.grid.cells[positionIndex(selected, snapshot.grid.width)] ?? null;
  const run = (command: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    void command().catch((caught: unknown) => setError(errorMessage(caught))).finally(() => setBusy(false));
  };
  return (
    <div className={styles.surface}>
      <WorldDisclosureRegion
        state={disclosure}
        panelId={WORLD_PANEL_ID}
        panelClassName={styles.worldPanel}
        toggleClassName={styles.worldToggle}
        statusClassName={styles.worldStatus}
        panelRef={worldPanelRef}
        toggleRef={worldToggleRef}
        onToggle={onToggleWorld}
      >
        {state.resyncing && <StatusNotice kind="progress">Resynchronizing the World…</StatusNotice>}
        {error !== null && <StatusNotice kind="error">{error}</StatusNotice>}
        <div className={styles.worldLayout}>
          <WorldViewport>
            <WorldGridView
              snapshot={snapshot}
              localPlayerId={localPlayerId}
              now={now}
              interactive
              selectedPosition={selected}
              onCellActivate={setSelected}
            />
            {selected !== null && selectedCell !== null && (
              <WorldCellPopup
                position={selected}
                gridWidth={snapshot.grid.width}
                gridHeight={snapshot.grid.height}
              >
                <WorldDetail
                  cell={selectedCell}
                  localPlayerId={localPlayerId}
                  busy={busy}
                  onChallenge={() => run(() => world.challengeCell(selected))}
                  onJoin={(challengeId) => run(() => world.joinChallenge(challengeId))}
                  onLeave={(challengeId) => run(() => world.leaveChallenge(challengeId))}
                />
              </WorldCellPopup>
            )}
          </WorldViewport>
        </div>
      </WorldDisclosureRegion>
      <div className={styles.battleTrack}>
        <BattleWorkspace
          battles={battles}
          order={order}
          onMove={onMove}
          onLeave={(battleId) => {
            const model = battles.get(battleId);
            if (model !== undefined) void model.battle.dispose().catch(() => undefined);
          }}
        />
      </div>
    </div>
  );
}

/** Owns the World projection and every battle joined through one connection. */
export function NetworkGame() {
  const [connection, setConnection] = useState<ConnectionState>({ kind: "connecting" });
  const [battles, setBattles] = useState<ReadonlyMap<BattleId, BattleTileModel>>(new Map());
  const [battleOrder, setBattleOrder] = useState<readonly BattleId[]>([]);
  const [now, setNow] = useState(Date.now());
  const compactWorld = useCompactWorldMode();
  const [worldDisclosure, dispatchWorldDisclosure] = useReducer(
    reduceWorldDisclosure,
    createWorldDisclosureState(compactWorld ? "compact" : "desktop"),
  );
  const generationRef = useRef(0);
  const clientRef = useRef<NetworkClient | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const battlesRef = useRef(new Map<BattleId, BattleTileModel>());
  const worldPanelRef = useRef<HTMLElement>(null);
  const worldToggleRef = useRef<HTMLButtonElement>(null);
  const focusToggleAfterCollapseRef = useRef(false);
  const handledAutoCollapseRef = useRef(worldDisclosure.autoCollapseVersion);

  const releaseResources = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    const client = clientRef.current;
    clientRef.current = null;
    if (client !== null) void client.close().catch(() => undefined);
    for (const model of battlesRef.current.values()) void model.battle.dispose().catch(() => undefined);
    battlesRef.current = new Map();
    setBattles(new Map());
    setBattleOrder([]);
  }, []);

  const connect = useCallback(() => {
    const generation = ++generationRef.current;
    releaseResources();
    setConnection({ kind: "connecting" });
    void NetworkClient.connect(getNetworkUrl()).then(async (client) => {
      if (generation !== generationRef.current) return await client.close();
      clientRef.current = client;
      const enterBattle = (session: NetworkBattleSession) => {
        if (generation !== generationRef.current) return;
        try {
          const model = createBattleModel(session);
          battlesRef.current.set(session.battleId, model);
          setBattles(new Map(battlesRef.current));
          setBattleOrder((current) => current.includes(session.battleId) ? current : [...current, session.battleId]);
        } catch (error) {
          void session.close().catch(() => undefined);
          setConnection({ kind: "error", message: errorMessage(error) });
        }
      };
      const receive = (event: NetworkClientEvent) => {
        if (generation !== generationRef.current) return;
        if (event.type === "battleJoined") enterBattle(event.session);
        else if (event.type === "battleLeft") {
          const model = battlesRef.current.get(event.battleId);
          battlesRef.current.delete(event.battleId);
          if (model !== undefined) void model.battle.dispose().catch(() => undefined);
          setBattles(new Map(battlesRef.current));
          setBattleOrder((current) => current.filter((battleId) => battleId !== event.battleId));
        } else {
          for (const model of battlesRef.current.values()) {
            void model.battle.dispose().catch(() => undefined);
          }
          battlesRef.current = new Map();
          setBattles(new Map());
          setBattleOrder([]);
          setConnection({ kind: "error", message: event.error?.message ?? "The server connection closed." });
        }
      };
      unsubscribeRef.current = client.subscribe(receive);
      for (const session of client.getSessions()) enterBattle(session);
      await client.world.ready;
      if (generation === generationRef.current) setConnection({ kind: "ready", client });
    }).catch((error: unknown) => {
      if (generation === generationRef.current) setConnection({ kind: "error", message: errorMessage(error) });
    });
  }, [releaseResources]);

  useEffect(() => {
    connect();
    return () => {
      generationRef.current += 1;
      releaseResources();
    };
  }, [connect, releaseResources]);

  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 250);
    return () => globalThis.clearInterval(timer);
  }, []);

  useLayoutEffect(() => {
    const willAutomaticallyCollapse = compactWorld
      && battles.size > worldDisclosure.battleCount;
    const activeElement = document.activeElement;
    focusToggleAfterCollapseRef.current = willAutomaticallyCollapse
      && activeElement !== null
      && (worldPanelRef.current?.contains(activeElement) ?? false);
    dispatchWorldDisclosure({
      type: "sync",
      mode: compactWorld ? "compact" : "desktop",
      battleCount: battles.size,
    });
  }, [battles.size, compactWorld]);

  useLayoutEffect(() => {
    if (handledAutoCollapseRef.current === worldDisclosure.autoCollapseVersion) return;
    handledAutoCollapseRef.current = worldDisclosure.autoCollapseVersion;
    if (focusToggleAfterCollapseRef.current) worldToggleRef.current?.focus();
    focusToggleAfterCollapseRef.current = false;
  }, [worldDisclosure.autoCollapseVersion]);

  const ready = connection.kind === "ready" ? connection.client : null;
  return (
    <GamePage header={false} fullWidth>
      {connection.kind === "connecting" && <StatusNotice kind="progress">Connecting to the game server…</StatusNotice>}
      {connection.kind === "error" && (
        <div>
          <StatusNotice kind="error">{connection.message}</StatusNotice>
          <ActionButton className={styles.reconnectAction} type="button" onClick={connect}>Reconnect</ActionButton>
        </div>
      )}
      {ready !== null && (
        <NetworkViewer
          world={ready.world}
          localPlayerId={ready.playerId}
          battles={battles}
          order={battleOrder}
          now={now}
          disclosure={worldDisclosure}
          onToggleWorld={() => dispatchWorldDisclosure({ type: "toggle" })}
          worldPanelRef={worldPanelRef}
          worldToggleRef={worldToggleRef}
          onMove={(battleId, direction) => setBattleOrder((current) => moveBattle(current, battleId, direction))}
        />
      )}
    </GamePage>
  );
}
