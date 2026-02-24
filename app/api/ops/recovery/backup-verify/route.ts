import { randomUUID } from "crypto";
import { z } from "zod";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withRedis } from "@/lib/redis";
import { getUploadPresignedUrl } from "@/lib/storage";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

const VerifySchema = z.object({
  includeStorageProbe: z.boolean().default(true)
});

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireWorkspaceCapability({
      capability: "workspace.security.write",
      request
    });
    const body = VerifySchema.parse(await request.json().catch(() => ({})));

    const checks: Array<{ name: string; status: "PASS" | "FAIL"; detail?: string }> = [];

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.push({ name: "database", status: "PASS" });
    } catch (error) {
      checks.push({
        name: "database",
        status: "FAIL",
        detail: error instanceof Error ? error.message : "query failed"
      });
    }

    try {
      const redisKey = `ops:backup-verify:${workspace.id}:${randomUUID()}`;
      await withRedis(async (client) => {
        await client.set(redisKey, "ok", "EX", 30);
        const echoed = await client.get(redisKey);
        if (echoed !== "ok") {
          throw new Error("Redis echo mismatch");
        }
      });
      checks.push({ name: "redis", status: "PASS" });
    } catch (error) {
      checks.push({
        name: "redis",
        status: "FAIL",
        detail: error instanceof Error ? error.message : "redis check failed"
      });
    }

    if (body.includeStorageProbe) {
      try {
        const probeKey = `ops/backup-verify/${workspace.id}/${Date.now()}-${randomUUID()}.txt`;
        await getUploadPresignedUrl(probeKey, "text/plain", 60);
        checks.push({ name: "object_storage_presign", status: "PASS" });
      } catch (error) {
        checks.push({
          name: "object_storage_presign",
          status: "FAIL",
          detail: error instanceof Error ? error.message : "storage probe failed"
        });
      }
    }

    const passed = checks.every((entry) => entry.status === "PASS");

    const incident = await prisma.systemIncident.create({
      data: {
        workspaceId: workspace.id,
        category: "backup-verify",
        severity: passed ? "INFO" : "HIGH",
        status: passed ? "RESOLVED" : "OPEN",
        summary: passed ? "Backup verification checks passed" : "Backup verification checks failed",
        metadata: {
          checks
        },
        resolvedAt: passed ? new Date() : null,
        resolvedByUserId: passed ? user.id : null
      }
    });

    await recordWorkspaceAuditEvent({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "ops_backup_verify",
      targetType: "SystemIncident",
      targetId: incident.id,
      details: {
        passed,
        checks
      }
    });

    return jsonOk({
      workspaceId: workspace.id,
      passed,
      checks,
      incident: {
        id: incident.id,
        status: incident.status,
        severity: incident.severity,
        createdAt: incident.createdAt
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
