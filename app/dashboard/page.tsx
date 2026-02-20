import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateProjectButton } from "@/components/dashboard/create-project-button";
import { ReferenceAnalyzer } from "@/components/dashboard/reference-analyzer";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTemplateSlotSchema } from "@/lib/template-runtime";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [templates, projects] = await Promise.all([
    prisma.template.findMany({
      orderBy: { createdAt: "asc" }
    }),
    prisma.project.findMany({
      where: { userId: user.id },
      include: {
        template: true,
        renderJobs: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      },
      orderBy: { updatedAt: "desc" }
    })
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-black" style={{ fontFamily: "var(--font-heading)" }}>
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">Build with structure-first templates and cloud renders.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Need script-to-video, teleprompter, or camera capture?{" "}
          <Link href="/creator" className="underline">
            Open Creator Studio
          </Link>
          . Need ads, shorts, Reddit workflows, and compliance controls?{" "}
          <Link href="/growth" className="underline">
            Open Growth Lab
          </Link>
          .
        </p>
      </div>

      <ReferenceAnalyzer />

      <section className="space-y-3">
        <h2 className="text-xl font-bold">Popular Choices</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => {
            const schema = parseTemplateSlotSchema(template.slotSchema);
            return (
              <Card key={template.id}>
                <CardHeader>
                  <CardTitle>{template.name}</CardTitle>
                  <CardDescription>{template.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <img src={schema.previewImage} alt={template.name} className="h-36 w-full rounded-md object-cover" />
                  <div>
                    <p className="text-xs uppercase text-muted-foreground">Required inputs</p>
                    <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                      {schema.slots
                        .filter((slot) => slot.required)
                        .map((slot) => (
                          <li key={slot.key}>{slot.label}</li>
                        ))}
                    </ul>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {template.tags.map((tag) => (
                      <Badge variant="secondary" key={tag}>{tag}</Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <CreateProjectButton templateId={template.id} className="flex-1" />
                    <Link className="flex-1 rounded-md border px-3 py-2 text-center text-sm font-medium hover:bg-accent" href={`/templates/${template.slug}`}>
                      Details
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">Your projects</h2>
        {projects.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No projects yet. Create one from a template above.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Card key={project.id}>
                <CardHeader>
                  <CardTitle className="text-lg">{project.title}</CardTitle>
                  <CardDescription>{project.template.name}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span>Status</span>
                    <Badge>{project.status}</Badge>
                  </div>
                  {project.renderJobs[0] ? (
                    <p className="text-xs text-muted-foreground">
                      Last render: {project.renderJobs[0].status} ({project.renderJobs[0].progress}%)
                    </p>
                  ) : null}
                  <Link
                    href={`/projects/${project.id}`}
                    className="block rounded-md border px-3 py-2 text-center text-sm font-medium hover:bg-accent"
                  >
                    Open editor
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
