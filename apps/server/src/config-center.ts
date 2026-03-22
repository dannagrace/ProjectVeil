import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { createConnection, createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import {
  getDefaultMapObjectsConfig,
  getDefaultUnitCatalog,
  getDefaultWorldConfig,
  replaceRuntimeConfigs,
  validateMapObjectsConfig,
  validateUnitCatalog,
  validateWorldConfig,
  type MapObjectsConfig,
  type RuntimeConfigBundle,
  type UnitCatalogConfig,
  type WorldGenerationConfig
} from "../../../packages/shared/src/index";
import {
  MYSQL_CONFIG_DOCUMENT_TABLE,
  MYSQL_CONFIG_DOCUMENT_UPDATED_AT_INDEX,
  type MySqlPersistenceConfig,
  readMySqlPersistenceConfig
} from "./persistence";

export type ConfigDocumentId = "world" | "mapObjects" | "units";

interface ConfigDefinition {
  id: ConfigDocumentId;
  fileName: string;
  title: string;
  description: string;
}

interface ErrorPayload {
  code: string;
  message: string;
}

interface MySqlConfigDocumentRow extends RowDataPacket {
  document_id: string;
  content_json: string;
  version: number;
  exported_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface ConfigDocumentSummary {
  id: ConfigDocumentId;
  title: string;
  description: string;
  fileName: string;
  updatedAt: string;
  summary: string;
  storage: "filesystem" | "mysql";
  version?: number;
  exportedAt?: string | null;
}

export interface ConfigDocument extends ConfigDocumentSummary {
  content: string;
}

export interface ConfigCenterStore {
  initializeRuntimeConfigs(): Promise<void>;
  listDocuments(): Promise<ConfigDocumentSummary[]>;
  loadDocument(id: ConfigDocumentId): Promise<ConfigDocument>;
  saveDocument(id: ConfigDocumentId, content: string): Promise<ConfigDocument>;
  close(): Promise<void>;
  readonly mode: "filesystem" | "mysql";
}

const CONFIG_DEFINITIONS: ConfigDefinition[] = [
  {
    id: "world",
    fileName: "phase1-world.json",
    title: "世界配置",
    description: "地图尺寸、初始英雄、资源生成概率。"
  },
  {
    id: "mapObjects",
    fileName: "phase1-map-objects.json",
    title: "地图物件",
    description: "中立怪、保底资源点与地图交互物件。"
  },
  {
    id: "units",
    fileName: "units.json",
    title: "兵种配置",
    description: "兵种模板、阵营、品质和战斗数值。"
  }
];

function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof Error) {
    return {
      code: "request_failed",
      message: error.message
    };
  }

  return {
    code: "request_failed",
    message: "Unknown error"
  };
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendNotFound(response: ServerResponse): void {
  sendJson(response, 404, {
    error: {
      code: "not_found",
      message: "Config document not found"
    }
  });
}

function configDefinitionFor(id: string): ConfigDefinition | undefined {
  return CONFIG_DEFINITIONS.find((item) => item.id === id);
}

function buildSummary(id: ConfigDocumentId, parsed: unknown): string {
  if (id === "world") {
    const config = parsed as WorldGenerationConfig;
    return `${config.width}x${config.height} · ${config.heroes.length} hero(es)`;
  }

  if (id === "mapObjects") {
    const config = parsed as MapObjectsConfig;
    return `${config.neutralArmies.length} neutral army(ies) · ${config.guaranteedResources.length} guaranteed resource(s)`;
  }

  const config = parsed as UnitCatalogConfig;
  return `${config.templates.length} unit template(s)`;
}

function normalizeJsonContent(parsed: WorldGenerationConfig | MapObjectsConfig | UnitCatalogConfig): string {
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function parseConfigDocument(
  id: ConfigDocumentId,
  content: string
): WorldGenerationConfig | MapObjectsConfig | UnitCatalogConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Config content is not valid JSON");
  }

  if (id === "world") {
    const nextWorld = parsed as WorldGenerationConfig;
    validateWorldConfig(nextWorld);
    return nextWorld;
  }

  if (id === "mapObjects") {
    return parsed as MapObjectsConfig;
  }

  const nextCatalog = parsed as UnitCatalogConfig;
  validateUnitCatalog(nextCatalog);
  return nextCatalog;
}

