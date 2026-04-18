import type {
  PaymentOrderCompleteInput,
  PaymentOrderCreateInput,
  PaymentOrderGrantRetryInput,
  PaymentOrderSnapshot,
  PaymentOrderStatus,
  PaymentReceiptSnapshot,
  RoomSnapshotStore
} from "../../persistence";

export type PaymentReadyStore = RoomSnapshotStore &
  Required<
    Pick<
      RoomSnapshotStore,
      "createPaymentOrder" | "completePaymentOrder" | "loadPaymentOrder" | "loadPaymentReceiptByOrderId" | "countVerifiedPaymentReceiptsSince"
    >
  >;

export type PaymentOpsStore = RoomSnapshotStore & Required<Pick<RoomSnapshotStore, "listPaymentOrders">>;

export type PaymentRetryOpsStore = RoomSnapshotStore &
  Required<Pick<RoomSnapshotStore, "listPaymentOrders" | "retryPaymentOrderGrant">>;

export function isPaymentStoreReady(store: RoomSnapshotStore | null): store is PaymentReadyStore {
  return Boolean(
    store?.createPaymentOrder &&
      store.completePaymentOrder &&
      store.loadPaymentOrder &&
      store.loadPaymentReceiptByOrderId &&
      store.countVerifiedPaymentReceiptsSince
  );
}

export function isPaymentOpsStoreReady(store: RoomSnapshotStore | null): store is PaymentOpsStore {
  return Boolean(store?.listPaymentOrders);
}

export function isPaymentRetryOpsStoreReady(store: RoomSnapshotStore | null): store is PaymentRetryOpsStore {
  return Boolean(store?.listPaymentOrders && store.retryPaymentOrderGrant);
}

export function isFinalizedPaymentOrderStatus(status: PaymentOrderStatus): boolean {
  return status === "settled" || status === "dead_letter";
}

export function isAcceptedPaymentOrderStatus(status: PaymentOrderStatus): boolean {
  return status !== "created";
}

export class OrderIdempotencyStore {
  constructor(private readonly store: PaymentReadyStore) {}

  createOrder(input: PaymentOrderCreateInput) {
    return this.store.createPaymentOrder(input);
  }

  completeOrder(orderId: string, input: PaymentOrderCompleteInput) {
    return this.store.completePaymentOrder(orderId, input);
  }

  loadOrder(orderId: string): Promise<PaymentOrderSnapshot | null> {
    return this.store.loadPaymentOrder(orderId);
  }

  loadReceiptByOrderId(orderId: string): Promise<PaymentReceiptSnapshot | null> {
    return this.store.loadPaymentReceiptByOrderId(orderId);
  }

  countVerifiedReceiptsSince(playerId: string, since: string): Promise<number> {
    return this.store.countVerifiedPaymentReceiptsSince(playerId, since);
  }

  retryGrant(orderId: string, input: PaymentOrderGrantRetryInput) {
    if (!("retryPaymentOrderGrant" in this.store) || !this.store.retryPaymentOrderGrant) {
      throw new Error("payment_retry_unavailable");
    }
    return this.store.retryPaymentOrderGrant(orderId, input);
  }
}
