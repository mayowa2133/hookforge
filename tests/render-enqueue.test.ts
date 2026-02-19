import { describe, expect, it, vi } from "vitest";
import { ProjectStatus } from "@prisma/client";
import { createAndEnqueueRenderJob } from "../lib/render/enqueue";

describe("createAndEnqueueRenderJob", () => {
  it("creates and enqueues a render job for READY projects", async () => {
    const add = vi.fn(async () => ({ id: "queue-job" }));

    const db = {
      project: {
        findFirst: vi.fn(async () => ({ id: "project_1", status: ProjectStatus.READY })),
        update: vi.fn(async () => ({ id: "project_1", status: ProjectStatus.RENDERING }))
      },
      renderJob: {
        create: vi.fn(async () => ({ id: "render_1", projectId: "project_1", status: "QUEUED", progress: 0 }))
      }
    };

    const renderJob = await createAndEnqueueRenderJob({
      projectId: "project_1",
      userId: "user_1",
      db: db as never,
      queue: { add }
    });

    expect(db.project.findFirst).toHaveBeenCalledWith({
      where: { id: "project_1", userId: "user_1" },
      select: { id: true, status: true }
    });
    expect(db.renderJob.create).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith("render", { renderJobId: "render_1" });
    expect(db.project.update).toHaveBeenCalledWith({
      where: { id: "project_1" },
      data: { status: ProjectStatus.RENDERING }
    });
    expect(renderJob.id).toBe("render_1");
  });

  it("throws when project is not ready", async () => {
    const db = {
      project: {
        findFirst: vi.fn(async () => ({ id: "project_1", status: ProjectStatus.DRAFT })),
        update: vi.fn()
      },
      renderJob: {
        create: vi.fn()
      }
    };

    await expect(
      createAndEnqueueRenderJob({
        projectId: "project_1",
        userId: "user_1",
        db: db as never,
        queue: { add: vi.fn(async () => ({})) }
      })
    ).rejects.toThrow("Project is not ready for rendering");
  });
});
