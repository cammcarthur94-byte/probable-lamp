import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

const DEFAULT_SUBJECT = "You won {{raffle}}!";
const DEFAULT_MESSAGE =
  "You were selected as a winner. Claim your opportunity to purchase {{product}} at the winner price shown below.";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  return {
    shopName: shop?.name ?? session.shop,
    emailReplyTo: shop?.emailReplyTo ?? "",
    emailSubject: shop?.emailSubject ?? DEFAULT_SUBJECT,
    emailMessage: shop?.emailMessage ?? DEFAULT_MESSAGE,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const emailReplyTo = String(formData.get("emailReplyTo") ?? "").trim();
  const emailSubject = String(formData.get("emailSubject") ?? "").trim();
  const emailMessage = String(formData.get("emailMessage") ?? "").trim();
  if (
    emailReplyTo &&
    (emailReplyTo.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailReplyTo))
  ) {
    return { error: "Enter a valid reply-to email address." };
  }
  if (!emailSubject || emailSubject.length > 180) {
    return { error: "Enter an email subject up to 180 characters." };
  }
  if (!emailMessage || emailMessage.length > 2000) {
    return { error: "Enter a winner email message up to 2,000 characters." };
  }

  await prisma.shop.update({
    where: { domain: session.shop },
    data: { emailReplyTo: emailReplyTo || null, emailSubject, emailMessage },
  });
  return { saved: true };
};

export default function SettingsPage() {
  const settings = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <s-page heading="Settings">
      <p className="page-subheading">Configure merchant-branded winner claim emails.</p>
      <s-section heading="Winner email">
        <Form method="post" className="admin-form">
          {result && "error" in result && <div className="notice notice--error" role="alert">{result.error}</div>}
          {result && "saved" in result && result.saved && <div className="notice notice--success" role="status">Email settings saved.</div>}
          <p className="form-hint">
            Emails use {settings.shopName} as the displayed sender name and the app’s verified MAIL_FROM address.
            The reply-to address is optional. The verified sending domain is configured by the Fairdrop operator;
            see the deployment guide before offering per-merchant sender domains.
          </p>
          <label>
            Reply-to email
            <input name="emailReplyTo" type="email" maxLength={254} defaultValue={settings.emailReplyTo} />
          </label>
          <label>
            Subject
            <input name="emailSubject" maxLength={180} defaultValue={settings.emailSubject} required />
          </label>
          <label>
            Winner message
            <textarea name="emailMessage" rows={5} maxLength={2000} defaultValue={settings.emailMessage} required />
          </label>
          <p className="form-hint">Available placeholders: {"{{raffle}}"}, {"{{product}}"}, {"{{deadline}}"}, {"{{store}}"}.</p>
          <button className="admin-button admin-button--primary" type="submit">Save email settings</button>
        </Form>
      </s-section>
    </s-page>
  );
}
