import { describe, expect, it } from "vitest";
import { type AssetKind, type Template } from "@prisma/client";
import { mapProjectToRenderProps, type RenderAsset } from "@/lib/render/props";
import { getTemplateDefinition } from "@/lib/template-catalog";

describe("mapProjectToRenderProps timeline integration", () => {
  it("includes asset manifest and parsed timeline state in input props", () => {
    const templateDefinition = getTemplateDefinition("green-screen-commentator");
    expect(templateDefinition).toBeDefined();

    const template = {
      id: "tmpl-1",
      slug: "green-screen-commentator",
      name: templateDefinition!.name,
      description: templateDefinition!.description,
      tags: templateDefinition!.tags,
      slotSchema: templateDefinition!.slotSchema,
      createdAt: new Date()
    } as Template;

    const baseAsset = {
      id: "asset-1",
      projectId: "project-1",
      slotKey: "background",
      kind: "IMAGE" as AssetKind,
      storageKey: "projects/project-1/background.png",
      mimeType: "image/png",
      durationSec: null,
      width: 1080,
      height: 1920,
      createdAt: new Date(),
      signedUrl: "https://example.com/background.png"
    } satisfies RenderAsset;

    const fgAsset = {
      ...baseAsset,
      id: "asset-2",
      slotKey: "foreground",
      kind: "VIDEO" as AssetKind,
      durationSec: 5.5,
      storageKey: "projects/project-1/foreground.mp4",
      mimeType: "video/mp4",
      signedUrl: "https://example.com/foreground.mp4"
    } satisfies RenderAsset;

    const configInput = {
      blurBackground: true,
      timelineStateJson: JSON.stringify({
        version: 2,
        fps: 30,
        resolution: { width: 1080, height: 1920 },
        exportPreset: "tiktok_9x16",
        tracks: [
          {
            id: "track-1",
            kind: "AUDIO",
            name: "Music",
            order: 0,
            muted: false,
            volume: 1,
            clips: [
              {
                id: "clip-1",
                slotKey: "library:sfx-boom",
                timelineInMs: 0,
                timelineOutMs: 1200,
                sourceInMs: 0,
                sourceOutMs: 1200,
                effects: []
              }
            ]
          }
        ],
        revisions: []
      })
    };

    const mapped = mapProjectToRenderProps(template, [baseAsset, fgAsset], configInput);

    expect(mapped.inputProps.assetManifest["asset-1"]?.slotKey).toBe("background");
    expect(mapped.inputProps.assetManifest["asset-2"]?.slotKey).toBe("foreground");
    expect(mapped.inputProps.timelineState?.version).toBe(2);
    expect(mapped.inputProps.timelineState?.tracks).toHaveLength(1);
  });
});
