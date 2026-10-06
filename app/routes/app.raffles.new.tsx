import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { useState, type FormEvent } from "react";
import prisma from "../db.server";
import { ThemeAppBlockOnboarding } from "../components/theme-app-block-onboarding";
import { makeHandle } from "../lib/raffles.server";
import { ensureExpirySweeperScheduled, scheduleRaffleDraw } from "../lib/qstash.server";
import {
  getOnlineStorePublication,
  publishToOnlineStore,
  unpublishFromOnlineStore,
} from "../lib/product-publication.server";
import { authenticate } from "../shopify.server";

type ProductQuery = {
  data?: {
    products?: {
      nodes: Array<{
        id: string;
        title: string;
        featuredImage?: { url: string } | null;
        variants: { nodes: Array<{ id: string; title: string }> };
      }>;
    };
  };
  errors?: Array<{ message: string }>;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const response = await admin.graphql(`#graphql
    query FairdropProducts {
      products(first: 100, sortKey: TITLE, query: "status:active") {
        nodes {
          id
          title
          featuredImage { url }
          variants(first: 1) { nodes { id title } }
        }
      }
    }`);
  const result = (await response.json()) as ProductQuery;
  if (!response.ok || result.errors?.length) {
    throw new Error(result.errors?.map((error) => error.message).join("; ") || "Could not load Shopify products.");
  }
  const products = (result.data?.products?.nodes ?? []).filter(
    (product) => product.variants.nodes.length > 0,
  );
  return { products, shopHandle: session.shop.replace(/\.myshopify\.com$/i, "") };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const productId = String(formData.get("productId") ?? "");
  const winnerCount = Number(formData.get("winnerCount") ?? 1);
  const claimWindowMinutes = Math.round(Number(formData.get("claimWindowHours") ?? 48) * 60);
  const minAccountAgeDays = Number(formData.get("minAccountAgeDays") ?? 0);
  const allowedCountries = String(formData.get("allowedCountries") ?? "")
    .split(",")
    .map((country) => country.trim().toUpperCase())
    .filter(Boolean);
  const startsAtValue = String(formData.get("startsAt") ?? "");
  const closesAtValue = String(formData.get("closesAt") ?? "");
  const restrictOnlineStore = formData.get("restrictOnlineStore") === "on";
  const retentionCouponEnabled = formData.get("retentionCouponEnabled") === "on";
  const retentionCouponType = String(formData.get("retentionCouponType") ?? "");
  const retentionCouponValue = Number(formData.get("retentionCouponValue") ?? 0);
  const retentionCouponExpiryDays = Number(formData.get("retentionCouponExpiryDays") ?? 0);
  if (!title || title.length > 120) {
    return { error: "Enter a raffle title up to 120 characters." };
  }
  if (!productId) {
    return { error: "Choose an active product with at least one variant." };
  }
  if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 100) {
    return { error: "Winner count must be between 1 and 100." };
  }
  if (!Number.isInteger(claimWindowMinutes) || claimWindowMinutes < 60 || claimWindowMinutes > 10079) {
    return { error: "Claim window must be between 1 hour and 167 hours (just under 1 week)." };
  }
  if (!Number.isInteger(minAccountAgeDays) || minAccountAgeDays < 0 || minAccountAgeDays > 3650) {
    return { error: "Minimum account age must be between 0 and 3650 days." };
  }
  if (allowedCountries.some((country) => !/^[A-Z]{2}$/.test(country))) {
    return { error: "Use two-letter country codes separated by commas (for example, US, CA)." };
  }
  const startsAt = new Date(startsAtValue);
  const closesAt = new Date(closesAtValue);
  const now = new Date();
  if (
    !startsAtValue ||
    !closesAtValue ||
    Number.isNaN(startsAt.getTime()) ||
    Number.isNaN(closesAt.getTime())
  ) {
    return { error: "Enter a valid entry start and deadline." };
  }
  if (closesAt <= startsAt) {
    return { error: "Choose a deadline after the entry start time." };
  }
  if (closesAt <= now) {
    return { error: "Choose a deadline in the future." };
  }
  if (
    retentionCouponEnabled &&
    (!["PERCENTAGE", "FIXED_AMOUNT"].includes(retentionCouponType) ||
      !Number.isFinite(retentionCouponValue) ||
      retentionCouponValue <= 0 ||
      (retentionCouponType === "PERCENTAGE" && retentionCouponValue > 100) ||
      (retentionCouponType === "FIXED_AMOUNT" && retentionCouponValue > 100000) ||
      !Number.isInteger(retentionCouponExpiryDays) ||
      retentionCouponExpiryDays < 1 ||
      retentionCouponExpiryDays > 365)
  ) {
    return { error: "Enter a valid coupon type, value, and expiry from 1 to 365 days." };
  }
  try {
    await ensureExpirySweeperScheduled(now);
  } catch (error) {
    console.error("Fairdrop could not start the automatic draw safety sweeper.", error);
    return {
      error: error instanceof Error
        ? `Automatic draws need QStash configured: ${error.message}`
        : "Automatic draws need QStash configured before a raffle can be created.",
    };
  }
  const productResponse = await admin.graphql(
    `#graphql
      query FairdropSelectedProduct($id: ID!) {
        product(id: $id) {
          id
          title
          status
          featuredImage { url }
          variants(first: 1) { nodes { id } }
        }
      }`,
    { variables: { id: productId } },
  );
  const productResult = (await productResponse.json()) as {
    data?: { product?: { id: string; title: string; status: string; featuredImage?: { url: string } | null; variants: { nodes: Array<{ id: string }> } } | null };
    errors?: Array<{ message: string }>;
  };
  if (!productResponse.ok || productResult.errors?.length || productResult.data?.product?.status !== "ACTIVE" || !productResult.data.product.variants.nodes[0]) {
    return { error: "Choose an active product with at least one variant." };
  }
  const product = productResult.data.product;
  let onlineStorePublication = null;
  if (restrictOnlineStore) {
    try {
      onlineStorePublication = await getOnlineStorePublication(admin, product.id);
    } catch (error) {
      console.error("Fairdrop could not inspect the product's Online Store publication.", error);
      return {
        error: "Could not verify this product's Online Store listing. Confirm publication access and try again.",
      };
    }
    if (!onlineStorePublication) {
      return {
        error: "This product has no Online Store publication to manage, so Fairdrop cannot restrict its storefront sales.",
      };
    }
    const overlappingRaffle = await prisma.raffle.findFirst({
      where: {
        shopDomain: session.shop,
        productId: product.id,
        restrictOnlineStore: true,
        onlineStoreRestoredAt: null,
        status: { in: ["ACTIVE", "DRAWN"] },
      },
      select: { id: true },
    });
    if (overlappingRaffle) {
      return {
        error: "This product already has an active raffle controlling Online Store availability. End that raffle before creating another.",
      };
    }
  }

  const raffle = await prisma.raffle.create({
    data: {
      shopDomain: session.shop,
      title,
      handle: makeHandle(title),
      description,
      productId: product.id,
      productTitle: product.title,
      productImageUrl: product.featuredImage?.url,
      productVariantId: product.variants.nodes[0].id,
      restrictOnlineStore,
      onlineStorePublicationId: onlineStorePublication?.publication.id ?? null,
      onlineStorePublishDate: onlineStorePublication?.publishDate
        ? new Date(onlineStorePublication.publishDate)
        : null,
      onlineStoreWasPublished: onlineStorePublication?.isPublished ?? false,
      winnerCount,
      claimWindowMinutes,
      allowMultipleWinnersPerAddress: formData.get("allowMultipleWinnersPerAddress") === "on",
      retentionCouponEnabled,
      retentionCouponType: retentionCouponEnabled ? retentionCouponType : null,
      retentionCouponValue: retentionCouponEnabled ? retentionCouponValue : null,
      retentionCouponExpiryDays: retentionCouponEnabled ? retentionCouponExpiryDays : null,
      rules: JSON.stringify({
        requireAccount: true,
        requireVerifiedEmail: formData.get("requireVerifiedEmail") === "on",
        allowedCountries: [...new Set(allowedCountries)],
        minAccountAgeDays,
        requirePhone: formData.get("requirePhone") === "on",
      }),
      startsAt,
      closesAt,
    },
  });
  let drawSchedulingWarning: string | null = null;
  try {
    await scheduleRaffleDraw(raffle.id, closesAt);
  } catch (error) {
    drawSchedulingWarning = error instanceof Error
      ? error.message
      : "The exact-time draw could not be queued; the safety worker will still pick it up.";
    console.error(`Fairdrop could not schedule the exact-time draw for raffle ${raffle.id}.`, error);
  }
  if (
    restrictOnlineStore &&
    onlineStorePublication?.isPublished &&
    startsAt <= now &&
    closesAt > now
  ) {
    try {
      await unpublishFromOnlineStore(admin, product.id, onlineStorePublication.publication.id);
      await prisma.raffle.update({
        where: { id: raffle.id },
        data: { onlineStoreRestrictedAt: new Date() },
      });
    } catch (error) {
      console.error("Fairdrop could not unpublish the raffle product from Online Store.", error);
      try {
        await publishToOnlineStore(
          admin,
          product.id,
          onlineStorePublication.publication.id,
          onlineStorePublication.publishDate
            ? new Date(onlineStorePublication.publishDate)
            : null,
        );
      } catch (restoreError) {
        console.error("Fairdrop could not restore the product after raffle setup failed.", restoreError);
        await prisma.raffle.update({
          where: { id: raffle.id },
          data: { onlineStoreRestrictedAt: new Date() },
        });
        return {
          created: true,
          handle: raffle.handle,
          warning: [
            "The raffle was saved, but Shopify could not confirm product availability. Fairdrop will retry through the safety worker; verify the product’s Online Store status in Shopify.",
            drawSchedulingWarning ? `Automatic draw scheduling also needs attention: ${drawSchedulingWarning}` : "",
          ].filter(Boolean).join(" "),
        };
      }
      await prisma.raffle.delete({ where: { id: raffle.id } });
      return {
        error: "The raffle was not created because Shopify could not remove this product from the Online Store.",
      };
    }
  }
  if (drawSchedulingWarning) {
    return {
      created: true,
      handle: raffle.handle,
      warning: `The raffle was created, but the exact-time draw could not be queued: ${drawSchedulingWarning} The safety worker will retry.`,
    };
  }
  return { created: true, handle: raffle.handle };
};

