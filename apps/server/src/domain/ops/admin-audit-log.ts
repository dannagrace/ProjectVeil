import type { AdminAuditLogCreateInput, AdminAuditLogRecord } from "@server/persistence";

export interface AdminAuditWritableStore {
  appendAdminAuditLog?(input: AdminAuditLogCreateInput): Promise<AdminAuditLogRecord>;
}

type RequiredAdminAuditWritableStore = Required<AdminAuditWritableStore>;

export function hasAdminAuditStore(store: AdminAuditWritableStore | null | undefined): store is RequiredAdminAuditWritableStore {
  return Boolean(store?.appendAdminAuditLog);
}

export async function appendAdminAuditLogIfAvailable(
  store: AdminAuditWritableStore | null | undefined,
  input: AdminAuditLogCreateInput
): Promise<AdminAuditLogRecord | null> {
  if (!hasAdminAuditStore(store)) {
    return null;
  }
  return store.appendAdminAuditLog(input);
}
