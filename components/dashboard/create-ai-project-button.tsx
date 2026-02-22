"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type CreateAiProjectButtonProps = {
  className?: string;
  label?: string;
};

export function CreateAiProjectButton({ className, label = "Start AI Editor" }: CreateAiProjectButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const onCreate = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/projects-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "FREEFORM" })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not create AI editor project");
      }

      router.push(payload.project.entrypointPath as string);
      router.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not create AI editor project");
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
