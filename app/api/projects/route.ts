import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDefaultConfigFromTemplate } from "@/lib/template-runtime";
import { routeErrorToResponse } from "@/lib/http";

const CreateProjectSchema = z.object({
  templateId: z.string().optional(),
  templateSlug: z.string().optional(),
  title: z.string().min(2).max(120).optional()
});

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projects = await prisma.project.findMany({
      where: {
        userId: user.id
      },
      include: {
        template: {
          select: {
            id: true,
            slug: true,
            name: true,
            slotSchema: true
          }
        }
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: 80
    });

    return NextResponse.json({ projects });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = CreateProjectSchema.parse(await request.json());

    if (!body.templateId && !body.templateSlug) {
      return NextResponse.json({ error: "templateId or templateSlug is required" }, { status: 400 });
    }

    const template = await prisma.template.findFirst({
      where: body.templateId ? { id: body.templateId } : { slug: body.templateSlug }
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const project = await prisma.project.create({
      data: {
        userId: user.id,
        templateId: template.id,
        title: body.title ?? `${template.name} Project`,
        status: "DRAFT",
        config: getDefaultConfigFromTemplate(template)
      },
      select: {
        id: true,
        title: true,
        templateId: true,
        status: true,
        createdAt: true
      }
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
