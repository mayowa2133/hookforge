import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Phase5Lab } from "@/components/localization/phase5-lab";

export default async function LocalizationPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return <Phase5Lab />;
}
