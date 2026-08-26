import { Button } from "../../components/ui";
import { SiteHeader } from "../../components/layout/SiteHeader";

export function NotFoundPage() {
  return (
    <main className="app-shell">
      <SiteHeader />
      <section className="not-found-page">
        <span>404</span>
        <h1>Tool not found.</h1>
        <p>This local tool address does not exist.</p>
        <Button onClick={() => window.location.assign("/")}>View all tools</Button>
      </section>
    </main>
  );
}
