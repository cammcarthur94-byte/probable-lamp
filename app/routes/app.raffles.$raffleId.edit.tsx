import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { useEffect, useState, type FormEvent } from "react";
import prisma from "../db.server";
import { scheduleRaffleDraw } from "../lib/qstash.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const raffle = await prisma.raffle.findFirst({
    where: { id: params.raffleId, shopDomain: session.shop },
    select: { id: true, title: true, description: true, closesAt: true, status: true },
  });
  if (!raffle || raffle.status !== "ACTIVE") {
    throw new Response("This raffle is not available for editing.", { status: 404 });
  }
  return { raffle };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const closesAtValue = String(formData.get("closesAt") ?? "");

  if (!title || title.length > 120) {
    return { error: "Enter a raffle name up to 120 characters." };
  }
  if (description.length > 5000) {
    return { error: "Keep the customer-facing description under 5,000 characters." };
  }

  const raffle = await prisma.raffle.findFirst({
    where: { id: params.raffleId, shopDomain: session.shop, status: "ACTIVE" },
    select: { id: true, closesAt: true },
  });
  if (!raffle) return { error: "This raffle is no longer available for editing." };

  const requestedClosesAt = new Date(closesAtValue);
  if (!closesAtValue || Number.isNaN(requestedClosesAt.getTime())) {
    return { error: "Enter a valid entry deadline." };
  }
  const deadlineChanged = requestedClosesAt.getTime() !== raffle.closesAt.getTime();
  if (deadlineChanged) {
    if (raffle.closesAt <= new Date()) {
      return { error: "The entry deadline can no longer be changed because it has passed." };
    }
    if (requestedClosesAt <= raffle.closesAt) {
      return { error: "The entry deadline can only be extended, not shortened." };
    }
  }

  const result = await prisma.raffle.updateMany({
    where: {
      id: raffle.id,
      shopDomain: session.shop,
      status: "ACTIVE",
      AND: [
        { closesAt: raffle.closesAt },
        ...(deadlineChanged ? [{ closesAt: { gt: new Date() } }] : []),
      ],
    },
    data: {
      title,
      description,
      ...(deadlineChanged ? { closesAt: requestedClosesAt } : {}),
    },
  });
  if (!result.count) {
    return { error: "This raffle changed while you were editing. Refresh the page and try again." };
  }
  if (deadlineChanged) {
    try {
      await scheduleRaffleDraw(raffle.id, requestedClosesAt);
    } catch (error) {
      console.error(`Fairdrop could not reschedule the automatic draw for raffle ${raffle.id}.`, error);
      return {
        message: "Raffle updated. The exact-time draw could not be queued, but the safety worker will draw it after the new deadline.",
      };
    }
  }
  return { message: "Raffle updated." };
};

export default function EditRaffle() {
  const { raffle } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [localDeadline, setLocalDeadline] = useState("");
  const [deadlineChanged, setDeadlineChanged] = useState(false);

  useEffect(() => {
    const deadline = new Date(raffle.closesAt);
    const pad = (value: number, width = 2) => String(value).padStart(width, "0");
    setLocalDeadline(
      `${deadline.getFullYear()}-${pad(deadline.getMonth() + 1)}-${pad(deadline.getDate())}` +
        `T${pad(deadline.getHours())}:${pad(deadline.getMinutes())}:${pad(deadline.getSeconds())}.${pad(deadline.getMilliseconds(), 3)}`,
    );
  }, [raffle.closesAt]);

  const prepareDeadline = (event: FormEvent<HTMLFormElement>) => {
    if (!deadlineChanged) return;
    const localInput = event.currentTarget.elements.namedItem("closesAtLocal");
    const hiddenInput = event.currentTarget.elements.namedItem("closesAt");
    if (!(localInput instanceof HTMLInputElement) || !(hiddenInput instanceof HTMLInputElement)) {
      event.preventDefault();
      return;
    }
    const deadline = new Date(localInput.value);
    hiddenInput.value = Number.isNaN(deadline.getTime()) ? "" : deadline.toISOString();
  };

  const deadlineIsOpen = new Date(raffle.closesAt).getTime() > Date.now();
  return (
    <s-page heading="Edit raffle">
      <s-button slot="secondary-actions" href="/app">Back to overview</s-button>
      <p className="page-subheading">Correct the raffle name or description without changing its prize or entry rules.</p>
      <s-section>
        <Form method="post" className="admin-form" onSubmit={prepareDeadline}>
          {result && "error" in result && <div className="notice notice--error" role="alert">{result.error}</div>}
          {result && "message" in result && <div className="notice notice--success" role="status">{result.message}</div>}
          <input type="hidden" name="closesAt" value={raffle.closesAt.toISOString()} readOnly />
          <label>
            Raffle name
            <input name="title" maxLength={120} defaultValue={raffle.title} required />
          </label>
          <label>
            Customer-facing description
            <textarea name="description" rows={4} maxLength={5000} defaultValue={raffle.description} />
          </label>
          <label>
            Entry deadline
            <input
              name="closesAtLocal"
              type="datetime-local"
              step="0.001"
              value={localDeadline}
              disabled={!deadlineIsOpen}
              onChange={(event) => {
                setLocalDeadline(event.currentTarget.value);
                setDeadlineChanged(true);
              }}
            />
          </label>
          <p className="form-hint">
            {deadlineIsOpen
              ? "You may extend the deadline, but cannot shorten it. Times use your browser’s local time zone."
              : "The entry deadline has passed and can no longer be changed. The name and description remain editable until winners are drawn."}
          </p>
          <div className="admin-form__actions">
            <button className="admin-button admin-button--primary" type="submit">Save changes</button>
          </div>
        </Form>
      </s-section>
    </s-page>
  );
}
