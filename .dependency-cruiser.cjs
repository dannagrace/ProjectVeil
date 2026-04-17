/**
 * dependency-cruiser config — architectural boundary guard.
 * Rules mirror docs/architecture-boundaries.md. Violations fail CI.
 *
 * Docs: https://github.com/sverweij/dependency-cruiser
 */
module.exports = {
  forbidden: [
    {
      name: "shared-no-node-natives",
      severity: "error",
      comment:
        "packages/shared must stay runtime-neutral (runs in both Node and browser/WeChat/Cocos). Do not import Node core modules here.",
      from: { path: "^packages/shared/src" },
      to: {
        dependencyTypes: ["core"]
      }
    },
    {
      name: "shared-no-apps",
      severity: "error",
      comment:
        "packages/shared must not depend on any app. Apps depend on shared, never the reverse.",
      from: { path: "^packages/shared/src" },
      to: { path: "^apps/" }
    },
    {
      name: "cocos-no-server",
      severity: "error",
      comment:
        "Cocos client ships to end-user devices and must never import server code.",
      from: { path: "^apps/cocos-client" },
      to: { path: "^apps/server" }
    },
    {
      name: "server-infra-no-up",
      severity: "error",
      comment:
        "apps/server/src/infra is the lowest layer. It must not depend on domain/transport/adapters.",
      from: { path: "^apps/server/src/infra" },
      to: {
        path: [
          "^apps/server/src/domain",
          "^apps/server/src/transport",
          "^apps/server/src/adapters"
        ]
      }
    },
    {
      name: "server-domain-no-transport",
      severity: "error",
      comment:
        "apps/server/src/domain must not depend on apps/server/src/transport.",
      from: { path: "^apps/server/src/domain" },
      to: { path: "^apps/server/src/transport" }
    },
    {
      name: "server-adapters-no-transport",
      severity: "error",
      comment:
        "apps/server/src/adapters must not depend on apps/server/src/transport.",
      from: { path: "^apps/server/src/adapters" },
      to: { path: "^apps/server/src/transport" }
    },
    {
      name: "no-circular",
      severity: "warn",
      comment:
        "Circular deps cause unpredictable load order and compile slowdowns.",
      from: {},
      to: { circular: true }
    },
    {
      name: "no-orphans",
      severity: "info",
      comment:
        "Files that nobody imports are often dead code or mis-placed exports.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$",
          "\\.d\\.ts$",
          "(^|/)tsconfig[^/]*\\.json$",
          "(^|/)\\.dependency-cruiser\\.(js|cjs|json)$",
          "(^|/)package(-lock)?\\.json$",
          "apps/cocos-client/assets/scripts/",
          "apps/cocos-client/build-templates/",
          "apps/cocos-client/tooling/",
          "apps/server/src/index\\.ts$",
          "apps/client/src/",
          "apps/client/test/",
          "apps/server/test/",
          "packages/shared/src/__tests__/",
          "scripts/",
          "tests/"
        ]
      },
      to: {}
    }
  ],
  options: {
    doNotFollow: {
      path: ["node_modules", ".review-worktrees", "\\.d\\.ts$"]
    },
    includeOnly: {
      path: ["^apps/", "^packages/", "^scripts/", "^tests/"]
    },
    exclude: {
      path: [
        "node_modules",
        "\\.review-worktrees",
        "\\.d\\.ts$",
        "dist/",
        "build/",
        "coverage/",
        "artifacts/",
        "apps/cocos-client/assets/scripts/",
        "apps/cocos-client/build-templates/",
        "apps/cocos-client/tooling/",
        "apps/cocos-client/test/",
        "apps/cocos-client/resources/"
      ]
    },
    tsConfig: { fileName: "tsconfig.base.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      extensions: [".ts", ".tsx", ".js", ".cjs", ".mjs", ".json"]
    },
    reporterOptions: {
      text: { highlightFocused: true }
    }
  }
};
