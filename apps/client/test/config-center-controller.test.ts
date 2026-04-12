import assert from "node:assert/strict";
import test from "node:test";
import { createConfigCenterController } from "../src/config-center-controller";

type ConfigDocumentId = "world" | "mapObjects" | "units" | "battleSkills" | "battleBalance";

interface RequestRecord {
  url: string;
  method: string;
  body: string | null;
}

function createDocument(id: ConfigDocumentId, content: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    title: overrides.title ?? `${id} title`,
    description: overrides.description ?? `${id} description`,
    fileName: overrides.fileName ?? `${id}.json`,
    updatedAt: overrides.updatedAt ?? "2026-04-12T04:00:00.000Z",
    summary: overrides.summary ?? `${id} summary`,
    content,
    ...(overrides.version != null ? { version: overrides.version } : {})
  };
}

function createValidationReport(valid = true) {
  return {
    valid,
    summary: valid ? "Schema 校验通过" : "发现字段错误",
    issues: valid
      ? []
      : [
          {
            path: "$.width",
            severity: "error" as const,
            message: "width must be >= 1",
            suggestion: "修正地图宽度后重试。",
            line: 2
          }
        ],
    schema: {
      id: "project-veil.config-center.world",
      title: "World Schema",
      version: "1",
      description: "World config schema",
      required: ["width", "height"]
    },
    contentPack: {
      schemaVersion: 1 as const,
      valid,
      summary: valid ? "Content-pack consistency passed" : "Found content-pack issues",
      issueCount: valid ? 0 : 1,
      checkedDocuments: ["world", "mapObjects", "units", "battleSkills", "battleBalance"] as const,
      issues: []
    }
  };
}

function createWorldPreview() {
  return {
    seed: 1001,
    roomId: "preview-room",
    width: 8,
    height: 8,
    counts: {
      walkable: 50,
      blocked: 14,
      terrain: {
        grass: 30,
        dirt: 12,
        sand: 10,
        water: 12
      },
      resourceTiles: {
        gold: 3,
        wood: 2,
        ore: 1
      },
      resourceAmounts: {
        gold: 600,
        wood: 10,
        ore: 5
      },
      guaranteedResources: 3,
      randomResources: 3,
      heroes: 2,
      neutralArmies: 4,
      buildings: 3
    },
    tiles: [
      {
        position: { x: 0, y: 0 },
        terrain: "grass" as const,
        walkable: true
      }
    ]
  };
}

function createFetchStub(
  handler: (request: RequestRecord) => Response | Promise<Response>
): { fetch: typeof fetch; requests: RequestRecord[] } {
  const requests: RequestRecord[] = [];

  const fetch = (async (input, init) => {
    const request = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : null
    };
    requests.push(request);
    return handler(request);
  }) as typeof globalThis.fetch;

  return {
    fetch,
    requests
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function createManualClock() {
  let nextId = 1;
  const timers = new Map<number, () => void>();

  return {
    setTimeout: ((callback: TimerHandler) => {
      const id = nextId++;
      timers.set(id, callback as () => void);
      return id as unknown as ReturnType<typeof globalThis.setTimeout>;
    }) as typeof globalThis.setTimeout,
    clearTimeout: ((timerId: ReturnType<typeof globalThis.setTimeout>) => {
      timers.delete(Number(timerId));
    }) as typeof globalThis.clearTimeout,
    runNext(): void {
      const next = timers.keys().next();
      if (next.done) {
        return;
      }
      const callback = timers.get(next.value);
      timers.delete(next.value);
      callback?.();
    }
  };
}

test("lockDocument acquires and unlockDocument releases the document lock", () => {
  const controller = createConfigCenterController();
  controller.state.current = createDocument("world", "{\n  \"width\": 8\n}\n");

  assert.equal(controller.lockDocument(), true);
  assert.equal(controller.unlockDocument(), true);
  assert.equal(controller.lockDocument(), true);
});

test("lockDocument rejects a second lock while the document is already held", () => {
  const controller = createConfigCenterController();
  controller.state.current = createDocument("mapObjects", "{\n  \"neutralArmies\": []\n}\n");

  assert.equal(controller.lockDocument(), true);
  assert.equal(controller.lockDocument(), false);
  assert.equal(controller.unlockDocument(), true);
});

test("lockDocument releases automatically after the configured timeout", () => {
  const clock = createManualClock();
  const controller = createConfigCenterController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });
  controller.state.current = createDocument("units", "{\n  \"items\": []\n}\n");

  assert.equal(controller.lockDocument("units", 25), true);
  assert.equal(controller.lockDocument("units", 25), false);

  clock.runNext();

  assert.equal(controller.lockDocument("units", 25), true);
});

