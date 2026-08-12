import type { PlayerId } from "@grid-game/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { ClientBattleState } from "../model/index.ts";
import { NetworkLobby } from "../network/NetworkLobby.tsx";
import { getNetworkUrl } from "../network/networkUrl.ts";
import {
  NetworkClient,
  type NetworkBattleSession,
  type NetworkClientEvent,
} from "../session/index.ts";
import { ActionButton } from "../ui/ActionButton.tsx";
import { GamePage } from "../ui/GamePage.tsx";
import { StatusNotice } from "../ui/StatusNotice.tsx";
import { BattleView, type PlayerColorId } from "../view/index.ts";
import styles from "./NetworkGame.module.css";

type NetworkScreen =
  | { kind: "connecting" }
  | {
    kind: "lobby";
    playerIds: readonly PlayerId[];
    localPlayerId: PlayerId;
    selectedPlayerIds: ReadonlySet<PlayerId>;
    busy: boolean;
    error: string | null;
  }
  | { kind: "waiting" }
  | {
    kind: "battle";
    battle: ClientBattleState;
    playerColorIds: ReadonlyMap<PlayerId, PlayerColorId>;
  }
  | { kind: "error"; message: string };

export type NetworkGameProps = Readonly<{
  onBack(): void;
}>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected network error occurred.";
}

function normalizePlayers(
  playerIds: readonly PlayerId[],
  localPlayerId: PlayerId,
): readonly PlayerId[] {
  return [...new Set([localPlayerId, ...playerIds])];
}

type NetworkScreenViewProps = Readonly<{
  screen: NetworkScreen;
  onRefresh(): void;
  onTogglePlayer(playerId: PlayerId): void;
  onCreate(): void;
  onReconnect(): void;
}>;

function NetworkScreenView({
  screen,
  onRefresh,
  onTogglePlayer,
  onCreate,
  onReconnect,
}: NetworkScreenViewProps) {
  switch (screen.kind) {
    case "connecting":
      return (
        <StatusNotice kind="progress">
          Connecting to the game server…
        </StatusNotice>
      );
    case "lobby":
      return (
        <NetworkLobby
          playerIds={screen.playerIds}
          localPlayerId={screen.localPlayerId}
          selectedPlayerIds={screen.selectedPlayerIds}
          busy={screen.busy}
          error={screen.error}
          onTogglePlayer={onTogglePlayer}
          onRefresh={onRefresh}
          onCreate={onCreate}
        />
      );
    case "waiting":
      return (
        <StatusNotice kind="progress">
          Creating battle and waiting for the server…
        </StatusNotice>
      );
    case "battle":
      return (
        <BattleView
          battle={screen.battle}
          playerColorIds={screen.playerColorIds}
        />
      );
    case "error":
      return (
        <>
          <StatusNotice kind="error">{screen.message}</StatusNotice>
          <ActionButton
            className={styles.reconnectAction}
            type="button"
            onClick={onReconnect}
          >
            Reconnect
          </ActionButton>
        </>
      );
  }
}

