import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { ThemeAppBlockOnboarding } from "../components/theme-app-block-onboarding";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopHandle = session.shop.replace(/\.myshopify\.com$/i, "");
  const now = new Date();
  const [raffles, entries, winners, activeRaffles, editableRaffles, recent] = await Promise.all([
    prisma.raffle.count({ where: { shopDomain: session.shop } }),
    prisma.entry.count({ where: { raffle: { shopDomain: session.shop } } }),
    prisma.winner.count({ where: { raffle: { shopDomain: session.shop } } }),
    prisma.raffle.count({
      where: {
        shopDomain: session.shop,
        status: "ACTIVE",
        startsAt: { lte: now },
        closesAt: { gt: now },
      },
    }),
    prisma.raffle.findMany({
      where: { shopDomain: session.shop, status: "ACTIVE" },
      orderBy: { closesAt: "asc" },
      include: { _count: { select: { entries: true } } },
    }),
    prisma.raffle.findMany({
      where: { shopDomain: session.shop },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { _count: { select: { entries: true, winners: true } } },
    }),
  ]);
  return { metrics: { raffles, entries, winners, activeRaffles }, editableRaffles, recent, shopHandle };
};

export default function Dashboard() {
  const { metrics, editableRaffles, recent, shopHandle } = useLoaderData<typeof loader>();
  const now = new Date();
  const activeIds = new Set(editableRaffles.map((raffle) => raffle.id));
  const dashboardRaffles = [
    ...editableRaffles,
    ...recent.filter((raffle) => !activeIds.has(raffle.id)),
  ].slice(0, 8);
  return (
    <s-page heading="Raffle dashboard">
      <s-button slot="primary-action" href="/app/raffles/new" variant="primary">Create raffle</s-button>
      <p className="page-subheading">A clear view of your raffles, entries, and winners.</p>
      <s-section heading="Set up your storefront">
        <ThemeAppBlockOnboarding shopHandle={shopHandle} />
      </s-section>
      <s-section heading="Overview">
        <div className="metric-grid">
          <Metric label="Total entries" value={metrics.entries} detail="Across all raffles" />
          <Metric label="Active raffles" value={metrics.activeRaffles} detail="Accepting entries" />
          <Metric label="Winners selected" value={metrics.winners} detail="Prize orders created" />
          <Metric label="Raffles created" value={metrics.raffles} detail="Lifetime total" />
        </div>
      </s-section>
      <s-section heading="Your raffles">
        {dashboardRaffles.length ? (
          <div className="raffle-list">
            {dashboardRaffles.map((raffle) => (
              <div className="raffle-list__row" key={raffle.id}>
                <div>
                  <strong>{raffle.title}</strong>
                  <p>{raffle.productTitle} · {raffle._count.entries.toLocaleString()} {raffle._count.entries === 1 ? "entry" : "entries"}</p>
                </div>
                <div className="row-actions">
                  <RaffleStatus raffle={raffle} now={now} />
                  <Link to={`/app/entries?raffleId=${raffle.id}`}>View entries</Link>
                  {raffle.status === "ACTIVE" && <Link to={`/app/raffles/${raffle.id}/edit`}>Edit raffle</Link>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>Your first raffle is a few clicks away.</p>
            <Link className="admin-button admin-button--primary" to="/app/raffles/new">Create a raffle</Link>
          </div>
        )}
      </s-section>
      <s-section heading="How Fairdrop works">
        <p className="section-copy">Customers enter through your storefront. When a raffle closes, draw winners from the Winners page and track their claim status here.</p>
      </s-section>
    </s-page>
  );
}

function RaffleStatus({
  raffle,
  now,
}: {
  raffle: { status: string; startsAt: Date; closesAt: Date };
  now: Date;
}) {
  if (raffle.status !== "ACTIVE") {
    return <s-badge tone="neutral">{raffle.status.toLowerCase()}</s-badge>;
  }
  if (raffle.startsAt > now) return <s-badge tone="warning">scheduled</s-badge>;
  if (raffle.closesAt <= now) return <s-badge tone="neutral">closed</s-badge>;
  return <s-badge tone="success">accepting entries</s-badge>;
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
      <small>{detail}</small>
    </div>
  );
}