test("computeDiff returns null when no document or snapshot is selected", async () => {
  const { fetch, requests } = createFetchStub(() => {
    throw new Error("computeDiff should not fetch without an active document");
  });
  const controller = createConfigCenterController({ fetch });

  const diff = await controller.computeDiff();

  assert.equal(diff, null);
  assert.equal(requests.length, 0);
});

test("computeDiff returns an empty diff for identical documents", async () => {
  const { fetch, requests } = createFetchStub((request) => {
    if (request.url === "/api/config-center/configs/world/diff" && request.method === "POST") {
      return jsonResponse({
        storage: "filesystem",
        diff: {
          entries: []
        }
      });
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });
  const controller = createConfigCenterController({ fetch });
  controller.state.current = createDocument("world", "{\n  \"width\": 8\n}\n");
  controller.state.selectedSnapshotId = "snapshot-world-1";

  const diff = await controller.computeDiff();

  assert.deepEqual(diff, { entries: [] });
  assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
    snapshotId: "snapshot-world-1"
  });
});

test("computeDiff preserves field and array reorder patch entries from the diff API", async () => {
  const { fetch } = createFetchStub((request) => {
    if (request.url === "/api/config-center/configs/mapObjects/diff" && request.method === "POST") {
      return jsonResponse({
        storage: "filesystem",
        diff: {
          entries: [
            {
              path: "resourceNodes[0].amount",
              change: "updated",
              previousValue: "100",
              nextValue: "150",
              kind: "value",
              required: true,
              fieldType: "integer",
              description: "Resource amount",
              blastRadius: ["world-preview"]
            },
            {
              path: "neutralArmies",
              change: "updated",
              previousValue: "[\"a\",\"b\"]",
              nextValue: "[\"b\",\"a\"]",
              kind: "value",
              required: true,
              fieldType: "array",
              description: "Neutral army ordering",
              blastRadius: ["world-preview", "spawn-order"]
            }
          ]
        }
      });
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });
  const controller = createConfigCenterController({ fetch });
  controller.state.current = createDocument("mapObjects", "{\n  \"neutralArmies\": [\"a\", \"b\"]\n}\n");
  controller.state.selectedSnapshotId = "snapshot-map-2";

  const diff = await controller.computeDiff();

  assert.equal(diff?.entries.length, 2);
  assert.equal(diff?.entries[0]?.path, "resourceNodes[0].amount");
  assert.equal(diff?.entries[1]?.nextValue, "[\"b\",\"a\"]");
});

test("commitSnapshot writes the current draft and returns the new snapshot version", async () => {
  const { fetch, requests } = createFetchStub((request) => {
    if (request.url === "/api/config-center/configs/world/snapshots" && request.method === "POST") {
      return jsonResponse({
        storage: "filesystem",
        snapshot: {
          id: "snapshot-world-3",
          label: "World v3",
          createdAt: "2026-04-12T04:10:00.000Z",
          version: 3
        }
      });
    }

    if (request.url === "/api/config-center/configs/world/snapshots" && request.method === "GET") {
      return jsonResponse({
        storage: "filesystem",
        snapshots: [
          {
            id: "snapshot-world-3",
            label: "World v3",
            createdAt: "2026-04-12T04:10:00.000Z",
            version: 3
          }
        ]
      });
    }

    if (request.url === "/api/config-center/configs/world/diff" && request.method === "POST") {
      return jsonResponse({
        storage: "filesystem",
        diff: {
          entries: []
        }
      });
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });
  const controller = createConfigCenterController({ fetch });
  controller.state.current = createDocument("world", "{\n  \"width\": 8\n}\n", { version: 2 });
  controller.setDraft("{\n  \"width\": 10\n}\n");
  controller.state.previewApplied = true;

  const snapshot = await controller.commitSnapshot("World v3");

  assert.equal(snapshot?.version, 3);
  assert.equal(controller.state.previewApplied, false);
  assert.equal(controller.state.snapshots[0]?.id, "snapshot-world-3");
  assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
    content: "{\n  \"width\": 10\n}\n",
    label: "World v3"
  });
});

test("commitSnapshot returns null when no current document is loaded", async () => {
  const controller = createConfigCenterController();

  const snapshot = await controller.commitSnapshot("unused");

  assert.equal(snapshot, null);
});

