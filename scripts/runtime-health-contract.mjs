function asObject(value) {
  return value !== null && typeof value === "object" ? value : null;
}

export function isBaselineRuntimeHealthResponse(status, payload) {
  const body = asObject(payload);
  if (!body) {
    return false;
  }

  if (status >= 200 && status < 300 && body.status === "ok") {
    return true;
  }

  const runtime = asObject(body.runtime);
  const persistence = asObject(runtime?.persistence);
  return (
    status === 503 &&
    body.status === "warn" &&
    persistence?.status === "degraded" &&
    persistence?.storage === "memory"
  );
}

export function describeRuntimeHealth(payload) {
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

export function assertBaselineRuntimeHealthResponse(status, payload, label = "runtime health") {
  if (!isBaselineRuntimeHealthResponse(status, payload)) {
    throw new Error(`${label} is ${describeRuntimeHealth(payload)} (HTTP ${status})`);
  }
}
