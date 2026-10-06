import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { NavMenu } from "@shopify/app-bridge-react";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { syncShop } from "../lib/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  await syncShop(session, admin);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  return (
    <ShopifyAppProvider apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Overview</Link>
        <Link to="/app/raffles/new">Create raffle</Link>
        <Link to="/app/entries">Entries</Link>
        <Link to="/app/winners">Winners</Link>
        <Link to="/app/analytics">Analytics</Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      <Outlet />
    </ShopifyAppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
