import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data as routerData, Form, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import {
  createPendingAllocation,
  issuePendingAllocation,
  prepareManualWinnerClaim,
  sendFreshClaim,
  startExpirySafetySweeper,
} from "../lib/allocation-lifecycle.server";
import { pickRandom, pickRaffleWinners } from "../lib/raffles.server";
import { completeRaffleIfSettled } from "../lib/raffle-completion.server";
import { ensureCompletedRafflePurgeScheduled } from "../lib/qstash.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [raffles, allocations] = await Promise.all([
    prisma.raffle.findMany({
      where: { shopDomain: session.shop },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        winnerCount: true,
        allowMultipleWinnersPerAddress: true,
        unsoldCount: true,
        claimWindowMinutes: true,
      },
    }),
    prisma.allocation.findMany({
      where: { raffle: { shopDomain: session.shop } },
      include: {
        entry: { select: { name: true, email: true } },
        raffle: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    raffles,
    allocations,
    automaticEmailConfigured: Boolean(process.env.MAIL_FROM && process.env.RESEND_API_KEY),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const data = await request.formData();
  const intent = String(data.get("intent") ?? "");

  if (intent === "draw") {
    try {
      await startExpirySafetySweeper();
    } catch (error) {
      return { error: error instanceof Error ? error.message : "QStash expiry scheduling is unavailable." };
    }
    const raffleId = String(data.get("raffleId") ?? "");
    const raffle = await prisma.raffle.findFirst({
      where: { id: raffleId, shopDomain: session.shop },
      include: { shop: true },
    });
    if (!raffle || raffle.status === "CANCELLED" || raffle.status === "COMPLETED") {
      return { error: "Choose an eligible raffle." };
    }
    const now = new Date();
    if (raffle.startsAt > now) return { error: "This raffle has not started yet." };
    if (raffle.closesAt > now) return { error: "This raffle is still accepting entries and cannot be drawn yet." };

    let stagedIds: string[] = [];
    if (raffle.status === "ACTIVE") {
      const entries = await prisma.entry.findMany({
        where: {
          raffleId,
          winner: null,
          allocation: null,
          customerId: { not: null },
        },
        select: { id: true, customerId: true, addressHash: true },
      });
      const shuffled = pickRandom(entries, entries.length);
      const selections = pickRaffleWinners(shuffled, raffle.winnerCount, raffle.allowMultipleWinnersPerAddress);
      const deadlineAt = new Date(Date.now() + raffle.claimWindowMinutes * 60 * 1000);
      const drawResult = await prisma.$transaction(async (tx) => {
        const transitioned = await tx.raffle.updateMany({
          where: { id: raffleId, shopDomain: session.shop, status: "ACTIVE", closesAt: { lte: new Date() } },
          data: { status: "DRAWN" },
        });
        if (!transitioned.count) return { ids: [] as string[], purgeAt: null as Date | null };
        for (let index = 0; index < shuffled.length; index += 1) {
          await tx.entry.update({
            where: { id: shuffled[index].id },
            data: { drawRank: index + 1 },
          });
        }
        const staged = [];
        for (const entry of selections) {
          if (!entry.customerId) continue;
          const allocation = await createPendingAllocation(tx, {
            raffleId,
            entryId: entry.id,
            customerGid: `gid://shopify/Customer/${entry.customerId}`,
            deadlineAt,
          });
          staged.push(allocation.id);
        }
        if (staged.length < raffle.winnerCount) {
          await tx.raffle.update({
            where: { id: raffleId },
            data: { unsoldCount: raffle.winnerCount - staged.length },
          });
        }
        const purgeAt = staged.length ? null : await completeRaffleIfSettled(tx, raffleId);
        return { ids: staged, purgeAt };
      });
      stagedIds = drawResult.ids;
      if (drawResult.purgeAt) {
        try {
          await ensureCompletedRafflePurgeScheduled(raffleId);
        } catch (error) {
          console.error("Fairdrop completed raffle purge scheduling failed.", error);
          return { error: "The draw completed, but raffle-data purge scheduling failed. The expiry sweeper will retry." };
        }
      }
    } else {
      stagedIds = (await prisma.allocation.findMany({
        where: { raffleId, status: "PENDING" },
        select: { id: true },
      })).map((allocation) => allocation.id);
    }
    if (!stagedIds.length && raffle.status === "ACTIVE") {
      stagedIds = (await prisma.allocation.findMany({
        where: { raffleId, status: "PENDING" },
        select: { id: true },
      })).map((allocation) => allocation.id);
    }
    if (!stagedIds.length) return { message: "No winner allocations need issuing. The draw has already been started." };

    const outcomes = [];
    for (const allocationId of stagedIds) {
      outcomes.push(await issuePendingAllocation(allocationId, admin));
    }
    const issued = outcomes.filter((outcome) => outcome.kind === "issued").length;
    const emailFailures = outcomes.filter((outcome) => outcome.kind === "emailFailed").length;
    return {
      message: `${stagedIds.length} winner allocation${stagedIds.length === 1 ? "" : "s"} staged; ${issued} emails sent${emailFailures ? `, ${emailFailures} email failures. Use “Prepare manual email” on any winner who needs a manual notification.` : "."}`,
    };
  }

  if (intent === "prepareManual") {
    const allocationId = String(data.get("allocationId") ?? "");
    const allocation = await prisma.allocation.findFirst({
      where: { id: allocationId, raffle: { shopDomain: session.shop } },
      include: { entry: true, raffle: { include: { shop: true } } },
    });
    if (!allocation) return { error: "Winner allocation not found." };
    try {
      const manualEmail = await prepareManualWinnerClaim(allocation);
      return routerData(
        { manualEmail },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Could not prepare the manual winner email." };
    }
  }

  if (intent === "manualSent") {
    const allocationId = String(data.get("allocationId") ?? "");
    const allocation = await prisma.allocation.findFirst({
      where: {
        id: allocationId,
        raffle: { shopDomain: session.shop },
        status: "ISSUED",
        deadlineAt: { gt: new Date() },
      },
      select: { id: true, deadlineAt: true },
    });
    if (!allocation) return { error: "This winner claim is no longer available." };
    const updated = await prisma.allocation.updateMany({
      where: { id: allocation.id, status: "ISSUED", deadlineAt: { gt: new Date() } },
      data: { emailSentAt: new Date(), notificationError: null },
    });
    if (!updated.count) return { error: "This winner claim is no longer available." };
    return { message: "Marked the winner email as sent." };
  }

  if (intent === "resend") {
    if (!process.env.MAIL_FROM || !process.env.RESEND_API_KEY) {
      return { error: "Automatic email is not configured. Use “Prepare manual email” to send from your own email account." };
    }
    const allocationId = String(data.get("allocationId") ?? "");
    const allocation = await prisma.allocation.findFirst({
      where: { id: allocationId, raffle: { shopDomain: session.shop } },
      include: { entry: true, raffle: { include: { shop: true } } },
    });
    if (!allocation) return { error: "Winner allocation not found." };
    if (
      allocation.deadlineAt <= new Date() ||
      !allocation.draftOrderId ||
      !allocation.invoiceUrl ||
      allocation.status === "PURCHASED" ||
      allocation.status === "CANCELLED" ||
      allocation.status === "EXPIRED"
    ) {
      return { error: "This winner claim is no longer available." };
    }
    try {
      await sendFreshClaim(allocation);
      return { message: `Claim email sent to ${allocation.entry.email}.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Winner email delivery failed.";
      await prisma.allocation.update({
        where: { id: allocation.id },
        data: { notificationError: message },
      });
      return { error: message };
    }
  }
  return { error: "Unsupported action." };
};

export default function WinnersPage() {
  const { raffles, allocations, automaticEmailConfigured } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const allocationCounts = allocations.reduce<Record<string, number>>((counts, allocation) => {
    counts[allocation.status] = (counts[allocation.status] ?? 0) + 1;
    return counts;
  }, {});
  return (
    <s-page heading="Winners">
      <p className="page-subheading">Issue reserved-price claim links and review allocation status.</p>
      <s-section heading="Draw raffle winners">
        <p className="form-hint">Fairdrop automatically draws winners after the entry deadline. If automatic email is configured, entrants are notified by email; otherwise, prepare each winner’s secure claim email here and send it from your own email account.</p>
        <Form method="post" className="admin-form">
          <input type="hidden" name="intent" value="draw" />
          {result && "error" in result && <div className="notice notice--error" role="alert">{result.error}</div>}
          {result && "message" in result && <div className="notice notice--success" role="status">{result.message}</div>}
          <label>
            Raffle
            <select name="raffleId" required defaultValue="">
              <option value="" disabled>Select a raffle</option>
              {raffles.filter((raffle) => raffle.status !== "CANCELLED" && raffle.status !== "COMPLETED").map((raffle) => <option key={raffle.id} value={raffle.id}>{raffle.title} · {raffle.status.toLowerCase()} · {raffle.claimWindowMinutes % 60 === 0 ? `${raffle.claimWindowMinutes / 60} hr` : `${raffle.claimWindowMinutes} min`} claim window</option>)}
            </select>
          </label>
          <p className="form-hint">Each draft order reserves one MSRP variant until the raffle’s claim deadline. Expired claims automatically promote the next ranked eligible entrant. The email contains an account-bound claim link, never the invoice URL.</p>
          <p className="form-hint">QStash must be configured for scheduled winner draws and claim expiry. Resend is optional if you send winner emails manually.</p>
          <button className="admin-button admin-button--primary" type="submit">Draw winners</button>
        </Form>
      </s-section>
      {result && "manualEmail" in result && result.manualEmail && (
        <s-section heading="Manual winner email">
          <div className="notice notice--warning" role="status">{result.manualEmail.warning}</div>
          <p><strong>To:</strong> {result.manualEmail.to}</p>
          <p><strong>Subject:</strong> {result.manualEmail.subject}</p>
          <label className="manual-email__label">
            Email message
            <textarea className="manual-email__body" readOnly rows={12} value={result.manualEmail.text} />
          </label>
          <div className="manual-email__actions">
            <button
              className="admin-button admin-button--primary"
              type="button"
              onClick={async (event) => {
                const button = event.currentTarget;
                try {
                  await navigator.clipboard.writeText(
                    `To: ${result.manualEmail.to}\nSubject: ${result.manualEmail.subject}\n\n${result.manualEmail.text}`,
                  );
                  button.textContent = "Copied email";
                } catch {
                  button.textContent = "Select and copy the email text";
                }
              }}
            >
              Copy email
            </button>
            <Form method="post">
              <input type="hidden" name="intent" value="manualSent" />
              <input type="hidden" name="allocationId" value={result.manualEmail.allocationId} />
              <button className="admin-button" type="submit">I sent this email</button>
            </Form>
          </div>
        </s-section>
      )}
      <s-section heading="Winner allocations">
        <div className="form-hint" aria-label="Allocation status summary">
          {Object.entries(allocationCounts).map(([status, count]) => `${status.toLowerCase()}: ${count}`).join(" · ") || "No allocations yet"}
        </div>
        {raffles.some((raffle) => raffle.unsoldCount > 0) && (
          <div className="form-hint">
            {raffles.filter((raffle) => raffle.unsoldCount > 0).map((raffle) => `${raffle.title}: ${raffle.unsoldCount} unsold`).join(" · ")}
          </div>
        )}
        {allocations.length ? (
          <div className="table-scroll">
            <table className="admin-table">
              <thead><tr><th>Winner</th><th>Email</th><th>Raffle</th><th>Claim deadline</th><th>Status</th><th>Email status</th><th>Action</th></tr></thead>
              <tbody>
                {allocations.map((allocation) => {
                  const status = allocation.deadlineAt <= new Date() && ["ISSUED", "OPENED"].includes(allocation.status)
                    ? "EXPIRED"
                    : allocation.status;
                  const canResend = ["ISSUED", "OPENED"].includes(allocation.status) && allocation.deadlineAt > new Date();
                  const tone = status === "PURCHASED" ? "success" : status === "CANCELLED" || status === "EXPIRED" ? "critical" : "warning";
                  return (
                    <tr key={allocation.id}>
                      <td>{allocation.entry.name}</td>
                      <td>{allocation.entry.email}</td>
                      <td>{allocation.raffle.title}</td>
                      <td>{new Date(allocation.deadlineAt).toLocaleString()}</td>
                      <td><s-badge tone={tone}>{status.toLowerCase()}</s-badge></td>
                      <td>{allocation.emailSentAt ? "Email sent" : allocation.notificationError ? "Email failed" : "Pending"}</td>
                      <td>
                        {canResend ? (
                          <div className="winner-actions">
                            <Form method="post">
                              <input type="hidden" name="intent" value="prepareManual" />
                              <input type="hidden" name="allocationId" value={allocation.id} />
                              <button className="admin-button" type="submit">Prepare manual email</button>
                            </Form>
                            {automaticEmailConfigured && (
                              <Form method="post">
                                <input type="hidden" name="intent" value="resend" />
                                <input type="hidden" name="allocationId" value={allocation.id} />
                                <button className="admin-button" type="submit">{allocation.emailSentAt ? "Resend claim" : "Send claim"}</button>
                              </Form>
                            )}
                          </div>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="empty-state"><p>No winner allocations have been issued yet.</p></div>}
      </s-section>
    </s-page>
  );
}
