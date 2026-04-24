import type { PaymentOrderRefundInput, RoomSnapshotStore } from "@server/persistence";

export type PaymentRefundNotificationChannel = "apple" | "google" | "wechat";

export interface PaymentRefundNotification {
  channel: PaymentRefundNotificationChannel;
  notificationType: string;
  orderId?: string;
  eventId?: string;
  eventTime?: string;
  externalRefundId?: string;
}

export interface PaymentRefundNotificationResult {
  status: "processed" | "ignored" | "duplicate";
  reason?: string;
}

type PaymentRefundStore = RoomSnapshotStore & Required<Pick<RoomSnapshotStore, "refundPaymentOrder">>;

const APPLE_REFUND_NOTIFICATION_TYPES = new Set(["REFUND", "DID_REVOKE", "DID_FAIL_TO_RENEW"]);
const GOOGLE_REFUND_NOTIFICATION_TYPES = new Set(["VOIDED_PURCHASE", "SUBSCRIPTION_REVOKED", "ONE_TIME_PRODUCT_CANCELED"]);
const WECHAT_REFUND_NOTIFICATION_TYPES = new Set(["REFUND", "REFUND.SUCCESS"]);

function isPaymentRefundStoreReady(store: RoomSnapshotStore | null): store is PaymentRefundStore {
  return Boolean(store?.refundPaymentOrder);
}

function normalizeNotificationType(notificationType: string): string {
  return notificationType.trim().toUpperCase();
}

export function isPaymentRefundNotification(input: Pick<PaymentRefundNotification, "channel" | "notificationType">): boolean {
  const notificationType = normalizeNotificationType(input.notificationType);
  switch (input.channel) {
    case "apple":
      return APPLE_REFUND_NOTIFICATION_TYPES.has(notificationType);
    case "google":
      return GOOGLE_REFUND_NOTIFICATION_TYPES.has(notificationType);
    case "wechat":
      return WECHAT_REFUND_NOTIFICATION_TYPES.has(notificationType);
    default: {
      const exhaustiveCheck: never = input.channel;
      return exhaustiveCheck;
    }
  }
}

export async function handlePaymentRefundNotification(
  store: RoomSnapshotStore | null,
  notification: PaymentRefundNotification
): Promise<PaymentRefundNotificationResult> {
  const notificationType = normalizeNotificationType(notification.notificationType);
  if (!isPaymentRefundNotification({ channel: notification.channel, notificationType })) {
    return { status: "ignored", reason: "not_refund_notification" };
  }
  const orderId = notification.orderId?.trim();
  if (!orderId) {
    return { status: "ignored", reason: "missing_order_id" };
  }
  if (!isPaymentRefundStoreReady(store)) {
    return { status: "ignored", reason: "payment_refund_persistence_unavailable" };
  }

  const refundInput: PaymentOrderRefundInput = {
    reasonCode: `${notification.channel}:${notificationType}`
  };
  if (notification.eventTime) {
    refundInput.refundedAt = notification.eventTime;
  }
  if (notification.externalRefundId) {
    refundInput.externalRefundId = notification.externalRefundId;
  } else if (notification.eventId) {
    refundInput.externalRefundId = notification.eventId;
  }

  try {
    const settlement = await store.refundPaymentOrder(orderId, refundInput);
    return {
      status: settlement.refunded ? "processed" : "duplicate"
    };
  } catch (error) {
    if (error instanceof Error && error.message === "payment_order_not_found") {
      return { status: "ignored", reason: "payment_order_not_found" };
    }
    throw error;
  }
}
