import type { IncomingMessage, ServerResponse } from "node:http";
import type { RoomSnapshotStore } from "./persistence";

interface RetentionSummaryHttpApp {
  get(path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): void;
}

interface RetentionSummaryCohort {
  cohortDate: string;
  newPlayers: number;
  retainedD1: number;
  retainedD7: number;
  retainedD30: number;
  retainedRateD1: number;
  retainedRateD7: number;
  retainedRateD30: number;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function toIsoDate(input?: string | null): string | null {
  if (!input?.trim()) {
    return null;
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function addDays(baseDate: string, days: number): string {
  const parsed = new Date(`${baseDate}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function buildRetentionSummary(accounts: Awaited<ReturnType<RoomSnapshotStore["listPlayerAccounts"]>>): RetentionSummaryCohort[] {
  const byCohort = new Map<string, RetentionSummaryCohort>();

  for (const account of accounts) {
    const cohortDate = toIsoDate(account.createdAt);
    if (!cohortDate) {
      continue;
    }

    const activityDate = toIsoDate(account.lastSeenAt) ?? toIsoDate(account.updatedAt) ?? toIsoDate(account.createdAt);
    const summary = byCohort.get(cohortDate) ?? {
      cohortDate,
      newPlayers: 0,
      retainedD1: 0,
      retainedD7: 0,
      retainedD30: 0,
      retainedRateD1: 0,
      retainedRateD7: 0,
      retainedRateD30: 0
    };

    summary.newPlayers += 1;
    if (activityDate && activityDate >= addDays(cohortDate, 1)) {
      summary.retainedD1 += 1;
    }
    if (activityDate && activityDate >= addDays(cohortDate, 7)) {
      summary.retainedD7 += 1;
    }
    if (activityDate && activityDate >= addDays(cohortDate, 30)) {
      summary.retainedD30 += 1;
    }
    byCohort.set(cohortDate, summary);
  }

  return Array.from(byCohort.values())
    .map((cohort) => ({
      ...cohort,
      retainedRateD1: cohort.newPlayers === 0 ? 0 : Number((cohort.retainedD1 / cohort.newPlayers).toFixed(4)),
      retainedRateD7: cohort.newPlayers === 0 ? 0 : Number((cohort.retainedD7 / cohort.newPlayers).toFixed(4)),
      retainedRateD30: cohort.newPlayers === 0 ? 0 : Number((cohort.retainedD30 / cohort.newPlayers).toFixed(4))
    }))
    .sort((left, right) => right.cohortDate.localeCompare(left.cohortDate));
}

export function registerRetentionSummaryRoute(app: RetentionSummaryHttpApp, store: RoomSnapshotStore | null): void {
  app.get("/ops/retention-summary", async (_request, response) => {
    if (!store) {
      sendJson(response, 503, {
        error: {
          code: "persistence_unavailable",
          message: "Retention summary requires configured room persistence storage"
        }
      });
      return;
    }

    try {
      const cohorts = buildRetentionSummary(await store.listPlayerAccounts());
      sendJson(response, 200, {
        cohorts,
        methodology: "created_at cohort with last_seen_at lower-bound retention inference"
      });
    } catch (error) {
      sendJson(response, 500, {
        error: {
          code: error instanceof Error ? error.name || "error" : "error",
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  });
}
