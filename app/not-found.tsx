import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg rounded-xl border bg-white/70 p-8 text-center">
      <h1 className="text-3xl font-black" style={{ fontFamily: "var(--font-heading)" }}>
        Not found
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">The page you requested does not exist.</p>
      <Link className="mt-4 inline-block rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent" href="/dashboard">
        Go to dashboard
      </Link>
    </div>
  );
}