test("rollbackSnapshot restores the previous snapshot content", async () => {
  const { fetch } = createFetchStub((request) => {
    if (request.url === "/api/config-center/configs/world/diff" && request.method === "POST") {
      return jsonResponse({
        storage: "filesystem",
        diff: {
          entries: [
            {
              path: "width",
              change: "updated",
              previousValue: "10",
              nextValue: "8",
              kind: "value",
              required: true,
              fieldType: "integer",
              description: "地图宽度",
              blastRadius: ["world-preview"]
            }
          ]
        }
      });
    }

    if (request.url === "/api/config-center/configs/world/rollback" && request.method === "POST") {
      return jsonResponse({
        storage: "filesystem",
        document: createDocument("world", "{\n  \"width\": 8\n}\n", { version: 2 })
      });
    }

    if (request.url === "/api/config-center/configs" && request.method === "GET") {
      return jsonResponse({
        storage: "filesystem",
        items: [createDocument("world", "{\n  \"width\": 8\n}\n", { version: 2 })]
      });
    }

    if (request.url === "/api/config-center/configs/world/snapshots" && request.method === "GET") {
      return jsonResponse({
        storage: "filesystem",
        snapshots: [
          {
            id: "snapshot-world-2",
            label: "World v2",
            createdAt: "2026-04-12T04:20:00.000Z",
            version: 2
          }
        ]
      });
    }

    if (request.url === "/api/config-center/configs/world/presets" && request.method === "GET") {
      return jsonResponse({
        storage: "filesystem",
        presets: []
      });
    }

    if (request.url === "/api/config-center/configs/world/validate" && request.method === "POST") {
      return jsonResponse({
        storage: "filesystem",
        validation: createValidationReport(true)
      });
    }

    if (request.url === "/api/config-center/configs/world/preview" && request.method === "POST") {
      return jsonResponse({
        storage: "filesystem",
        preview: createWorldPreview()
      });
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });
  const controller = createConfigCenterController({ fetch, confirm: () => true });
  controller.state.current = createDocument("world", "{\n  \"width\": 10\n}\n", { version: 3 });
  controller.setDraft("{\n  \"width\": 10\n}\n");

  await controller.rollbackSnapshot("snapshot-world-2");

  assert.equal(controller.state.current?.content, "{\n  \"width\": 8\n}\n");
  assert.equal(controller.state.draft, "{\n  \"width\": 8\n}\n");
});

test("applyHotloadPreview sets previewApplied and keeps production content unchanged", async () => {
  const { fetch } = createFetchStub((request) => {
    if (request.url === "/api/config-center/configs/world/preview" && request.method === "POST") {
      return jsonResponse({
        storage: "filesystem",
        preview: createWorldPreview()
      });
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });
  const controller = createConfigCenterController({ fetch });
  controller.state.current = createDocument("world", "{\n  \"width\": 8\n}\n");
  controller.setDraft("{\n  \"width\": 10\n}\n");

  const preview = await controller.applyHotloadPreview();

  assert.equal(controller.state.previewApplied, true);
  assert.equal(preview?.roomId, "preview-room");
  assert.equal(controller.state.current?.content, "{\n  \"width\": 8\n}\n");
  assert.equal(controller.state.draft, "{\n  \"width\": 10\n}\n");
});

test("applyHotloadPreview rejects invalid JSON without mutating preview state", async () => {
  const controller = createConfigCenterController();
  controller.state.current = createDocument("world", "{\n  \"width\": 8\n}\n");
  controller.setDraft("{\n  \"width\": \n}\n");

  const preview = await controller.applyHotloadPreview();

  assert.equal(preview, null);
  assert.equal(controller.state.previewApplied, false);
  assert.match(controller.state.previewError, /JSON/);
});

test("applyHotloadPreview clears preview mode when a snapshot commit succeeds", async () => {
  const { fetch } = createFetchStub((request) => {
    if (request.url === "/api/config-center/configs/world/preview" && request.method === "POST") {
      return jsonResponse({
        storage: "filesystem",
        preview: createWorldPreview()
      });
    }

    if (request.url === "/api/config-center/configs/world/snapshots" && request.method === "POST") {
      return jsonResponse({
        storage: "filesystem",
        snapshot: {
          id: "snapshot-world-4",
          label: "World v4",
          createdAt: "2026-04-12T04:30:00.000Z",
          version: 4
        }
      });
    }

    if (request.url === "/api/config-center/configs/world/snapshots" && request.method === "GET") {
      return jsonResponse({
        storage: "filesystem",
        snapshots: [
          {
            id: "snapshot-world-4",
            label: "World v4",
            createdAt: "2026-04-12T04:30:00.000Z",
            version: 4
          }
        ]
      });
    }

    if (request.url === "/api/config-center/configs/world/diff" && request.method === "POST") {
      return jsonResponse({
        storage: "filesystem",
        diff: {
          entries: []
        }
      });
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });
  const controller = createConfigCenterController({ fetch });
  controller.state.current = createDocument("world", "{\n  \"width\": 8\n}\n", { version: 3 });
  controller.setDraft("{\n  \"width\": 10\n}\n");

  await controller.applyHotloadPreview();
  assert.equal(controller.state.previewApplied, true);

  await controller.commitSnapshot("World v4");

  assert.equal(controller.state.previewApplied, false);
});

test("validateAndSave rejects a document that fails validation", async () => {
  const { fetch, requests } = createFetchStub((request) => {
    if (request.url === "/api/config-center/configs/mapObjects/validate" && request.method === "POST") {
      return jsonResponse({
        storage: "filesystem",
        validation: createValidationReport(false)
      });
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });
  const controller = createConfigCenterController({ fetch });
  controller.state.current = createDocument("mapObjects", "{\n  \"neutralArmies\": [1]\n}\n", { version: 2 });
  controller.setDraft("{\n  \"neutralArmies\": [1, 2]\n}\n");

  const result = await controller.validateAndSave();

  assert.equal(result.saved, false);
  assert.equal(result.validation?.valid, false);
  assert.equal(requests.some((request) => request.method === "PUT"), false);
  assert.equal(controller.state.statusMessage, "当前配置存在校验问题，已阻止保存");
});

test("validateAndSave persists the document when validation passes", async () => {
  const savedDocument = createDocument("mapObjects", "{\n  \"neutralArmies\": []\n}\n", { version: 3 });
  const { fetch, requests } = createFetchStub((request) => {
    if (request.url === "/api/config-center/configs/mapObjects/validate" && request.method === "POST") {
      return jsonResponse({
        storage: "filesystem",
        validation: createValidationReport(true)
      });
    }

    if (request.url === "/api/config-center/configs/mapObjects" && request.method === "PUT") {
      return jsonResponse({
        storage: "filesystem",
        document: savedDocument,
        impactSummary: null
      });
    }

    if (request.url === "/api/config-center/configs" && request.method === "GET") {
      return jsonResponse({
        storage: "filesystem",
        items: [savedDocument]
      });
    }

    if (request.url === "/api/config-center/configs/mapObjects/snapshots" && request.method === "GET") {
      return jsonResponse({
        storage: "filesystem",
        snapshots: []
      });
    }

    if (request.url === "/api/config-center/configs/mapObjects/presets" && request.method === "GET") {
      return jsonResponse({
        storage: "filesystem",
        presets: []
      });
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });
  const controller = createConfigCenterController({ fetch });
  controller.state.current = createDocument("mapObjects", "{\n  \"neutralArmies\": [1]\n}\n", { version: 2 });
  controller.setDraft("{\n  \"neutralArmies\": []\n}\n");

  const result = await controller.validateAndSave();

  assert.equal(result.saved, true);
  assert.equal(controller.state.current?.version, 3);
  const saveRequest = requests.find((request) => request.url === "/api/config-center/configs/mapObjects" && request.method === "PUT");
  assert.ok(saveRequest);
  assert.deepEqual(JSON.parse(saveRequest.body ?? "{}"), {
    content: "{\n  \"neutralArmies\": []\n}\n"
  });
});

test("validateAndSave surfaces validation errors in the expected format when the API rejects malformed JSON", async () => {
  const { fetch } = createFetchStub((request) => {
    if (request.url === "/api/config-center/configs/world/validate" && request.method === "POST") {
      return jsonResponse(
        {
          error: {
            message: "invalid json payload"
          }
        },
        400
      );
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });
  const controller = createConfigCenterController({ fetch });
  controller.state.current = createDocument("world", "{\n  \"width\": 8\n}\n");
  controller.setDraft("{\n  \"width\": \n}\n");

  const result = await controller.validateAndSave();

  assert.equal(result.saved, false);
  assert.equal(result.validation?.valid, false);
  assert.equal(result.validation?.summary, "invalid json payload");
  assert.equal(result.validation?.issues[0]?.path, "$");
  assert.equal(result.validation?.issues[0]?.suggestion, "检查 JSON 语法和字段格式后重试。");
});
