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
    updatedAt: overrides.updatedAt ?? "2026-03-29T06:00:00.000Z",
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
      issues: valid
        ? []
        : [
            {
              documentId: "world" as const,
              path: "heroes[0].armyTemplateId",
              severity: "error" as const,
              message: "missing unit template",
              suggestion: "修正跨文件引用后重试。"
            }
          ]
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

test("config center validation surfaces legal JSON success and blocks invalid JSON with a repair hint", async () => {
  const { fetch, requests } = createFetchStub((request) => {
    if (request.url.endsWith("/validate")) {
      return new Response(
        JSON.stringify({
          storage: "filesystem",
          validation: createValidationReport(true)
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const controller = createConfigCenterController({ fetch, confirm: () => true });
  controller.state.current = createDocument("world", "{\n  \"width\": 8\n}\n");
  controller.setDraft("{\n  \"width\": 8\n}\n");

  assert.deepEqual(controller.getDraftParseState(), {
    valid: true,
    detail: "JSON 语法有效",
    rootKeys: 1
  });

  await controller.loadValidation();

  assert.equal(controller.state.validation?.valid, true);
  assert.equal(requests[0]?.url, "/api/config-center/configs/world/validate");
  assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
    content: "{\n  \"width\": 8\n}\n"
  });

  controller.setDraft("{\n  \"width\": \n}\n");
  assert.equal(controller.getDraftParseState().valid, false);
  assert.match(controller.getDraftParseState().detail, /JSON|Unexpected/);

  const failingFetch = createFetchStub(() =>
    new Response(JSON.stringify({ error: { message: "invalid json payload" } }), {
      status: 400,
      headers: {
        "Content-Type": "application/json"
      }
    })
  );
  const failingController = createConfigCenterController({ fetch: failingFetch.fetch });
  failingController.state.current = createDocument("world", "{\n  \"width\": \n}\n");
  failingController.setDraft("{\n  \"width\": \n}\n");

  await failingController.loadValidation();

  assert.equal(failingController.state.validation?.valid, false);
  assert.equal(failingController.state.validation?.issues[0]?.suggestion, "检查 JSON 语法和字段格式后重试。");
  assert.equal(failingController.state.validation?.summary, "invalid json payload");
});

test("config center save flow calls the config API with the edited draft body", async () => {
  const savedDocument = createDocument("mapObjects", "{\n  \"neutralArmies\": []\n}\n", { version: 3 });
  const { fetch, requests } = createFetchStub((request) => {
    if (request.url === "/api/config-center/configs/mapObjects" && request.method === "PUT") {
      return new Response(
        JSON.stringify({
          storage: "filesystem",
          document: savedDocument
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (request.url === "/api/config-center/configs") {
      return new Response(JSON.stringify({ storage: "filesystem", items: [savedDocument] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (request.url === "/api/config-center/configs/mapObjects/snapshots") {
      return new Response(JSON.stringify({ storage: "filesystem", snapshots: [] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (request.url === "/api/config-center/configs/mapObjects/presets") {
      return new Response(JSON.stringify({ storage: "filesystem", presets: [] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const controller = createConfigCenterController({ fetch });
  controller.state.current = createDocument("mapObjects", "{\n  \"neutralArmies\": [1]\n}\n", { version: 2 });
  controller.state.validation = createValidationReport(true);
  controller.setDraft("{\n  \"neutralArmies\": []\n}\n");

  await controller.saveCurrentDocument();

  const saveRequest = requests.find((request) => request.url === "/api/config-center/configs/mapObjects" && request.method === "PUT");
  assert.ok(saveRequest);
  assert.deepEqual(JSON.parse(saveRequest.body ?? "{}"), {
    content: "{\n  \"neutralArmies\": []\n}\n"
  });
  assert.equal(controller.state.current?.content, "{\n  \"neutralArmies\": []\n}\n");
  assert.equal(controller.state.statusTone, "success");
});

test("config center snapshot diff exposes non-empty changes for an edited field", async () => {
  const { fetch } = createFetchStub((request) => {
  if (request.url === "/api/config-center/configs/world/diff" && request.method === "POST") {
      return new Response(
        JSON.stringify({
          storage: "filesystem",
          diff: {
            entries: [
              {
                path: "width",
                change: "updated",
                previousValue: "8",
                nextValue: "10",
                kind: "value",
                required: true,
                fieldType: "integer",
                description: "地图宽度，单位为格子。 | integer · >= 1",
                blastRadius: ["配置台编辑器"]
              }
            ]
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const controller = createConfigCenterController({ fetch });
  controller.state.current = createDocument("world", "{\n  \"width\": 10\n}\n");
  controller.state.selectedSnapshotId = "snapshot-1";

  await controller.loadSnapshotDiff();

  assert.equal(controller.state.snapshotDiff?.entries.length, 1);
  const diffEntry = controller.state.snapshotDiff?.entries[0];
  assert.equal(diffEntry?.path, "width");
  assert.equal(diffEntry?.kind, "value");
  assert.equal(diffEntry?.fieldType.includes("integer"), true);
});

test("config center rollback restores the previous snapshot content", async () => {
  const rolledBackDocument = createDocument("world", "{\n  \"width\": 8,\n  \"height\": 8\n}\n", { version: 2 });
  const { fetch } = createFetchStub((request) => {
    if (request.url === "/api/config-center/configs/world/diff" && request.method === "POST") {
      return new Response(
        JSON.stringify({
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
                description: "地图宽度。",
                blastRadius: ["配置台编辑器"]
              }
            ]
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (request.url === "/api/config-center/configs/world/rollback" && request.method === "POST") {
      return new Response(
        JSON.stringify({
          storage: "filesystem",
          document: rolledBackDocument
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (request.url === "/api/config-center/configs") {
      return new Response(JSON.stringify({ storage: "filesystem", items: [rolledBackDocument] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (request.url === "/api/config-center/configs/world/snapshots") {
      return new Response(JSON.stringify({ storage: "filesystem", snapshots: [] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (request.url === "/api/config-center/configs/world/presets") {
      return new Response(JSON.stringify({ storage: "filesystem", presets: [] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (request.url === "/api/config-center/configs/world/validate") {
      return new Response(JSON.stringify({ storage: "filesystem", validation: createValidationReport(true) }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (request.url === "/api/config-center/configs/world/preview" && request.method === "POST") {
      return new Response(JSON.stringify({ storage: "filesystem", preview: createWorldPreview() }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const controller = createConfigCenterController({ fetch });
  controller.state.current = createDocument("world", "{\n  \"width\": 10,\n  \"height\": 8\n}\n", { version: 3 });
  controller.setDraft("{\n  \"width\": 10,\n  \"height\": 8\n}\n");

  await controller.rollbackSnapshot("snapshot-1");

  assert.equal(controller.state.current?.content, "{\n  \"width\": 8,\n  \"height\": 8\n}\n");
  assert.equal(controller.state.draft, "{\n  \"width\": 8,\n  \"height\": 8\n}\n");
  assert.equal(controller.state.statusTone, "success");
});

test("config center rollback requires confirmation before applying structural diffs", async () => {
  const confirmMessages: string[] = [];
  const { fetch, requests } = createFetchStub((request) => {
    if (request.url === "/api/config-center/configs/world/diff" && request.method === "POST") {
      return new Response(
        JSON.stringify({
          storage: "filesystem",
          diff: {
            entries: [
              {
                path: "heroes[0].position.x",
                change: "removed",
                previousValue: "1",
                nextValue: "",
                kind: "field_removed",
                required: true,
                fieldType: "integer",
                description: "英雄初始 X 坐标。 | integer · >= 0",
                blastRadius: ["配置台编辑器", "世界预览"]
              }
            ]
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const controller = createConfigCenterController({
    fetch,
    confirm: (message) => {
      confirmMessages.push(message);
      return false;
    }
  });
  controller.state.current = createDocument("world", "{\n  \"width\": 10,\n  \"height\": 8\n}\n");

  await controller.rollbackSnapshot("snapshot-structural");

  assert.equal(confirmMessages.length, 1);
  assert.match(confirmMessages[0] ?? "", /结构风险|警告/);
  assert.equal(requests.some((request) => request.url.includes("/rollback")), false);
  assert.equal(controller.state.statusTone, "neutral");
  assert.match(controller.state.statusMessage, /取消/);
});

test("config center builtin presets apply the expected field changes", async () => {
  const baseDocument = createDocument(
    "battleBalance",
    JSON.stringify(
      {
        damage: {
          defendingDefenseBonus: 5,
          offenseAdvantageStep: 0.05,
          minimumOffenseMultiplier: 0.3,
          varianceBase: 0.9,
          varianceRange: 0.2
        },
        environment: {
          blockerSpawnThreshold: 0.62,
          blockerDurability: 1,
          trapSpawnThreshold: 0.58,
          trapDamage: 1,
          trapCharges: 1
        },
        pvp: {
          eloK: 32
        }
      },
      null,
      2
    ) + "\n"
  );

  const presets = new Map([
    [
      "easy",
      createDocument(
        "battleBalance",
        JSON.stringify(
          {
            damage: {
              defendingDefenseBonus: 4,
              offenseAdvantageStep: 0.05,
              minimumOffenseMultiplier: 0.3,
              varianceBase: 0.9,
              varianceRange: 0.2
            },
            environment: {
              blockerSpawnThreshold: 0.7,
              blockerDurability: 1,
              trapSpawnThreshold: 0.65,
              trapDamage: 1,
              trapCharges: 1
            },
            pvp: {
              eloK: 24
            }
          },
          null,
          2
        ) + "\n"
      )
    ],
    [
      "normal",
      createDocument(
        "battleBalance",
        JSON.stringify(
          {
            damage: {
              defendingDefenseBonus: 5,
              offenseAdvantageStep: 0.05,
              minimumOffenseMultiplier: 0.3,
              varianceBase: 0.9,
              varianceRange: 0.2
            },
            environment: {
              blockerSpawnThreshold: 0.62,
              blockerDurability: 1,
              trapSpawnThreshold: 0.58,
              trapDamage: 1,
              trapCharges: 1
            },
            pvp: {
              eloK: 32
            }
          },
          null,
          2
        ) + "\n"
      )
    ],
    [
      "hard",
      createDocument(
        "battleBalance",
        JSON.stringify(
          {
            damage: {
              defendingDefenseBonus: 6,
              offenseAdvantageStep: 0.05,
              minimumOffenseMultiplier: 0.3,
              varianceBase: 0.9,
              varianceRange: 0.2
            },
            environment: {
              blockerSpawnThreshold: 0.55,
              blockerDurability: 1,
              trapSpawnThreshold: 0.5,
              trapDamage: 2,
              trapCharges: 2
            },
            pvp: {
              eloK: 40
            }
          },
          null,
          2
        ) + "\n"
      )
    ]
  ]);

  const { fetch } = createFetchStub((request) => {
    const presetId = request.url.match(/\/presets\/([^/]+)\/apply$/)?.[1];
    if (presetId && request.method === "POST") {
      return new Response(
        JSON.stringify({
          storage: "filesystem",
          document: presets.get(presetId)
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (request.url === "/api/config-center/configs") {
      return new Response(JSON.stringify({ storage: "filesystem", items: [baseDocument] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (request.url === "/api/config-center/configs/battleBalance/snapshots") {
      return new Response(JSON.stringify({ storage: "filesystem", snapshots: [] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (request.url === "/api/config-center/configs/battleBalance/presets") {
      return new Response(JSON.stringify({ storage: "filesystem", presets: [] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (request.url === "/api/config-center/configs/battleBalance/validate") {
      return new Response(JSON.stringify({ storage: "filesystem", validation: createValidationReport(true) }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const controller = createConfigCenterController({ fetch });
  controller.state.current = baseDocument;

  await controller.applyPreset("easy");
  assert.equal(JSON.parse(controller.state.current?.content ?? "{}").pvp.eloK, 24);

  await controller.applyPreset("normal");
  assert.equal(JSON.parse(controller.state.current?.content ?? "{}").pvp.eloK, 32);

  await controller.applyPreset("hard");
  const hardConfig = JSON.parse(controller.state.current?.content ?? "{}");
  assert.equal(hardConfig.pvp.eloK, 40);
  assert.equal(hardConfig.environment.trapDamage, 2);
});

test("config center world preview posts the current phase1-world draft and stores the generated sample", async () => {
  const { fetch, requests } = createFetchStub((request) => {
    if (request.url === "/api/config-center/configs/world/preview" && request.method === "POST") {
      return new Response(JSON.stringify({ storage: "filesystem", preview: createWorldPreview() }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const draft = "{\n  \"width\": 8,\n  \"height\": 8,\n  \"heroes\": []\n}\n";
  const controller = createConfigCenterController({ fetch });
  controller.state.current = createDocument("world", draft, { fileName: "phase1-world.json" });
  controller.setDraft(draft);

  await controller.loadWorldPreview();

  const previewRequest = requests[0];
  assert.equal(previewRequest?.url, "/api/config-center/configs/world/preview");
  assert.deepEqual(JSON.parse(previewRequest?.body ?? "{}"), {
    content: draft,
    seed: 1001
  });
  assert.equal(controller.state.worldPreview?.width, 8);
  assert.equal(controller.state.worldPreview?.counts.heroes, 2);
});

test("config center export flow preserves the server MIME type for Excel and CSV downloads", async () => {
  const downloads: Array<{ fileName: string | null; fallbackFileName: string; type: string }> = [];
  const { fetch } = createFetchStub((request) => {
    if (request.url.endsWith("format=xlsx")) {
      return new Response(new Blob(["xlsx"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), {
        status: 200,
        headers: {
          "Content-Disposition": "attachment; filename*=UTF-8''phase1-world.xlsx",
          "X-Config-Exported-At": "2026-03-29T06:30:00.000Z"
        }
      });
    }

    if (request.url.endsWith("format=csv")) {
      return new Response(new Blob(["csv"], { type: "text/csv" }), {
        status: 200,
        headers: {
          "Content-Disposition": "attachment; filename=\"phase1-world-fields.csv\"",
          "X-Config-Exported-At": "2026-03-29T06:31:00.000Z"
        }
      });
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });

  const controller = createConfigCenterController({
    fetch,
    download: ({ blob, fileName, fallbackFileName }) => {
      downloads.push({
        fileName,
        fallbackFileName,
        type: blob.type
      });
    }
  });
  controller.state.current = createDocument("world", "{\n  \"width\": 8\n}\n", { exportedAt: null });
  controller.state.items = [createDocument("world", "{\n  \"width\": 8\n}\n", { exportedAt: null })];

  await controller.exportCurrentDocument("xlsx");
  await controller.exportCurrentDocument("csv");

  assert.deepEqual(downloads, [
    {
      fileName: "phase1-world.xlsx",
      fallbackFileName: "world.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    },
    {
      fileName: "phase1-world-fields.csv",
      fallbackFileName: "world.csv",
      type: "text/csv"
    }
  ]);
  assert.equal(controller.state.current?.exportedAt, "2026-03-29T06:31:00.000Z");
});
