import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const raffles = await prisma.raffle.findMany({
    where: { shopDomain: session.shop },
    include: { _count: { select: { entries: true, winners: true } } },
    orderBy: { createdAt: "desc" },
  });
  return {
    raffles,
    totalEntries: raffles.reduce((sum, raffle) => sum + raffle._count.entries, 0),
    totalWinners: raffles.reduce((sum, raffle) => sum + raffle._count.winners, 0),
  };
};

export default function AnalyticsPage() {
  const { raffles, totalEntries, totalWinners } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Analytics">
      <p className="page-subheading">Entry and winner performance by raffle.</p>
      <s-section heading="Performance">
        <div className="metric-grid metric-grid--two">
          <div className="metric-card"><span>Total entries</span><strong>{totalEntries.toLocaleString()}</strong></div>
          <div className="metric-card"><span>Winners selected</span><strong>{totalWinners.toLocaleString()}</strong></div>
        </div>
      </s-section>
      <s-section heading="Raffle performance">
        {raffles.length ? (
          <div className="table-scroll">
            <table className="admin-table">
              <thead><tr><th>Raffle</th><th>Prize</th><th>Opens</th><th>Deadline</th><th>Entries</th><th>Winners</th><th>Entry-to-winner rate</th><th>Status</th></tr></thead>
              <tbody>
                {raffles.map((raffle) => (
                  <tr key={raffle.id}>
                    <td>{raffle.title}</td>
                    <td>{raffle.productTitle}</td>
                    <td>{new Date(raffle.startsAt).toLocaleString()}</td>
                    <td>{new Date(raffle.closesAt).toLocaleString()}</td>
                    <td>{raffle._count.entries}</td>
                    <td>{raffle._count.winners}</td>
                    <td>{raffle._count.entries ? `${((raffle._count.winners / raffle._count.entries) * 100).toFixed(1)}%` : "—"}</td>
                    <td><s-badge tone={raffle.status === "ACTIVE" ? "success" : "neutral"}>{raffle.status.toLowerCase()}</s-badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty-state"><p>Create your first raffle to start seeing analytics.</p></div>}
      </s-section>
    </s-page>
  );
}
