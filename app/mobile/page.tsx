import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function MobilePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-black" style={{ fontFamily: "var(--font-heading)" }}>
          Mobile Beta
        </h1>
        <p className="text-sm text-muted-foreground">
          Install HookForge as a mobile web app while native wrappers are in phased rollout.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>iOS Install</CardTitle>
            <CardDescription>Safari install path</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Open HookForge in Safari, tap Share, then choose Add to Home Screen.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Android Install</CardTitle>
            <CardDescription>Chrome install path</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Open HookForge in Chrome, open the browser menu, then tap Add to Home Screen.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mobile Top Workflows</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <Link href="/creator" className="underline">
              Creator Studio
            </Link>{" "}
            for script assist, teleprompter, and capture upload.
          </p>
          <p>
            <Link href="/dashboard" className="underline">
              Dashboard
            </Link>{" "}
            for templates, project edits, and cloud renders.
          </p>
          <p>
            <Link href="/launch" className="underline">
              Launch Console
            </Link>{" "}
            for billing, usage alerts, and collaboration controls.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
