export type PaymentChannel = "wechat" | "apple" | "google";

export type PaymentGatewayOperation = "createOrder" | "verifyCallback" | "grantRewards" | "issueRefund";

export interface CreateOrderInput {
  playerId: string;
  productId: string;
  amount: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}

export interface OrderDescriptor {
  channel: PaymentChannel;
  orderId: string;
  amount: number;
  currency: string;
  status: "created" | "pending";
  externalOrderId?: string;
  clientPayload?: Record<string, unknown>;
}

export interface CallbackPayload {
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  rawBody?: string;
}

export interface CallbackRejection {
  accepted: false;
  reason: string;
  statusCode?: number;
}

export interface VerifiedCallback {
  accepted: true;
  orderId: string;
  externalOrderId: string;
  paidAt?: string;
  payload: Record<string, unknown>;
}

export interface VerifiedOrder {
  channel: PaymentChannel;
  orderId: string;
  playerId: string;
  productId: string;
  amount: number;
  externalOrderId?: string;
  paidAt?: string;
  verifiedAt?: string;
  payload?: Record<string, unknown>;
}

export interface GrantResult {
  granted: boolean;
  reason?: string;
  receiptId?: string;
}

export interface RefundReason {
  code: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface RefundResult {
  refunded: boolean;
  reason?: string;
  externalRefundId?: string;
}

export interface PaymentGateway {
  channel: PaymentChannel;
  supportedOperations: readonly PaymentGatewayOperation[];
  createOrder(input: CreateOrderInput): Promise<OrderDescriptor>;
  verifyCallback(raw: CallbackPayload): Promise<VerifiedCallback | CallbackRejection>;
  grantRewards(order: VerifiedOrder): Promise<GrantResult>;
  issueRefund(order: VerifiedOrder, reason: RefundReason): Promise<RefundResult>;
}

export class PaymentGatewayOperationUnsupportedError extends Error {
  readonly channel: PaymentChannel;
  readonly operation: PaymentGatewayOperation;

  constructor(channel: PaymentChannel, operation: PaymentGatewayOperation, detail?: string) {
    super(detail ?? `${channel} gateway does not support ${operation}`);
    this.name = "payment_gateway_operation_unsupported";
    this.channel = channel;
    this.operation = operation;
  }
}

export function isPaymentGatewayOperationSupported(
  gateway: Pick<PaymentGateway, "supportedOperations">,
  operation: PaymentGatewayOperation
): boolean {
  return gateway.supportedOperations.includes(operation);
}

export function unsupportedPaymentGatewayOperation<T>(
  channel: PaymentChannel,
  operation: PaymentGatewayOperation,
  detail?: string
): Promise<T> {
  return Promise.reject(new PaymentGatewayOperationUnsupportedError(channel, operation, detail));
}
