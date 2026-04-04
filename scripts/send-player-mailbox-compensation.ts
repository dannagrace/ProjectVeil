function readFlag(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== `--${name}`) {
      continue;
    }
    const value = process.argv[index + 1]?.trim();
    if (value) {
      values.push(value);
    }
  }
  return values;
}

function readSingleFlag(name: string): string | undefined {
  return readFlag(name)[0];
}

function readIntegerFlag(name: string): number | undefined {
  const rawValue = readSingleFlag(name);
  if (!rawValue) {
    return undefined;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return parsed;
}

function requireFlag(name: string): string {
  const value = readSingleFlag(name);
  if (!value) {
    throw new Error(`Missing required flag --${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const serverUrl = process.env.VEIL_SERVER_URL?.trim() || "http://127.0.0.1:2567";
  const adminToken = process.env.VEIL_ADMIN_TOKEN?.trim();
  if (!adminToken) {
    throw new Error("VEIL_ADMIN_TOKEN must be set");
  }

  const playerIds = readFlag("player");
  if (playerIds.length === 0) {
    throw new Error("At least one --player <playerId> flag is required");
  }

  const id = requireFlag("id");
  const title = requireFlag("title");
  const body = requireFlag("body");
  const expiresAt = readSingleFlag("expires-at");
  const gems = readIntegerFlag("gems");
  const gold = readIntegerFlag("gold");
  const wood = readIntegerFlag("wood");
  const ore = readIntegerFlag("ore");

  const response = await fetch(`${serverUrl.replace(/\/$/, "")}/api/admin/player-mailbox/deliver`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-veil-admin-token": adminToken
    },
    body: JSON.stringify({
      playerIds,
      message: {
        id,
        kind: "compensation",
        title,
        body,
        ...(expiresAt ? { expiresAt } : {}),
        ...(gems != null || gold != null || wood != null || ore != null
          ? {
              grant: {
                ...(gems != null ? { gems } : {}),
                ...(gold != null || wood != null || ore != null
                  ? {
                      resources: {
                        ...(gold != null ? { gold } : {}),
                        ...(wood != null ? { wood } : {}),
                        ...(ore != null ? { ore } : {})
                      }
                    }
                  : {})
              }
            }
          : {})
      }
    })
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`mailbox_delivery_failed:${response.status}:${JSON.stringify(payload)}`);
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

await main();
