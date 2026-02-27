import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDeepgramAsrAdapter,
  createOpenAiTranslationAdapter
} from "@/lib/providers/runtime-adapters";

type Fixture = {
  request: {
    operation: string;
    payload: Record<string, unknown>;
  };
  response: Record<string, unknown>;
};

function readFixture(name: string): Fixture {
  const raw = readFileSync(resolve(process.cwd(), `tests/fixtures/providers/${name}`), "utf8");
  return JSON.parse(raw) as Fixture;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("provider runtime adapters", () => {
  it("runs deepgram adapter with golden fixture and captures usage telemetry", async () => {
    const fixture = readFixture("deepgram-transcribe.json");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixture.response), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createDeepgramAsrAdapter({
      apiKey: "dg_test_key",
      baseUrl: "https://api.deepgram.test/v1/listen",
      timeoutMs: 3000
    });

    const response = await adapter.run({
      operation: fixture.request.operation,
      payload: fixture.request.payload
    });

    expect(adapter.isMock).toBe(false);
    expect(adapter.configured).toBe(true);
    expect(response.providerName).toBe("deepgram");
    expect(response.output.results).toBeDefined();
    expect(response.usage?.durationMs).toBeGreaterThan(0);
    expect(response.usage?.tokensOut).toBeGreaterThan(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe("POST");
    expect(options.headers).toMatchObject({
      Authorization: "Token dg_test_key"
    });
  });

  it("runs openai translation adapter unconfigured fallback deterministically", async () => {
    const fixture = readFixture("openai-translation.json");
    const adapter = createOpenAiTranslationAdapter({
      apiKey: "",
      timeoutMs: 3000
    });

    const response = await adapter.run({
      operation: fixture.request.operation,
      payload: fixture.request.payload
    });

    expect(adapter.configured).toBe(false);
    expect(response.providerName).toBe("llm-translation");
    expect(response.output.synthetic).toBe(true);
    expect(response.output.targetLanguage).toBe("es");
    expect(response.usage?.costUsd).toBe(0);
  });

  it("throws on non-2xx provider response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "bad request" }), {
        status: 400,
        headers: {
          "content-type": "application/json"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createDeepgramAsrAdapter({
      apiKey: "dg_test_key",
      baseUrl: "https://api.deepgram.test/v1/listen",
      timeoutMs: 3000
    });

    await expect(
      adapter.run({
        operation: "TRANSCRIBE",
        payload: {
          language: "en",
          durationMs: 4000
        }
      })
    ).rejects.toThrow("Provider HTTP 400");
  });
});

