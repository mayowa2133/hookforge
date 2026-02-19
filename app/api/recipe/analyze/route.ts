import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { analyzeReferenceHook } from "@/lib/recipe/analyze";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("reference");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "reference file is required" }, { status: 400 });
  }

  const isMp4 = file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
  if (!isMp4) {
    return NextResponse.json({ error: "reference must be an MP4 video" }, { status: 400 });
  }

  const maxBytes = Math.min(env.MAX_UPLOAD_MB, 120) * 1024 * 1024;
  if (file.size > maxBytes) {
    return NextResponse.json({ error: "reference file is too large" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filePath = join(tmpdir(), `${randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`);
  await writeFile(filePath, buffer);

  try {
    const result = await analyzeReferenceHook(filePath);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not analyze reference hook";
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    await unlink(filePath).catch(() => undefined);
  }
}
