import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Phase6Launchpad } from "@/components/launch/phase6-launchpad";

export default async function LaunchPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return <Phase6Launchpad />;
}