function buildRuntimeConfigBundle(
  documents: Partial<Record<ConfigDocumentId, WorldGenerationConfig | MapObjectsConfig | UnitCatalogConfig>>
): RuntimeConfigBundle {
  const world = (documents.world ?? getDefaultWorldConfig()) as WorldGenerationConfig;
  const mapObjects = (documents.mapObjects ?? getDefaultMapObjectsConfig()) as MapObjectsConfig;
  const units = (documents.units ?? getDefaultUnitCatalog()) as UnitCatalogConfig;

  validateWorldConfig(world);
  validateMapObjectsConfig(mapObjects, world);
  validateUnitCatalog(units);

  return {
    world,
    mapObjects,
    units
  };
}

function applyRuntimeBundle(bundle: RuntimeConfigBundle): void {
  replaceRuntimeConfigs(bundle);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function formatTimestamp(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

abstract class BaseConfigCenterStore implements ConfigCenterStore {
  abstract readonly mode: "filesystem" | "mysql";

  constructor(protected readonly rootDir = resolve(process.cwd(), "configs")) {}

  async ensureRootDir(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  protected filePathFor(id: ConfigDocumentId): string {
    const definition = configDefinitionFor(id);
    if (!definition) {
      throw new Error(`Unsupported config id: ${id}`);
    }

    return resolve(this.rootDir, definition.fileName);
  }

  protected async exportDocumentToFile(id: ConfigDocumentId, content: string): Promise<void> {
    await this.ensureRootDir();
    await writeFile(this.filePathFor(id), content, "utf8");
  }

  protected buildDocument(
    definition: ConfigDefinition,
    content: string,
    metadata: {
      updatedAt: string;
      version?: number;
      exportedAt?: string | null;
    }
  ): ConfigDocument {
    const parsed = JSON.parse(content) as unknown;

    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      fileName: definition.fileName,
      updatedAt: metadata.updatedAt,
      summary: buildSummary(definition.id, parsed),
      storage: this.mode,
      ...(metadata.version != null ? { version: metadata.version } : {}),
      ...(metadata.exportedAt !== undefined ? { exportedAt: metadata.exportedAt } : {}),
      content
    };
  }

  async initializeRuntimeConfigs(): Promise<void> {
    const documents = await Promise.all(CONFIG_DEFINITIONS.map((definition) => this.loadDocument(definition.id)));
    const bundle = buildRuntimeConfigBundle(
      Object.fromEntries(
        documents.map((document) => [document.id, parseConfigDocument(document.id, document.content)])
      ) as Partial<Record<ConfigDocumentId, WorldGenerationConfig | MapObjectsConfig | UnitCatalogConfig>>
    );

    applyRuntimeBundle(bundle);
    await Promise.all([
      this.exportDocumentToFile("world", normalizeJsonContent(bundle.world)),
      this.exportDocumentToFile("mapObjects", normalizeJsonContent(bundle.mapObjects)),
      this.exportDocumentToFile("units", normalizeJsonContent(bundle.units))
    ]);
  }

  async listDocuments(): Promise<ConfigDocumentSummary[]> {
    const items = await Promise.all(CONFIG_DEFINITIONS.map((definition) => this.loadDocument(definition.id)));
    return items.map(({ content: _content, ...summary }) => summary);
  }

  abstract loadDocument(id: ConfigDocumentId): Promise<ConfigDocument>;
  abstract saveDocument(id: ConfigDocumentId, content: string): Promise<ConfigDocument>;
  abstract close(): Promise<void>;
}

export class FileSystemConfigCenterStore extends BaseConfigCenterStore {
  readonly mode = "filesystem" as const;

  async loadDocument(id: ConfigDocumentId): Promise<ConfigDocument> {
    const definition = configDefinitionFor(id);
    if (!definition) {
      throw new Error(`Unsupported config id: ${id}`);
    }

    const filePath = this.filePathFor(id);
    const [fileContent, fileStats] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    const parsed = parseConfigDocument(id, fileContent);

    return this.buildDocument(definition, normalizeJsonContent(parsed), {
      updatedAt: fileStats.mtime.toISOString()
    });
  }

  async saveDocument(id: ConfigDocumentId, content: string): Promise<ConfigDocument> {
    const parsed = parseConfigDocument(id, content);
    const bundle = buildRuntimeConfigBundle({
      world: id === "world" ? parsed : getDefaultWorldConfig(),
      mapObjects: id === "mapObjects" ? parsed : getDefaultMapObjectsConfig(),
      units: id === "units" ? parsed : getDefaultUnitCatalog()
    });
    const serialized = normalizeJsonContent(bundle[id]);

    await this.exportDocumentToFile(id, serialized);
    applyRuntimeBundle(bundle);

    return this.loadDocument(id);
  }

  async close(): Promise<void> {
    return;
  }
}

export class MySqlConfigCenterStore extends BaseConfigCenterStore {
  readonly mode = "mysql" as const;

  private constructor(
    private readonly pool: Pool,
    private readonly database: string,
    rootDir: string
  ) {
    super(rootDir);
  }

  static async create(config: MySqlPersistenceConfig, rootDir = resolve(process.cwd(), "configs")): Promise<MySqlConfigCenterStore> {
    const bootstrap = await createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password
    });

    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.database}\` DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci`
    );
    await bootstrap.end();

    const pool = createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: 4,
      namedPlaceholders: true
    });

    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${MYSQL_CONFIG_DOCUMENT_TABLE}\` (
        document_id VARCHAR(64) NOT NULL,
        content_json LONGTEXT NOT NULL,
        version BIGINT UNSIGNED NOT NULL DEFAULT 1,
        exported_at DATETIME NULL DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (document_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    const [indexRows] = await pool.query<RowDataPacket[]>(
      `SELECT 1
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND INDEX_NAME = ?
       LIMIT 1`,
      [config.database, MYSQL_CONFIG_DOCUMENT_TABLE, MYSQL_CONFIG_DOCUMENT_UPDATED_AT_INDEX]
    );

    if (!indexRows[0]) {
      await pool.query(
        `CREATE INDEX \`${MYSQL_CONFIG_DOCUMENT_UPDATED_AT_INDEX}\`
         ON \`${MYSQL_CONFIG_DOCUMENT_TABLE}\` (updated_at)`
      );
    }

    return new MySqlConfigCenterStore(pool, config.database, rootDir);
  }

  async initializeRuntimeConfigs(): Promise<void> {
    await this.bootstrapMissingDocumentsFromFiles();
    await super.initializeRuntimeConfigs();
  }

  async loadDocument(id: ConfigDocumentId): Promise<ConfigDocument> {
    const definition = configDefinitionFor(id);
    if (!definition) {
      throw new Error(`Unsupported config id: ${id}`);
    }

    const row = await this.loadRow(id);
    if (!row) {
      throw new Error(`Missing config document in MySQL: ${id}`);
    }

    const parsed = parseConfigDocument(id, row.content_json);
    return this.buildDocument(definition, normalizeJsonContent(parsed), {
      updatedAt: formatTimestamp(row.updated_at) ?? new Date().toISOString(),
      version: row.version,
      exportedAt: formatTimestamp(row.exported_at)
    });
  }

  async saveDocument(id: ConfigDocumentId, content: string): Promise<ConfigDocument> {
    const parsed = parseConfigDocument(id, content);
    const bundle = buildRuntimeConfigBundle({
      world: id === "world" ? parsed : getDefaultWorldConfig(),
      mapObjects: id === "mapObjects" ? parsed : getDefaultMapObjectsConfig(),
      units: id === "units" ? parsed : getDefaultUnitCatalog()
    });
    const serialized = normalizeJsonContent(bundle[id]);

    await this.pool.query(
      `INSERT INTO \`${MYSQL_CONFIG_DOCUMENT_TABLE}\` (document_id, content_json, exported_at)
       VALUES (?, ?, NULL)
       ON DUPLICATE KEY UPDATE
         content_json = VALUES(content_json),
         exported_at = NULL,
         version = version + 1`,
      [id, serialized]
    );

    await this.exportDocumentToFile(id, serialized);
    await this.pool.query(
      `UPDATE \`${MYSQL_CONFIG_DOCUMENT_TABLE}\`
       SET exported_at = CURRENT_TIMESTAMP
       WHERE document_id = ?`,
      [id]
    );
    applyRuntimeBundle(bundle);

    return this.loadDocument(id);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  describe(): string {
    return `mysql://${this.database}/${MYSQL_CONFIG_DOCUMENT_TABLE}`;
  }

  private async bootstrapMissingDocumentsFromFiles(): Promise<void> {
    for (const definition of CONFIG_DEFINITIONS) {
      const existing = await this.loadRow(definition.id);
      if (existing) {
        continue;
      }

      const fileContent = await readFile(this.filePathFor(definition.id), "utf8");
      const parsed = parseConfigDocument(definition.id, fileContent);
      const serialized = normalizeJsonContent(parsed);

      await this.pool.query(
        `INSERT INTO \`${MYSQL_CONFIG_DOCUMENT_TABLE}\` (document_id, content_json, exported_at)
         VALUES (?, ?, NULL)`,
        [definition.id, serialized]
      );
      await this.exportDocumentToFile(definition.id, serialized);
      await this.pool.query(
        `UPDATE \`${MYSQL_CONFIG_DOCUMENT_TABLE}\`
         SET exported_at = CURRENT_TIMESTAMP
         WHERE document_id = ?`,
        [definition.id]
      );
    }
  }

  private async loadRow(id: ConfigDocumentId): Promise<MySqlConfigDocumentRow | null> {
    const [rows] = await this.pool.query<MySqlConfigDocumentRow[]>(
      `SELECT document_id, content_json, version, exported_at, created_at, updated_at
       FROM \`${MYSQL_CONFIG_DOCUMENT_TABLE}\`
       WHERE document_id = ?
       LIMIT 1`,
      [id]
    );

    return rows[0] ?? null;
  }
}

