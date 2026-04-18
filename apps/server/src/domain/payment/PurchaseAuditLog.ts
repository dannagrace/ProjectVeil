import { randomUUID } from "node:crypto";
import { emitAnalyticsEvent } from "../../analytics";
import { recordRuntimeErrorEvent } from "../../observability";
import type { PaymentOrderSnapshot } from "../../persistence";

interface PurchaseAuditLogConfig {
  surface: string;
  paymentMethod: string;
  defaultRoute: string;
  defaultTags?: string[];
}

interface PurchaseCompletedInput {
  playerId: string;
  purchaseId: string;
  productId: string;
  quantity: number;
  totalPrice: number;
}

interface PurchaseFailedInput {
  playerId: string;
  purchaseId: string;
  productId: string;
  failureReason: string;
  orderStatus: PaymentOrderSnapshot["status"] | "failed";
}

interface FraudSignalInput {
  playerId: string;
  signal: string;
  orderId: string;
  productId: string;
  route?: string;
  tags?: string[];
  details?: Record<string, unknown>;
}

export class PurchaseAuditLog {
  constructor(private readonly config: PurchaseAuditLogConfig) {}

  emitCompleted(input: PurchaseCompletedInput): void {
    emitAnalyticsEvent("purchase_completed", {
      playerId: input.playerId,
      payload: {
        purchaseId: input.purchaseId,
        productId: input.productId,
        paymentMethod: this.config.paymentMethod,
        quantity: input.quantity,
        totalPrice: input.totalPrice
      }
    });
  }

  emitFailed(input: PurchaseFailedInput): void {
    emitAnalyticsEvent("purchase_failed", {
      playerId: input.playerId,
      payload: {
        purchaseId: input.purchaseId,
        productId: input.productId,
        paymentMethod: this.config.paymentMethod,
        failureReason: input.failureReason,
        orderStatus: input.orderStatus
      }
    });
  }

  emitFraudSignal(input: FraudSignalInput): void {
    try {
      emitAnalyticsEvent("payment_fraud_signal", {
        playerId: input.playerId,
        payload: {
          signal: input.signal,
          orderId: input.orderId,
          productId: input.productId,
          ...(input.details ?? {})
        }
      });
    } catch {
      // Fraud logging must not break payment handling.
    }

    recordRuntimeErrorEvent({
      id: randomUUID(),
      recordedAt: new Date().toISOString(),
      source: "server",
      surface: this.config.surface,
      candidateRevision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
      featureArea: "payment",
      ownerArea: "commerce",
      severity: "warn",
      errorCode: "payment_fraud_signal",
      message: `${this.config.surface} fraud signal triggered: ${input.signal}`,
      tags: [...new Set([this.config.surface, input.signal, ...(this.config.defaultTags ?? []), ...(input.tags ?? [])])],
      context: {
        roomId: null,
        playerId: input.playerId,
        requestId: null,
        route: input.route ?? this.config.defaultRoute,
        action: null,
        statusCode: null,
        crash: false,
        detail: JSON.stringify({
          orderId: input.orderId,
          productId: input.productId,
          signal: input.signal,
          ...(input.details ?? {})
        })
      }
    });
  }
}
