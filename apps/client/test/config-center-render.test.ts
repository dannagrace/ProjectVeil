import assert from "node:assert/strict";
import test from "node:test";
import {
  isConfigCenterSaveDisabled,
  renderConfigCenterImpactSummarySection,
  renderConfigCenterPublishHistoryList,
  renderConfigCenterSnapshotDiffPanel,
  renderConfigCenterValidationSection
} from "../src/config-center";

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

test("config center render blocks invalid saves and surfaces repair hints", () => {
  const validation = createValidationReport(false);
  const html = renderConfigCenterValidationSection({
    currentDocumentId: "world",
    validation,
    validationLoading: false
  });

  assert.equal(
    isConfigCenterSaveDisabled({
      currentDocumentId: "world",
      loading: false,
      saving: false,
      validationLoading: false,
      validation
    }),
    true
  );
  assert.match(html, /保存前需修复/);
  assert.match(html, /修正地图宽度后重试/);
  assert.match(html, /修正跨文件引用后重试/);
});

test("config center render refreshes the last saved impact summary content", () => {
  const html = renderConfigCenterImpactSummarySection({
    currentDocumentId: "mapObjects",
    lastSavedImpactSummary: {
      documentId: "mapObjects",
      title: "地图物件",
      summary: "1 项字段变更，主要关注 neutralArmies。",
      riskLevel: "medium",
      changedFields: ["neutralArmies"],
      impactedModules: ["地图 POI", "招募库存"],
      riskHints: ["地图对象已调整，守军、建筑或资源点分布可能改变探索与招募节奏。"],
      suggestedValidationActions: ["config-center 地图预览"]
    }
  });

  assert.match(html, /变更影响摘要/);
  assert.match(html, /neutralArmies/);
  assert.match(html, /招募库存/);
  assert.match(html, /config-center 地图预览/);
});

test("config center render shows publish history changes with impact summary and rollback action", () => {
  const html = renderConfigCenterPublishHistoryList({
    publishAuditHistory: [
      {
        id: "publish-1",
        author: "ConfigOps",
        summary: "扩图并补资源",
        publishedAt: "2026-03-30T05:00:00.000Z",
        resultStatus: "applied",
        resultMessage: "运行时配置已刷新",
        changes: [
          {
            documentId: "world",
            title: "世界配置",
            fromVersion: 2,
            toVersion: 3,
            changeCount: 2,
            structuralChangeCount: 0,
            snapshotId: "snapshot-world-3",
            runtimeStatus: "applied",
            runtimeMessage: "运行时已刷新",
            diffSummary: [
              {
                path: "width",
                change: "updated",
                previousValue: "8",
                nextValue: "10",
                kind: "value",
                required: true,
                fieldType: "integer",
                description: "地图宽度",
                blastRadius: ["配置台编辑器"]
              }
            ],
            impactSummary: {
              documentId: "world",
              title: "世界配置",
              summary: "地图扩图会影响世界预览与出生点分布。",
              riskLevel: "medium",
              changedFields: ["width", "resourceNodes"],
              impactedModules: ["世界预览", "资源生成"],
              riskHints: ["请复核出生点和资源密度。"],
              suggestedValidationActions: ["config-center 地图预览"]
            }
          }
        ]
      }
    ],
    publishAuditFilterId: "world",
    publishAuditFilterStatus: "applied",
    historyLoading: false
  });

  assert.match(html, /发布审计历史/);
  assert.match(html, /地图扩图会影响世界预览与出生点分布/);
  assert.match(html, /width/);
  assert.match(html, /快速回滚/);
});

test("config center render prioritizes structural snapshot diffs in rollback review", () => {
  const html = renderConfigCenterSnapshotDiffPanel({
    selectedSnapshotId: "snapshot-structural",
    snapshotDiff: {
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
        },
        {
          path: "width",
          change: "updated",
          previousValue: "8",
          nextValue: "10",
          kind: "value",
          required: true,
          fieldType: "integer",
          description: "地图宽度",
          blastRadius: ["配置台编辑器"]
        }
      ]
    }
  });

  assert.match(html, /警告：检测到 1\/2 条结构变更/);
  assert.match(html, /heroes\[0\]\.position\.x/);
  assert.match(html, /删除字段/);
  assert.match(html, /世界预览/);
});
