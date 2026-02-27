import { describe, expect, it } from "vitest";
import { routeErrorToResponse } from "@/lib/http";

describe("http route error mapping", () => {
  it("maps conflict errors to HTTP 409", async () => {
    const response = routeErrorToResponse(new Error("Conflict: Autopilot plan revision hash mismatch"));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("Conflict");
  });
});

