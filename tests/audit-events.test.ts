import { describe, expect, it } from "vitest";
import { buildWorkspaceAuditEventInput } from "@/lib/workspace-audit";

describe("audit event payloads", () => {
  it("builds append-only audit payload with defaults", () => {
    const payload = buildWorkspaceAuditEventInput({
      workspaceId: "ws_123",
      actorUserId: "usr_123",
      action: "workspace_security_policy_update",
      targetType: "WorkspaceSecurityPolicy",
      targetId: "pol_123",
      details: {
        enforceSso: true
      }
    });

    expect(payload.workspaceId).toBe("ws_123");
    expect(payload.actorUserId).toBe("usr_123");
    expect(payload.action).toBe("workspace_security_policy_update");
    expect(payload.severity).toBe("INFO");
    expect(payload.metadata).toEqual({
      enforceSso: true
    });
  });
});
