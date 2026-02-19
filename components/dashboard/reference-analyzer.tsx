"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type AnalyzeResult = {
  metrics: {
    durationSec: number;
    sceneCutsEstimate: number;
    motionIntensity: "low" | "medium" | "high";
    textDensity: "low" | "medium" | "high";
  };
  bestTemplateSlug: string;
  reasoning: string[];
  recipeCard: {
    structure: string[];
    filmingTips: string[];
    caution: string[];
  };
  llmEnhancement?: {
    enabled: boolean;
    source: "mock" | "openai";
    summary: string;
  };
};

export function ReferenceAnalyzer() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);

  const onAnalyze = async () => {
    if (!file) return;

    setLoading(true);
    setError(null);

    const body = new FormData();
    body.append("reference", file);

    try {
      const response = await fetch("/api/recipe/analyze", {
        method: "POST",
        body
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Analysis failed");
      }
      setResult(payload);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reference Hook Analyzer</CardTitle>
        <CardDescription>
          Upload your own reference MP4 to infer structure and get a best-match template recommendation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
          Compliance: Upload only videos you own or are permitted to analyze. HookForge extracts pacing/structure only.
        </div>
        <div className="flex gap-3">
          <Input type="file" accept="video/mp4" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <Button onClick={onAnalyze} disabled={!file || loading}>
            {loading ? "Analyzing..." : "Analyze"}
          </Button>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {result ? (
          <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Best match: {result.bestTemplateSlug}</Badge>
              <Badge variant="secondary">Cuts: {result.metrics.sceneCutsEstimate}</Badge>
              <Badge variant="secondary">Motion: {result.metrics.motionIntensity}</Badge>
              <Badge variant="secondary">Text density: {result.metrics.textDensity}</Badge>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {result.reasoning.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="text-sm">
              <p className="font-medium">Suggested structure</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {result.recipeCard.structure.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            {result.llmEnhancement?.enabled ? (
              <p className="text-xs text-muted-foreground">LLM ({result.llmEnhancement.source}): {result.llmEnhancement.summary}</p>
            ) : null}
            <Link className="inline-block text-sm font-medium text-primary" href={`/templates/${result.bestTemplateSlug}`}>
              Open recommended template
            </Link>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
