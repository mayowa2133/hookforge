import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateProjectButton } from "@/components/dashboard/create-project-button";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTemplateSlotSchema } from "@/lib/template-runtime";

type PageProps = {
  params: { slug: string };
};

export default async function TemplateDetailPage({ params }: PageProps) {
  const [template, user] = await Promise.all([
    prisma.template.findUnique({ where: { slug: params.slug } }),
    getCurrentUser()
  ]);

  if (!template) {
    notFound();
  }

  const schema = parseTemplateSlotSchema(template.slotSchema);

  return (
    <div className="space-y-6">
      <section className="grid gap-6 rounded-2xl border bg-white/70 p-6 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {template.tags.map((tag) => (
              <Badge variant="secondary" key={tag}>{tag}</Badge>
            ))}
          </div>
          <h1 className="text-3xl font-black" style={{ fontFamily: "var(--font-heading)" }}>
            {template.name}
          </h1>
          <p className="text-muted-foreground">{template.description}</p>

          <div className="rounded-xl border bg-slate-950/95 p-4 text-sm text-slate-200">
            <p className="font-semibold text-orange-300">Compliance reminder</p>
            <p className="mt-2">
              Upload only assets you own or have permission to use. HookForge templates replicate structure, not copyrighted pixels.
            </p>
          </div>

          {user ? (
            <CreateProjectButton templateId={template.id} label="Use this template" />
          ) : (
            <Button asChild>
              <Link href="/login">Login to create project</Link>
            </Button>
          )}
        </div>
        <img src={schema.previewImage} alt={template.name} className="h-full min-h-[300px] w-full rounded-xl border object-cover" />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Required Slots</CardTitle>
            <CardDescription>Upload these assets in the project editor.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {schema.slots.map((slot) => (
                <li key={slot.key} className="rounded-md border p-3 text-sm">
                  <p className="font-semibold">
                    {slot.label} <span className="text-xs text-muted-foreground">({slot.key})</span>
                  </p>
                  <p className="text-muted-foreground">Allowed: {slot.kinds.join(", ")}</p>
                  {slot.minDurationSec ? (
                    <p className="text-muted-foreground">Minimum duration: {slot.minDurationSec}s</p>
                  ) : null}
                  {slot.helpText ? <p className="text-muted-foreground">{slot.helpText}</p> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recipe Card</CardTitle>
            <CardDescription>Simple filming instructions to replicate pacing.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="mb-2 font-semibold">Structure</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {schema.recipeCard.structure.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 font-semibold">Filming Tips</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {schema.recipeCard.filmingTips.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            {schema.recipeCard.caution.length > 0 ? (
              <div>
                <p className="mb-2 font-semibold">Caution</p>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {schema.recipeCard.caution.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
