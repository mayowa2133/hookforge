import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { parseTemplateSlotSchema } from "@/lib/template-runtime";

export default async function TemplatesPage() {
  const templates = await prisma.template.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-black" style={{ fontFamily: "var(--font-heading)" }}>
        Quick Start Templates
      </h1>
      <p className="text-sm text-muted-foreground">
        Start fast with structural blueprints, then continue editing in the full AI workflow.
      </p>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((template) => {
          const schema = parseTemplateSlotSchema(template.slotSchema);
          return (
            <Card key={template.id} className="overflow-hidden">
              <img src={schema.previewImage} alt={template.name} className="h-40 w-full object-cover" />
              <CardHeader>
                <CardTitle>{template.name}</CardTitle>
                <CardDescription>{template.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {template.tags.map((tag) => (
                    <Badge variant="secondary" key={tag}>{tag}</Badge>
                  ))}
                </div>
                <Link href={`/templates/${template.slug}`} className="block rounded-md border px-3 py-2 text-center text-sm font-medium hover:bg-accent">
                  View details
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
