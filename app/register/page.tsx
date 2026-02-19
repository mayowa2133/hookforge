import Link from "next/link";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth/register-form";
import { getCurrentUser } from "@/lib/auth";

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-4">
      <RegisterForm />
      <p className="text-center text-sm text-muted-foreground">
        Already have an account? <Link className="font-medium text-primary" href="/login">Login</Link>
      </p>
    </div>
  );
}
