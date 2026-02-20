import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Phase4Lab } from "@/components/growth/phase4-lab";

export default async function GrowthPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return <Phase4Lab />;
}
