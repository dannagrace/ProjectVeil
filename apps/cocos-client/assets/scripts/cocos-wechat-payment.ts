import { buildCocosAuthHeaders, resolveCocosApiBaseUrl } from "./cocos-lobby.ts";

type FetchLike = typeof fetch;

export interface CocosWechatPaymentOrder {
  orderId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: string;
  paySign: string;
}

export interface CocosWechatPaymentRuntimeLike {
  requestPayment?: ((options: {
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: string;
    paySign: string;
    success?: (result: { errMsg?: string }) => void;
    fail?: (error: { errMsg?: string }) => void;
  }) => void) | undefined;
}

function getFetchImpl(fetchImpl?: FetchLike): FetchLike {
  return fetchImpl ?? fetch;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  return (await response.json()) as unknown;
}

export async function createCocosWechatPaymentOrder(
  remoteUrl: string,
  productId: string,
  options?: {
    fetchImpl?: FetchLike;
    authToken?: string | null;
  }
): Promise<CocosWechatPaymentOrder> {
  const response = await getFetchImpl(options?.fetchImpl)(`${resolveCocosApiBaseUrl(remoteUrl)}/api/payments/wechat/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildCocosAuthHeaders(options?.authToken)
    },
    body: JSON.stringify({
      productId
    })
  });

  if (!response.ok) {
    let errorCode = "unknown";
    try {
      const payload = (await readJsonResponse(response)) as { error?: { code?: string } };
      errorCode = payload.error?.code?.trim() || errorCode;
    } catch {
      errorCode = "unknown";
    }
    throw new Error(`cocos_request_failed:${response.status}:${errorCode}`);
  }

  return (await readJsonResponse(response)) as CocosWechatPaymentOrder;
}

export async function requestCocosWechatPayment(
  runtime: CocosWechatPaymentRuntimeLike | null | undefined,
  order: CocosWechatPaymentOrder
): Promise<{ available: boolean; message: string }> {
  if (typeof runtime?.requestPayment !== "function") {
    return {
      available: false,
      message: "当前环境未暴露 wx.requestPayment。"
    };
  }

  return new Promise((resolve, reject) => {
    runtime.requestPayment?.({
      timeStamp: order.timeStamp,
      nonceStr: order.nonceStr,
      package: order.package,
      signType: order.signType,
      paySign: order.paySign,
      success: () => {
        resolve({
          available: true,
          message: `微信订单 ${order.orderId} 已发起，等待服务端到账确认。`
        });
      },
      fail: (error) => {
        reject(new Error(error.errMsg?.trim() || "wechat_payment_failed"));
      }
    });
  });
}
