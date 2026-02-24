import { describe, expect, it } from "vitest";
import { hasWorkspaceCapability } from "@/lib/workspace-roles";

describe("enterprise auth guards", () => {
  it("allows owner/admin billing manage capability", () => {
    expect(hasWorkspaceCapability("OWNER", "billing.manage")).toBe(true);
    expect(hasWorkspaceCapability("ADMIN", "billing.manage")).toBe(true);
  });

  it("denies viewer/editor privileged capabilities", () => {
    expect(hasWorkspaceCapability("EDITOR", "workspace.security.write")).toBe(false);
    expect(hasWorkspaceCapability("VIEWER", "workspace.members.write")).toBe(false);
    expect(hasWorkspaceCapability("VIEWER", "ops.read")).toBe(false);
  });

  it("keeps project read access across roles", () => {
    expect(hasWorkspaceCapability("OWNER", "workspace.projects.read")).toBe(true);
    expect(hasWorkspaceCapability("ADMIN", "workspace.projects.read")).toBe(true);
    expect(hasWorkspaceCapability("EDITOR", "workspace.projects.read")).toBe(true);
    expect(hasWorkspaceCapability("VIEWER", "workspace.projects.read")).toBe(true);
  });
});
