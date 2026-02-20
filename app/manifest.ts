import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HookForge",
    short_name: "HookForge",
    description: "Template-driven short-form video creator",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#faf6ef",
    theme_color: "#f97316",
    icons: [
      {
        src: "/demo-assets/pattern-grid.svg",
        sizes: "192x192",
        type: "image/svg+xml"
      },
      {
        src: "/demo-assets/pattern-waves.svg",
        sizes: "512x512",
        type: "image/svg+xml"
      }
    ]
  };
}
