import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { CreatorStudio } from "@/components/creator/creator-studio";

export default async function CreatorPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return <CreatorStudio />;
}
