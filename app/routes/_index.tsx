import type { LoaderFunctionArgs } from "react-router";
import { Form, redirect } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (shop) {
    return redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function Index() {
  return (
    <main className="launch-page">
      <section className="launch-card">
        <span className="launch-eyebrow">FAIRDROP</span>
        <h1>Product raffles, made simple.</h1>
        <p>Open Fairdrop from your Shopify admin to manage raffles, entries, and winners.</p>
        <Form method="post" action="/auth/login" className="launch-form">
          <label htmlFor="shop-domain">Shopify store domain</label>
          <input
            id="shop-domain"
            name="shop"
            placeholder="your-store.myshopify.com"
            autoComplete="url"
            required
          />
          <button className="admin-button admin-button--primary" type="submit">
            Log in
          </button>
        </Form>
      </section>
    </main>
  );
}
