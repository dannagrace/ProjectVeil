import { expect, type APIRequestContext } from "@playwright/test";
import { ANALYTICS_EVENT_CATALOG, type AnalyticsEvent, type AnalyticsEventName } from "../../packages/shared/src/analytics-events";

const SERVER_BASE_URL = "http://127.0.0.1:2567";
const ANALYTICS_CAPTURE_ENDPOINT = `${SERVER_BASE_URL}/api/test/analytics/events`;

interface AnalyticsCapturePayload {
  events?: AnalyticsEvent[];
}

type AnalyticsPayloadValue = string | number | boolean | null | AnalyticsPayloadValue[] | { [key: string]: AnalyticsPayloadValue };

function expectPayloadMatchesSample(sample: AnalyticsPayloadValue, actual: AnalyticsPayloadValue, path: string): void {
  if (Array.isArray(sample)) {
    expect(Array.isArray(actual), `${path} should be an array`).toBe(true);
    const sampleItem = sample[0];
    if (sampleItem === undefined) {
      return;
    }

    const actualArray = actual as AnalyticsPayloadValue[];
    for (const [index, item] of actualArray.entries()) {
      expectPayloadMatchesSample(sampleItem, item, `${path}[${index}]`);
    }
    return;
  }

  if (sample && typeof sample === "object") {
    expect(actual && typeof actual === "object" && !Array.isArray(actual), `${path} should be an object`).toBe(true);
    for (const [key, value] of Object.entries(sample as Record<string, AnalyticsPayloadValue>)) {
      const actualValue = (actual as Record<string, AnalyticsPayloadValue | undefined>)[key];
      expect(actualValue, `${path}.${key} should be defined`).not.toBeUndefined();
      expectPayloadMatchesSample(value, actualValue as AnalyticsPayloadValue, `${path}.${key}`);
    }
    return;
  }

  if (sample === null) {
    expect(actual, `${path} should be null`).toBeNull();
    return;
  }

  expect(typeof actual, `${path} should be a ${typeof sample}`).toBe(typeof sample);
}

export async function pollForAnalyticsEvent<Name extends AnalyticsEventName>(
  request: APIRequestContext,
  name: Name,
  predicate?: (event: AnalyticsEvent<Name>) => boolean
): Promise<AnalyticsEvent<Name>> {
  const catalogEntry = ANALYTICS_EVENT_CATALOG[name];
  let matchedEvent: AnalyticsEvent<Name> | null = null;

  await expect
    .poll(
      async () => {
        const response = await request.get(ANALYTICS_CAPTURE_ENDPOINT);
        expect(response.ok()).toBeTruthy();

        const payload = (await response.json()) as AnalyticsCapturePayload;
        const events = (payload.events ?? []).filter((event): event is AnalyticsEvent<Name> => event.name === name);
        matchedEvent = predicate ? events.find(predicate) ?? null : (events.at(-1) ?? null);
        return matchedEvent ? 1 : 0;
      },
      {
        message: `waiting for analytics event ${name}`,
        timeout: 10_000
      }
    )
    .toBe(1);

  expect(matchedEvent, `${name} should be captured`).toBeTruthy();
  if (!matchedEvent) {
    throw new Error(`Expected analytics event ${name} to be captured`);
  }

  expect(matchedEvent.name).toBe(catalogEntry.name);
  expect(matchedEvent.version).toBe(catalogEntry.version);
  expectPayloadMatchesSample(
    catalogEntry.samplePayload as AnalyticsPayloadValue,
    matchedEvent.payload as AnalyticsPayloadValue,
    `${name}.payload`
  );
  return matchedEvent;
}
