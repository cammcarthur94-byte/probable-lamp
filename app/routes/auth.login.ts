import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { login } from "../shopify.server";

async function handleLogin(request: Request) {
  const errors = await login(request);
  if (errors?.shop) {
    return redirect(`/?error=${encodeURIComponent(errors.shop)}`);
  }
  return redirect("/");
}

export const loader = ({ request }: LoaderFunctionArgs) => handleLogin(request);
export const action = ({ request }: ActionFunctionArgs) => handleLogin(request);
