import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const raffleId = url.searchParams.get("raffleId") ?? "";
  const [raffles, entries] = await Promise.all([
    prisma.raffle.findMany({ where: { shopDomain: session.shop }, orderBy: { createdAt: "desc" }, select: { id: true, title: true } }),
    prisma.entry.findMany({
      where: { raffle: { shopDomain: session.shop }, ...(raffleId ? { raffleId } : {}) },
      include: {
        raffle: { select: { title: true } },
        winner: { select: { id: true } },
        allocation: { select: { id: true, status: true, emailSentAt: true, notificationError: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);
  return { raffles, entries, raffleId };
};

export default function EntriesPage() {
  const { raffles, entries, raffleId } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Entries">
      <p className="page-subheading">{entries.length.toLocaleString()} most recent entries</p>
      <s-section>
        <form method="get" className="filter-row">
          <label>
            Filter by raffle
            <select name="raffleId" defaultValue={raffleId}>
              <option value="">All raffles</option>
              {raffles.map((raffle) => <option key={raffle.id} value={raffle.id}>{raffle.title}</option>)}
            </select>
          </label>
          <button className="admin-button" type="submit">Apply filter</button>
        </form>
      </s-section>
      <s-section heading="Customer entries">
        {entries.length ? (
          <div className="table-scroll">
            <table className="admin-table">
              <thead><tr><th>Customer</th><th>Email</th><th>Raffle</th><th>Entered</th><th>Draw</th><th>Notification</th><th>Retention coupon</th></tr></thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.name}</td>
                    <td>{entry.email}</td>
                    <td>{entry.raffle.title}</td>
                    <td>{new Date(entry.createdAt).toLocaleString()}</td>
                    <td>
                      <s-badge tone={entry.allocation || entry.winner ? "success" : "neutral"}>
                        {entry.allocation || entry.winner ? "Selected" : entry.drawRank ? "Waitlist" : "Entered"}
                      </s-badge>
                    </td>
                    <td>{entry.allocation
                      ? entry.allocation.emailSentAt
                        ? "Winner email sent"
                        : entry.allocation.notificationError
                          ? `Retry pending: ${entry.allocation.notificationError}`
                          : "Claim being prepared"
                      : entry.outcomeEmailError
                        ? `${entry.outcomeEmailSentAt ? "Result email sent" : "Retry pending"}: ${entry.outcomeEmailError}`
                        : entry.outcomeEmailSentAt
                          ? "Result email sent"
                          : "Pending"}</td>
                    <td>{entry.retentionCouponCode
                      ? entry.couponEmailSentAt
                        ? <code>{entry.retentionCouponCode}</code>
                        : "Coupon delivery pending"
                      : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="form-hint">Showing up to 500 entries · {entries.length} displayed</p>
          </div>
        ) : (
          <div className="empty-state"><p>Entries will appear here when customers sign up on your storefront.</p></div>
        )}
      </s-section>
    </s-page>
  );
}
