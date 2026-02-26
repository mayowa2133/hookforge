"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type CreateRecordingProjectButtonProps = {
  className?: string;
  label?: string;
};

function withRecordingHint(path: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}recording=1`;
}

export function CreateRecordingProjectButton({
  className,
  label = "New Recording"
}: CreateRecordingProjectButtonProps) {
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
        throw new Error(payload.error ?? "Could not create recording project");
      }

      const entrypoint = String(payload.project.entrypointPath ?? "");
      if (!entrypoint) {
        throw new Error("Project entrypoint is missing");
      }
      router.push(withRecordingHint(entrypoint));
      router.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not create recording project");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button className={className} onClick={onCreate} disabled={loading} variant="secondary">
      {loading ? "Creating..." : label}
    </Button>
  );
}