export async function createConfiguredConfigCenterStore(
  env: NodeJS.ProcessEnv = process.env,
  rootDir = resolve(process.cwd(), "configs")
): Promise<ConfigCenterStore> {
  const mysqlConfig = readMySqlPersistenceConfig(env);
  if (!mysqlConfig) {
    return new FileSystemConfigCenterStore(rootDir);
  }

  return MySqlConfigCenterStore.create(mysqlConfig, rootDir);
}

export function registerConfigCenterRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>) => void;
    put: (path: string, handler: (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: ConfigCenterStore
): void {
  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.get("/api/config-center/configs", async (_request, response) => {
    try {
      sendJson(response, 200, {
        storage: store.mode,
        items: await store.listDocuments()
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/config-center/configs/:id", async (request, response) => {
    const configId = request.params.id;
    if (!configId) {
      sendNotFound(response);
      return;
    }

    const definition = configDefinitionFor(configId);
    if (!definition) {
      sendNotFound(response);
      return;
    }

    try {
      sendJson(response, 200, {
        storage: store.mode,
        document: await store.loadDocument(definition.id)
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.put("/api/config-center/configs/:id", async (request, response) => {
    const configId = request.params.id;
    if (!configId) {
      sendNotFound(response);
      return;
    }

    const definition = configDefinitionFor(configId);
    if (!definition) {
      sendNotFound(response);
      return;
    }

    try {
      const body = (await readJsonBody(request)) as { content?: string };
      if (typeof body.content !== "string") {
        sendJson(response, 400, {
          error: {
            code: "invalid_payload",
            message: "Expected string field: content"
          }
        });
        return;
      }

      sendJson(response, 200, {
        storage: store.mode,
        document: await store.saveDocument(definition.id, body.content)
      });
    } catch (error) {
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });
}