export default function NewRaffle() {
  const { products, shopHandle } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [retentionCouponEnabled, setRetentionCouponEnabled] = useState(false);
  const prepareSchedule = (event: FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    const startsAtLocal = form.elements.namedItem("startsAtLocal");
    const closesAtLocal = form.elements.namedItem("closesAtLocal");
    const startsAt = form.elements.namedItem("startsAt");
    const closesAt = form.elements.namedItem("closesAt");
    if (
      !(startsAtLocal instanceof HTMLInputElement) ||
      !(closesAtLocal instanceof HTMLInputElement) ||
      !(startsAt instanceof HTMLInputElement) ||
      !(closesAt instanceof HTMLInputElement)
    ) {
      event.preventDefault();
      return;
    }
    const start = new Date(startsAtLocal.value);
    const close = new Date(closesAtLocal.value);
    startsAt.value = Number.isNaN(start.getTime()) ? "" : start.toISOString();
    closesAt.value = Number.isNaN(close.getTime()) ? "" : close.toISOString();
  };
  return (
    <s-page heading="Create a raffle">
      <s-button slot="secondary-actions" href="/app">Back to overview</s-button>
      <p className="page-subheading">Choose a prize product and decide how customers can enter.</p>
      <s-section>
        <Form method="post" className="admin-form" onSubmit={prepareSchedule}>
          {result && "error" in result && <div className="notice notice--error" role="alert">{result.error}</div>}
          {result && "created" in result && result.created && (
            <>
              <div className="notice notice--success" role="status">Raffle created. Next, add the entry block to a storefront page.</div>
              <ThemeAppBlockOnboarding shopHandle={shopHandle} />
            </>
          )}
          {result && "warning" in result && result.warning && (
            <div className="notice notice--error" role="alert">{result.warning}</div>
          )}
          {!products.length && <div className="notice">No active products with variants were found in this shop.</div>}
          <input type="hidden" name="startsAt" />
          <input type="hidden" name="closesAt" />
          <section className="admin-form__section" aria-labelledby="raffle-details-heading">
            <div className="admin-form__section-heading">
              <h2 id="raffle-details-heading">Raffle details</h2>
              <p className="form-hint">Choose the product customers will have a chance to purchase.</p>
            </div>
            <label>Raffle name<input name="title" maxLength={120} required /></label>
            <label>Customer-facing description<textarea name="description" rows={3} /></label>
            <label>
              Prize product
              <select name="productId" required defaultValue="">
                <option value="" disabled>Select a product</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}
              </select>
            </label>
          </section>
          <section className="admin-form__section" aria-labelledby="entry-settings-heading">
            <div className="admin-form__section-heading">
              <h2 id="entry-settings-heading">Entry schedule</h2>
              <p className="form-hint">Customers can enter once during this window. Winners pay the product’s regular price.</p>
            </div>
            <div className="form-grid">
              <label>Number of winners<input name="winnerCount" type="number" min={1} max={100} defaultValue={1} required /></label>
              <label>Claim window (hours)<input name="claimWindowHours" type="number" min={1} max={167} step={1} defaultValue={48} required /></label>
              <label>Entry starts<input name="startsAtLocal" type="datetime-local" required /></label>
              <label>Entry deadline<input name="closesAtLocal" type="datetime-local" required /></label>
            </div>
            <label className="admin-form__checkbox">
              <input name="allowMultipleWinnersPerAddress" type="checkbox" />
              Allow multiple winners with the same shipping address
            </label>
            <label className="admin-form__checkbox">
              <input name="restrictOnlineStore" type="checkbox" defaultChecked />
              Keep this product off the Online Store until winner claims are settled
            </label>
            <p className="form-hint">Recommended: keep enabled to prevent non-winners buying the raffle product during entry and winner claims. The entire product (all variants) is hidden from Online Store sales when entries open and remains hidden through the automatic draw, winner claim windows, and waitlist promotions. It is restored for general sale when all prize units are purchased or marked unsold. Other sales channels are unchanged. Place the raffle entry block on a published page that is not the hidden product page. This requires Shopify publication access.</p>
            <p className="form-hint">Entries close at the deadline. The automatic draw runs on the Fairdrop safety worker, normally within 10 minutes. Times use your browser’s local time zone.</p>
          </section>
          <section className="admin-form__section" aria-labelledby="eligibility-heading">
            <div className="admin-form__section-heading">
              <h2 id="eligibility-heading">Eligibility</h2>
              <p className="form-hint">Customer country is checked against the default address on their Shopify account. Geo-IP is not used to accept or reject entries.</p>
            </div>
            <label>
              Allowed countries
              <input name="allowedCountries" placeholder="US, CA, GB" />
            </label>
            <p className="form-hint">Leave blank to allow entries from any country. Use ISO two-letter country codes. The shipping country will be checked again when the winner’s order is created.</p>
            <label>
              Minimum customer account age in days
              <input name="minAccountAgeDays" type="number" min={0} max={3650} defaultValue={0} required />
            </label>
            <label className="admin-form__checkbox">
              <input name="requireVerifiedEmail" type="checkbox" />
              Require a verified customer email
            </label>
            <label className="admin-form__checkbox">
              <input name="requirePhone" type="checkbox" />
              Require a phone number on the customer account
            </label>
            <p className="form-hint">A customer account is always required. Disposable email domains are blocked. Phone number presence is checked, but phone OTP verification is not currently available.</p>
          </section>
          <section className="admin-form__section" aria-labelledby="retention-heading">
            <div className="admin-form__section-heading">
              <h2 id="retention-heading">Keep entrants engaged</h2>
              <p className="form-hint">Every entrant receives an email after the draw. Non-winners may still be eligible for promotion if a selected customer does not claim.</p>
            </div>
            <label className="admin-form__checkbox">
              <input
                name="retentionCouponEnabled"
                type="checkbox"
                checked={retentionCouponEnabled}
                onChange={(event) => setRetentionCouponEnabled(event.currentTarget.checked)}
              />
              Offer non-winners a one-time coupon for their next order
            </label>
            {retentionCouponEnabled && (
              <>
                <div className="form-grid">
                  <label>
                    Discount type
                    <select name="retentionCouponType" defaultValue="PERCENTAGE">
                      <option value="PERCENTAGE">Percentage off</option>
                      <option value="FIXED_AMOUNT">Fixed amount off (shop currency)</option>
                    </select>
                  </label>
                  <label>Discount value<input name="retentionCouponValue" type="number" min="0.01" max="100000" step="0.01" defaultValue="10" required /></label>
                  <label>Coupon expires after (days)<input name="retentionCouponExpiryDays" type="number" min={1} max={365} defaultValue={30} required /></label>
                </div>
                <p className="form-hint">Fairdrop creates a unique Shopify discount code for each non-winner. It applies to the whole order, is limited to one use, and is locked to the entrant’s Shopify account. The coupon expires after your chosen number of days. Percentage discounts may be 0.01%–100%; fixed amounts use your shop currency. Requires Shopify discount access.</p>
              </>
            )}
          </section>
          <div className="admin-form__footer">
            <button className="admin-button admin-button--primary" type="submit" disabled={!products.length}>Create raffle</button>
          </div>
        </Form>
      </s-section>
    </s-page>
  );
}
