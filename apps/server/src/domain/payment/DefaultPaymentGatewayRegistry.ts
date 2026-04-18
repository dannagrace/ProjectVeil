import { applePaymentGatewayRegistration } from "../../adapters/apple-iap";
import { googlePlayPaymentGatewayRegistration } from "../../adapters/google-play";
import { wechatPaymentGatewayRegistration } from "../../adapters/wechat-pay";
import { PaymentGatewayRegistry } from "./PaymentGatewayRegistry";

export function createDefaultPaymentGatewayRegistry(): PaymentGatewayRegistry {
  return new PaymentGatewayRegistry([
    applePaymentGatewayRegistration,
    googlePlayPaymentGatewayRegistration,
    wechatPaymentGatewayRegistration
  ]);
}
