import { recordPaymentDeadLetter, setPaymentGrantDeadLetterCount, setPaymentGrantQueueCount, setPaymentGrantQueueLatency } from "../../observability";
import type { PaymentGrantRetryPolicy, PaymentOrderSnapshot } from "../../persistence";
import type { PaymentOpsStore } from "./OrderIdempotencyStore";

const DEFAULT_PAYMENT_GRANT_MAX_ATTEMPTS = 5;
const DEFAULT_PAYMENT_GRANT_BASE_DELAY_MS = 60_000;

export function normalizePaymentGrantRetryPolicy(policy: PaymentGrantRetryPolicy = {}): { maxAttempts: number; baseDelayMs: number } {
  return {
    maxAttempts: Math.max(1, Math.floor(policy.maxAttempts ?? DEFAULT_PAYMENT_GRANT_MAX_ATTEMPTS)),
    baseDelayMs: Math.max(1_000, Math.floor(policy.baseDelayMs ?? DEFAULT_PAYMENT_GRANT_BASE_DELAY_MS))
  };
}

export async function refreshPaymentGrantObservability(store: PaymentOpsStore, now: Date) {
  const [pendingOrders, deadLetterOrders] = await Promise.all([
    store.listPaymentOrders({ statuses: ["grant_pending"], limit: 200 }),
    store.listPaymentOrders({ statuses: ["dead_letter"], limit: 200 })
  ]);

  setPaymentGrantQueueCount(pendingOrders.length);
  setPaymentGrantDeadLetterCount(deadLetterOrders.length);

  const pendingRetryTimes = pendingOrders
    .map((order) => (order.nextGrantRetryAt ? new Date(order.nextGrantRetryAt).getTime() : null))
    .filter((value): value is number => value != null && Number.isFinite(value))
    .sort((left, right) => left - right);

  const oldestQueuedLatencyMs =
    pendingOrders.length === 0
      ? null
      : pendingOrders
          .map((order) => (order.lastGrantAttemptAt ? Math.max(0, now.getTime() - new Date(order.lastGrantAttemptAt).getTime()) : 0))
          .reduce((max, value) => Math.max(max, value), 0);

  const nextPendingRetryTime = pendingRetryTimes[0];
  const nextAttemptDelayMs =
    nextPendingRetryTime != null ? Math.max(0, nextPendingRetryTime - now.getTime()) : null;

  setPaymentGrantQueueLatency({
    oldestQueuedLatencyMs,
    nextAttemptDelayMs
  });

  return {
    pendingOrders,
    deadLetterOrders
  };
}

export async function buildPaymentGrantRuntimePayload(store: PaymentOpsStore, now: Date) {
  const { pendingOrders, deadLetterOrders } = await refreshPaymentGrantObservability(store, now);
  return {
    checkedAt: now.toISOString(),
    queueCount: pendingOrders.length,
    deadLetterCount: deadLetterOrders.length,
    pendingOrders,
    deadLetterOrders
  };
}

export class CallbackDeadLetterQueue {
  constructor(
    private readonly store: PaymentOpsStore | null,
    private readonly now: () => Date
  ) {}

  async refresh() {
    if (!this.store) {
      throw new Error("payment_dead_letter_queue_unavailable");
    }
    return refreshPaymentGrantObservability(this.store, this.now());
  }

  async buildRuntimePayload() {
    if (!this.store) {
      throw new Error("payment_dead_letter_queue_unavailable");
    }
    return buildPaymentGrantRuntimePayload(this.store, this.now());
  }

  recordSettlement(order: Pick<PaymentOrderSnapshot, "status">): void {
    if (order.status === "dead_letter") {
      recordPaymentDeadLetter();
    }
  }

  recordDeadLetterTransition(previousStatus: PaymentOrderSnapshot["status"], nextStatus: PaymentOrderSnapshot["status"]): void {
    if (previousStatus !== "dead_letter" && nextStatus === "dead_letter") {
      recordPaymentDeadLetter();
    }
  }
}