/** Owns one server connection and promotes joined sessions into battle state. */
export function NetworkGame({ onBack }: NetworkGameProps) {
  const [screen, setScreen] = useState<NetworkScreen>({ kind: "connecting" });
  const generationRef = useRef(0);
  const clientRef = useRef<NetworkClient | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const battleRef = useRef<ClientBattleState | null>(null);

  const releaseResources = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    const battle = battleRef.current;
    battleRef.current = null;
    const client = clientRef.current;
    clientRef.current = null;
    if (battle !== null) void battle.dispose().catch(() => undefined);
    if (client !== null) void client.close().catch(() => undefined);
  }, []);

  const connect = useCallback(() => {
    const generation = ++generationRef.current;
    releaseResources();
    setScreen({ kind: "connecting" });

    void NetworkClient.connect(getNetworkUrl()).then(async (client) => {
      if (generation !== generationRef.current) {
        await client.close();
        return;
      }
      clientRef.current = client;

      const enterBattle = (session: NetworkBattleSession) => {
        if (generation !== generationRef.current || battleRef.current !== null) return;
        const players = session.initialSnapshot.players;
        if (players.length > 4) {
          void session.close().catch(() => undefined);
          setScreen({ kind: "error", message: "This battle has too many players to display." });
          return;
        }
        try {
          const battle = new ClientBattleState(session, session.playerId);
          const playerColorIds = new Map<PlayerId, PlayerColorId>();
          players.forEach((playerId, index) => {
            playerColorIds.set(playerId, index as PlayerColorId);
          });
          battleRef.current = battle;
          setScreen({ kind: "battle", battle, playerColorIds });
        } catch (error) {
          void session.close().catch(() => undefined);
          setScreen({ kind: "error", message: errorMessage(error) });
        }
      };

      const receive = (event: NetworkClientEvent) => {
        if (generation !== generationRef.current) return;
        if (event.type === "battleJoined") {
          enterBattle(event.session);
        } else if (event.type === "connectionClosed") {
          const battle = battleRef.current;
          battleRef.current = null;
          if (battle !== null) void battle.dispose().catch(() => undefined);
          setScreen({
            kind: "error",
            message: event.error?.message ?? "The server connection closed.",
          });
        }
      };
      unsubscribeRef.current = client.subscribe(receive);

      try {
        const playerIds = normalizePlayers(
          await client.debugGetPlayerIds(),
          client.playerId,
        );
        if (
          generation !== generationRef.current
          || battleRef.current !== null
        ) return;
        setScreen({
          kind: "lobby",
          playerIds,
          localPlayerId: client.playerId,
          selectedPlayerIds: new Set([client.playerId]),
          busy: false,
          error: null,
        });
      } catch (error) {
        if (generation === generationRef.current && battleRef.current === null) {
          setScreen({ kind: "error", message: errorMessage(error) });
        }
      }
    }).catch((error: unknown) => {
      if (generation === generationRef.current) {
        setScreen({ kind: "error", message: errorMessage(error) });
      }
    });
  }, [releaseResources]);

  useEffect(() => {
    connect();
    return () => {
      generationRef.current += 1;
      releaseResources();
    };
  }, [connect, releaseResources]);

  const refreshPlayers = () => {
    const client = clientRef.current;
    if (client === null || screen.kind !== "lobby" || screen.busy) return;
    const generation = generationRef.current;
    setScreen({ ...screen, busy: true, error: null });
    void client.debugGetPlayerIds().then((discovered) => {
      if (generation !== generationRef.current || battleRef.current !== null) return;
      const playerIds = normalizePlayers(discovered, client.playerId);
      setScreen((current) => {
        if (current.kind !== "lobby") return current;
        const available = new Set(playerIds);
        const selected = new Set(
          [...current.selectedPlayerIds].filter((playerId) => available.has(playerId)),
        );
        selected.add(client.playerId);
        return {
          ...current,
          playerIds,
          selectedPlayerIds: selected,
          busy: false,
          error: null,
        };
      });
    }).catch((error: unknown) => {
      if (generation !== generationRef.current || battleRef.current !== null) return;
      setScreen((current) => current.kind === "lobby"
        ? { ...current, busy: false, error: errorMessage(error) }
        : current);
    });
  };

  const togglePlayer = (playerId: PlayerId) => {
    setScreen((current) => {
      if (
        current.kind !== "lobby"
        || current.busy
        || playerId === current.localPlayerId
        || !current.playerIds.includes(playerId)
      ) return current;
      const selected = new Set(current.selectedPlayerIds);
      if (selected.has(playerId)) {
        selected.delete(playerId);
      } else if (selected.size < 4) {
        selected.add(playerId);
      }
      return { ...current, selectedPlayerIds: selected, error: null };
    });
  };

  const createBattle = () => {
    const client = clientRef.current;
    if (client === null || screen.kind !== "lobby" || screen.busy) return;
    const selected = [...screen.selectedPlayerIds];
    if (selected.length < 2 || selected.length > 4) {
      setScreen({ ...screen, error: "Choose between 2 and 4 players." });
      return;
    }
    const generation = generationRef.current;
    setScreen({ kind: "waiting" });
    // battleJoined is canonical for both creators and invited peers. The
    // request result only tells us whether creation was rejected.
    void client.debugCreateBattle(selected).catch((error: unknown) => {
      if (generation !== generationRef.current || battleRef.current !== null) return;
      setScreen({
        kind: "lobby",
        playerIds: screen.playerIds,
        localPlayerId: screen.localPlayerId,
        selectedPlayerIds: screen.selectedPlayerIds,
        busy: false,
        error: errorMessage(error),
      });
    });
  };

  return (
    <GamePage
      eyebrow="Server-backed game"
      title="Grid Battle"
      description="Create a battle with connected players, or wait to be invited."
    >
      <NetworkScreenView
        screen={screen}
        onRefresh={refreshPlayers}
        onTogglePlayer={togglePlayer}
        onCreate={createBattle}
        onReconnect={connect}
      />
      <ActionButton
        className={styles.backAction}
        variant="secondary"
        type="button"
        onClick={onBack}
      >
        Back to game modes
      </ActionButton>
    </GamePage>
  );
}
