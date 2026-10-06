export type WinnerEmail = {
  to: string;
  winnerName: string;
  storeName: string;
  replyTo: string | null;
  subjectTemplate: string | null;
  messageTemplate: string | null;
  raffleTitle: string;
  productTitle: string;
  deadlineAt: Date;
  timeZone: string | null;
  claimUrl: string;
};

export type TransactionalEmail = {
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
};

export interface TransactionalEmailProvider {
  send(message: TransactionalEmail): Promise<void>;
}

class ResendProvider implements TransactionalEmailProvider {
  async send(message: TransactionalEmail) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("Set RESEND_API_KEY before issuing winner claims.");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: message.from,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    if (!response.ok) {
      throw new Error(`Winner email delivery failed (${response.status}): ${await response.text()}`);
    }
  }
}

const provider: TransactionalEmailProvider = new ResendProvider();

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function formatDeadline(deadlineAt: Date, timeZone: string | null) {
  const zone = timeZone || "UTC";
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone,
      timeZoneName: "short",
    }).format(deadlineAt);
  } catch {
    return new Intl.DateTimeFormat("en", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(deadlineAt);
  }
}

function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(raffle|product|deadline|store)\}\}/g, (_match, key: string) => values[key] ?? "");
}

function getSenderAddress() {
  const configured = process.env.MAIL_FROM;
  if (!configured) throw new Error("Set MAIL_FROM to an address verified with your transactional email provider.");
  const address = configured.match(/<([^<>]+)>/)?.[1] ?? configured;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new Error("MAIL_FROM must be an email address verified with your transactional email provider.");
  }
  return address;
}

export function buildWinnerClaimEmailContent(input: Omit<WinnerEmail, "to" | "claimUrl"> & { claimUrl: string }) {
  const deadline = formatDeadline(input.deadlineAt, input.timeZone);
  const values = {
    raffle: input.raffleTitle,
    product: input.productTitle,
    deadline,
    store: input.storeName,
  };
  const subject = fillTemplate(
    input.subjectTemplate || "You won {{raffle}}!",
    values,
  ).slice(0, 180);
  const intro = fillTemplate(
    input.messageTemplate || "You were selected as a winner. Claim your opportunity to purchase {{product}} at its regular price.",
    values,
  );
  const text = [
    `Hi ${input.winnerName},`,
    "",
    intro,
    "",
    `Product: ${input.productTitle}`,
    `Claim deadline: ${deadline}`,
    "",
    `Claim your prize: ${input.claimUrl}`,
    "",
    `This claim link is for the Shopify customer account selected in ${input.raffleTitle}.`,
  ].join("\n");
  return { subject, text };
}

export async function sendWinnerClaimEmail(input: WinnerEmail) {
  const { subject, text } = buildWinnerClaimEmailContent(input);
  const senderName = input.storeName.replace(/[\r\n<>"]/g, "").slice(0, 80) || "Fairdrop";
  const deadline = formatDeadline(input.deadlineAt, input.timeZone);
  const intro = fillTemplate(
    input.messageTemplate || "You were selected as a winner. Claim your opportunity to purchase {{product}} at its regular price.",
    {
      raffle: input.raffleTitle,
      product: input.productTitle,
      deadline: formatDeadline(input.deadlineAt, input.timeZone),
      store: input.storeName,
    },
  );
  const html = `<main style="font-family:Arial,sans-serif;line-height:1.6;color:#202a24"><p>Hi ${escapeHtml(input.winnerName)},</p><p>${escapeHtml(intro).replace(/\n/g, "<br>")}</p><p><strong>Product:</strong> ${escapeHtml(input.productTitle)}<br><strong>Claim deadline:</strong> ${escapeHtml(deadline)}</p><p><a href="${escapeHtml(input.claimUrl)}" style="background:#245f46;border-radius:6px;color:#fff;display:inline-block;padding:12px 20px;text-decoration:none">Claim your prize</a></p><p>This claim link is for the Shopify customer account selected in ${escapeHtml(input.raffleTitle)}.</p><p>${escapeHtml(input.storeName)}</p></main>`;

  await provider.send({
    from: `${senderName} <${getSenderAddress()}>`,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    to: input.to,
    subject,
    html,
    text,
  });
}

export async function sendRaffleOutcomeEmail(input: {
  to: string;
  entrantName: string;
  storeName: string;
  replyTo: string | null;
  raffleTitle: string;
  productTitle: string;
  couponCode: string | null;
  couponDescription: string | null;
  couponOnly?: boolean;
  idempotencyKey: string;
}) {
  const senderName = input.storeName.replace(/[\r\n<>"]/g, "").slice(0, 80) || "Fairdrop";
  const subject = input.couponOnly
    ? `A thank-you offer from ${input.storeName}`
    : `Your ${input.raffleTitle} raffle update`;
  const outcome = `Thank you for entering ${input.raffleTitle}. You were not selected in the initial draw for ${input.productTitle}. Your entry may still be eligible for promotion if a selected entrant does not claim; if you are promoted, we will email you with an opportunity to purchase.`;
  const offer = input.couponCode
    ? `${input.couponDescription ?? "Here is a thank-you discount for your next order."}\nCoupon code: ${input.couponCode}`
    : "";
  const text = [
    `Hi ${input.entrantName},`,
    "",
    input.couponOnly ? "Here is the thank-you offer we promised for your next order." : outcome,
    ...(offer ? ["", offer] : []),
    "",
    input.storeName,
  ].join("\n");
  const html = `<main style="font-family:Arial,sans-serif;line-height:1.6;color:#202a24"><p>Hi ${escapeHtml(input.entrantName)},</p><p>${escapeHtml(input.couponOnly ? "Here is the thank-you offer we promised for your next order." : outcome)}</p>${input.couponCode ? `<p>${escapeHtml(input.couponDescription ?? "Here is a thank-you discount for your next order.")}</p><p style="font-size:20px;font-weight:bold;letter-spacing:0.08em">${escapeHtml(input.couponCode)}</p>` : ""}<p>${escapeHtml(input.storeName)}</p></main>`;

  await provider.send({
    from: `${senderName} <${getSenderAddress()}>`,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    to: input.to,
    subject: subject.slice(0, 180),
    html,
    text,
    idempotencyKey: input.idempotencyKey,
  });
}
