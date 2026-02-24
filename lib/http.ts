import { ZodError } from "zod";
import { NextResponse } from "next/server";

export function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function routeErrorToResponse(error: unknown) {
  if (error instanceof ZodError) {
    return jsonError("Validation failed", 400, error.flatten());
  }
  if (error instanceof Error) {
    const message = error.message || "Unexpected error";
    const normalized = message.toLowerCase();

    if (message === "UNAUTHORIZED" || normalized.includes("unauthorized")) {
      return jsonError("Unauthorized", 401);
    }
    if (normalized.includes("rate limit")) {
      return jsonError(message, 429);
    }
    if (normalized.includes("insufficient credits")) {
      return jsonError(message, 402);
    }
    if (normalized.includes("scope denied")) {
      return jsonError(message, 403);
    }
    if (normalized.includes("disabled")) {
      return jsonError(message, 403);
    }
    if (normalized.includes("not found")) {
      return jsonError(message, 404);
    }
    return jsonError(message, 400);
  }
  return jsonError("Unexpected error", 500);
}
