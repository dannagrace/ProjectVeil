import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  listReachableTiles,
  planHeroMovement,
  type ClientMessage,
  type MovementPlan,
  type ServerMessage,
  type SessionStatePayload,
  type WorldEvent
} from "../../../packages/shared/src/index";
import { createRoom, type AuthoritativeWorldRoom } from "./index";

interface ConnectionContext {
  room: AuthoritativeWorldRoom;
  roomId: string;
  playerId: string;
}

const rooms = new Map<string, AuthoritativeWorldRoom>();
const roomConnections = new Map<string, Set<WebSocket>>();

function getRoom(roomId: string, seed?: number): AuthoritativeWorldRoom {
  const existing = rooms.get(roomId);
  if (existing) {
    return existing;
  }

  const room = createRoom(roomId, seed);
  rooms.set(roomId, room);
  return room;
}

function buildStatePayload(
  room: AuthoritativeWorldRoom,
  playerId: string,
  extras?: {
    events?: WorldEvent[];
    movementPlan?: MovementPlan | null;
    reason?: string;
  }
): SessionStatePayload {
  const world = room.getSnapshot(playerId).state;
  const heroId = world.ownHeroes[0]?.id;
  return {
    world,
    battle: room.getActiveBattle(),
    events: extras?.events ?? [],
    movementPlan: extras?.movementPlan ?? null,
    reachableTiles: heroId && !room.getActiveBattle() ? listReachableTiles(room.getInternalState(), heroId) : [],
    ...(extras?.reason ? { reason: extras.reason } : {})
  };
}

function send(ws: WebSocket, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

function addConnection(roomId: string, ws: WebSocket): void {
  const connections = roomConnections.get(roomId) ?? new Set<WebSocket>();
  connections.add(ws);
  roomConnections.set(roomId, connections);
}

function removeConnection(roomId: string, ws: WebSocket): void {
  const connections = roomConnections.get(roomId);
  if (!connections) {
    return;
  }

  connections.delete(ws);
  if (connections.size === 0) {
    roomConnections.delete(roomId);
  }
}

function broadcastState(
  roomId: string,
  source: WebSocket | null,
  room: AuthoritativeWorldRoom,
  extras?: {
    events?: WorldEvent[];
    movementPlan?: MovementPlan | null;
    reason?: string;
  }
): void {
  const connections = roomConnections.get(roomId);
  if (!connections) {
    return;
  }

  for (const ws of connections) {
    if (ws === source) {
      continue;
    }

    const playerId = (ws as WebSocket & { __playerId?: string }).__playerId;
    if (!playerId) {
      continue;
    }

    send(ws, {
      type: "session.state",
      requestId: "push",
      delivery: "push",
      payload: buildStatePayload(room, playerId, extras)
    });
  }
}

function startDevServer(port = Number(process.env.PORT ?? 2567), host = process.env.HOST ?? "127.0.0.1"): void {
  const server = createServer();
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    let context: ConnectionContext | null = null;

    ws.on("message", (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        send(ws, { type: "error", requestId: "unknown", reason: "invalid_json" });
        return;
      }

      if (message.type === "connect") {
        const room = getRoom(message.roomId, message.seed);
        context = {
          room,
          roomId: message.roomId,
          playerId: message.playerId
        };
        (ws as WebSocket & { __playerId?: string }).__playerId = message.playerId;
        addConnection(message.roomId, ws);
        send(ws, {
          type: "session.state",
          requestId: message.requestId,
          delivery: "reply",
          payload: buildStatePayload(room, message.playerId)
        });
        return;
      }

      if (!context) {
        send(ws, { type: "error", requestId: message.requestId, reason: "not_connected" });
        return;
      }

      if (message.type === "world.preview") {
        send(ws, {
          type: "world.preview",
          requestId: message.requestId,
          movementPlan: planHeroMovement(context.room.getInternalState(), message.heroId, message.destination) ?? null
        });
        return;
      }

      if (message.type === "world.reachable") {
        send(ws, {
          type: "world.reachable",
          requestId: message.requestId,
          reachableTiles: listReachableTiles(context.room.getInternalState(), message.heroId)
        });
        return;
      }

      if (message.type === "world.action") {
        const result = context.room.dispatch(context.playerId, message.action);
        const heroId = result.snapshot.state.ownHeroes[0]?.id;
        send(ws, {
          type: "session.state",
          requestId: message.requestId,
          delivery: "reply",
          payload: buildStatePayload(context.room, context.playerId, {
            events: result.events ?? [],
            movementPlan: result.movementPlan ?? null,
            ...(result.reason ? { reason: result.reason } : {})
          })
        });
        broadcastState(context.roomId, ws, context.room, {
          events: result.events ?? [],
          movementPlan: result.movementPlan ?? null
        });
        return;
      }

      const result = context.room.dispatchBattle(context.playerId, message.action);
      send(ws, {
        type: "session.state",
        requestId: message.requestId,
        delivery: "reply",
        payload: buildStatePayload(context.room, context.playerId, {
          events: result.events ?? [],
          movementPlan: null,
          ...(result.reason ? { reason: result.reason } : {})
        })
      });
      broadcastState(context.roomId, ws, context.room, {
        events: result.events ?? [],
        movementPlan: null
      });
    });

    ws.on("close", () => {
      if (context) {
        removeConnection(context.roomId, ws);
      }
    });
  });

  server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`Project Veil dev server listening on ws://${host}:${port}`);
  });
}

startDevServer();
