"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type CreateProjectButtonProps = {
  templateId?: string;
  templateSlug?: string;
  label?: string;
  className?: string;
};

export function CreateProjectButton({ templateId, templateSlug, label = "Create project", className }: CreateProjectButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const onCreate = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, templateSlug })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not create project");
      }
      router.push(`/projects/${payload.project.id}`);
      router.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not create project");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button className={className} onClick={onCreate} disabled={loading}>
      {loading ? "Creating..." : label}
    </Button>
  );
}
