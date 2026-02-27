import type { ProviderAdapter, ProviderCapability, ProviderRequest, ProviderResponse } from "./types";

export function createMockProvider<C extends ProviderCapability>(
  name: string,
  capability: C,
  configured: boolean
): ProviderAdapter<C> {
  return {
    name,
    capability,
    configured,
    isMock: true,
    supportsOperations: ["*"],
    async run(request: ProviderRequest): Promise<ProviderResponse> {
      return {
        providerName: name,
        model: `${capability}-mock-v1`,
        output: {
          operation: request.operation,
          accepted: true,
          echo: request.payload,
          note: configured
            ? "Provider configured; this scaffold currently returns deterministic mock output."
            : "Provider key missing; deterministic mock output returned."
        },
        usage: {
          tokensIn: 25,
          tokensOut: 65,
          durationMs: 120,
          costUsd: configured ? 0.0025 : 0
        }
      };
    }
  };
}
