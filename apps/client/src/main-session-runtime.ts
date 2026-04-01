import type { RuntimeDiagnosticsConnectionStatus } from "../../../packages/shared/src/index";
import type { StoredAuthSession } from "./auth-session";
import type { SessionUpdate } from "./local-session";

interface MainSessionRuntimeState {
  accountDraftName: string;
  battle?: {
    defenderHeroId?: string | null;
  } | null;
  lastBattleSettlement?: {
    kind?: "pvp" | "pve" | "generic";
  } | null;
  lobby: {
    authSession: StoredAuthSession | null;
  };
  diagnostics: {
    connectionStatus: RuntimeDiagnosticsConnectionStatus;
    recoverySummary: string | null;
  };
  log: string[];
}

interface CreateMainSessionRuntimeOptions {
  state: MainSessionRuntimeState;
  applyUpdate: (update: SessionUpdate, source: "push") => void;
  render: () => void;
}

function summarizeRecoveryEvent(
  event: "reconnecting" | "reconnected" | "reconnect_failed",
  state: MainSessionRuntimeState
): {
  connectionStatus: RuntimeDiagnosticsConnectionStatus;
  recoverySummary: string;
  logLine: string;
} {
  const inPvpEncounter = Boolean(state.battle?.defenderHeroId);
  const recoveringPvpSettlement = state.lastBattleSettlement?.kind === "pvp";
  if (event === "reconnecting") {
    return {
      connectionStatus: "reconnecting",
      recoverySummary: inPvpEncounter
        ? "PVP 遭遇连接暂时中断，正在尝试重新加入当前对抗房间。"
        : "连接暂时中断，正在尝试重新加入房间。",
      logLine: inPvpEncounter ? "PVP 遭遇连接中断，正在尝试重连..." : "连接中断，正在尝试重连..."
    };
  }

  if (event === "reconnected") {
    return {
      connectionStatus: "connected",
      recoverySummary: inPvpEncounter
        ? "PVP 遭遇连接已恢复，正在用最新房间状态校正当前回合与战斗结果。"
        : "连接已恢复，正在用最新房间状态校正地图与战斗结果。",
      logLine: inPvpEncounter ? "PVP 遭遇连接已恢复" : "连接已恢复"
    };
  }

  return {
    connectionStatus: "reconnect_failed",
    recoverySummary:
      inPvpEncounter || recoveringPvpSettlement
        ? "PVP 遭遇旧连接未恢复，正在改用持久化快照补救当前房间状态。"
        : "旧连接未恢复，正在改用持久化快照补救当前房间状态。",
    logLine:
      inPvpEncounter || recoveringPvpSettlement
        ? "PVP 遭遇旧连接恢复失败，正在尝试从持久化快照恢复房间..."
        : "旧连接恢复失败，正在尝试从持久化快照恢复房间..."
  };
}

export function createMainSessionRuntime({ state, applyUpdate, render }: CreateMainSessionRuntimeOptions) {
  return {
    getDisplayName: () => state.accountDraftName,
    getAuthToken: () => state.lobby.authSession?.token ?? null,
    onPushUpdate: (update: SessionUpdate) => {
      state.log.unshift("收到房间同步推送");
      state.log = state.log.slice(0, 12);
      applyUpdate(update, "push");
    },
    onConnectionEvent: (event: "reconnecting" | "reconnected" | "reconnect_failed") => {
      const next = summarizeRecoveryEvent(event, state);
      state.diagnostics.connectionStatus = next.connectionStatus;
      state.diagnostics.recoverySummary = next.recoverySummary;
      state.log.unshift(next.logLine);
      state.log = state.log.slice(0, 12);
      render();
    }
  };
}
