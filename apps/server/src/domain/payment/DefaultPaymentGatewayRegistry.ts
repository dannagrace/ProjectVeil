import { applePaymentGatewayRegistration } from "@server/adapters/apple-iap";
import { googlePlayPaymentGatewayRegistration } from "@server/adapters/google-play";
import { wechatPaymentGatewayRegistration } from "@server/adapters/wechat-pay";
import { PaymentGatewayRegistry } from "@server/domain/payment/PaymentGatewayRegistry";

export function createDefaultPaymentGatewayRegistry(): PaymentGatewayRegistry {
  return new PaymentGatewayRegistry([
    applePaymentGatewayRegistration,
    googlePlayPaymentGatewayRegistration,
    wechatPaymentGatewayRegistration
  ]);
}
