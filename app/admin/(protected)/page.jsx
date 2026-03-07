export default function AdminDashboard() {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h1 className="text-xl font-semibold">Admin dashboard</h1>
        <p className="mt-2 text-sm text-[var(--admin-muted)]">
          Use this portal to manage brand assets, login page content, and other settings currently embedded in code.
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h2 className="text-lg font-semibold">Quick start</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[var(--admin-text)]">
          <li>Open Settings and update logo / backgrounds / brand color.</li>
          <li>Create more admins in Admins.</li>
          <li>Refresh the main site to see changes.</li>
        </ol>
      </div>
    </div>
  );
}
