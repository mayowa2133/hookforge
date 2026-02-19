import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { templateCatalog } from "@/lib/template-catalog";

export default function HomePage() {
  return (
    <div className="space-y-12">
      <section className="grid gap-8 rounded-2xl border bg-white/70 p-8 shadow-sm md:grid-cols-[1.3fr_1fr] md:items-center">
        <div className="space-y-5">
          <Badge className="w-fit">Production-minded MVP</Badge>
          <h1 className="text-4xl font-black leading-tight md:text-5xl" style={{ fontFamily: "var(--font-heading)" }}>
            Build high-retention short videos from proven hook structures.
          </h1>
          <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
            Pick a Popular Visual Hook template, upload your own assets, preview instantly, and render MP4 in the cloud.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/register">
                Start free <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/dashboard">Open dashboard</Link>
            </Button>
          </div>
        </div>
        <div className="rounded-2xl border bg-slate-950 p-5 text-slate-100">
          <p className="text-xs font-semibold uppercase tracking-widest text-orange-300">Compliance</p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
            <li>Upload only content you own or have permission to use.</li>
            <li>No scraping or ripping from TikTok, Instagram, YouTube, or other platforms.</li>
            <li>Templates are structural blueprints. HookForge does not replicate source pixels.</li>
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
          Popular Visual Hooks
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templateCatalog.map((template) => (
            <Card key={template.slug} className="overflow-hidden">
              <img src={template.slotSchema.previewImage} alt={template.name} className="h-40 w-full object-cover" />
              <CardHeader>
                <CardTitle>{template.name}</CardTitle>
                <CardDescription>{template.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {template.tags.map((tag) => (
                    <Badge variant="secondary" key={tag}>{tag}</Badge>
                  ))}
                </div>
                <Button asChild variant="outline" className="w-full">
                  <Link href={`/templates/${template.slug}`}>View template</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
