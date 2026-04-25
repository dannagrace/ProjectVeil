import type { IncomingMessage, ServerResponse } from "node:http";
import type { RoomSnapshotStore } from "@server/persistence";
import type { PaymentChannel, PaymentGateway } from "@server/domain/payment/PaymentGateway";

export interface PaymentGatewayHttpApp {
  use(handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void): void;
  get?(path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): void;
  post(path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): void;
}

export interface PaymentNotificationHandlerResult {
  status?: "processed" | "ignored" | "duplicate";
}

export type PaymentNotificationHandler<TNotificationEvent = never> = (
  store: RoomSnapshotStore | null,
  event: TNotificationEvent
) => PaymentNotificationHandlerResult | Promise<PaymentNotificationHandlerResult>;

export interface PaymentGatewayRegistration<TNotificationEvent = never> {
  gateway: PaymentGateway;
  notificationHandler?: PaymentNotificationHandler<TNotificationEvent>;
  registerRoutes(app: PaymentGatewayHttpApp, store: RoomSnapshotStore | null): void;
}

type AnyPaymentGatewayRegistration = PaymentGatewayRegistration<never>;

export class PaymentGatewayRegistry {
  readonly #registrations = new Map<PaymentChannel, AnyPaymentGatewayRegistration>();

  constructor(registrations: AnyPaymentGatewayRegistration[] = []) {
    for (const registration of registrations) {
      this.register(registration);
    }
  }

  register(registration: AnyPaymentGatewayRegistration): this {
    if (this.#registrations.has(registration.gateway.channel)) {
      throw new Error(`payment_gateway_already_registered:${registration.gateway.channel}`);
    }
    this.#registrations.set(registration.gateway.channel, registration);
    return this;
  }

  get(channel: PaymentChannel): AnyPaymentGatewayRegistration {
    const registration = this.#registrations.get(channel);
    if (!registration) {
      throw new Error(`payment_gateway_not_registered:${channel}`);
    }
    return registration;
  }

  list(): AnyPaymentGatewayRegistration[] {
    return [...this.#registrations.values()].sort((left, right) => left.gateway.channel.localeCompare(right.gateway.channel));
  }

  registerAll(app: PaymentGatewayHttpApp, store: RoomSnapshotStore | null): void {
    for (const registration of this.list()) {
      registration.registerRoutes(app, store);
    }
  }
}
