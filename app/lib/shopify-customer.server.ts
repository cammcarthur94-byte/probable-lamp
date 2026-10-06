import { unauthenticated } from "../shopify.server";
import type { EligibilityCustomer } from "./eligibility";

type CustomerQuery = {
  data?: {
    customer?: {
      createdAt: string;
      email: string | null;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      verifiedEmail: boolean;
      defaultAddress?: {
        countryCodeV2: string | null;
        phone: string | null;
        address1: string | null;
        address2: string | null;
        city: string | null;
        provinceCode: string | null;
        zip: string | null;
      } | null;
    } | null;
  };
  errors?: Array<{ message: string }>;
};

export class ShopifyCustomerDataAccessError extends Error {
  constructor() {
    super("This app is not approved to access the Customer object.");
    this.name = "ShopifyCustomerDataAccessError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function containsCustomerAccessDenial(value: unknown, visited = new Set<object>()): boolean {
  if (typeof value === "string") {
    return value.includes("not approved to access the Customer object");
  }
  if (!isRecord(value) || visited.has(value)) return false;
  visited.add(value);

  if (
    typeof value.message === "string" &&
    value.message.includes("not approved to access the Customer object")
  ) {
    return true;
  }

  return ["graphQLErrors", "errors", "response", "cause"].some((key) =>
    containsCustomerAccessDenial(value[key], visited),
  );
}

export type ShopifyEligibilityCustomer = EligibilityCustomer & {
  name: string;
};

export async function getShopifyEligibilityCustomer(
  shopDomain: string,
  customerId: string,
): Promise<ShopifyEligibilityCustomer | null> {
  if (!/^\d+$/.test(customerId)) return null;

  const { admin } = await unauthenticated.admin(shopDomain);
  let response: Response;
  try {
    response = await admin.graphql(
      `#graphql
        query FairdropEligibilityCustomer($id: ID!) {
          customer(id: $id) {
            createdAt
            email
            firstName
            lastName
            phone
            verifiedEmail
            defaultAddress {
              countryCodeV2
              phone
              address1
              address2
              city
              provinceCode
              zip
            }
          }
        }`,
      { variables: { id: `gid://shopify/Customer/${customerId}` } },
    );
  } catch (error) {
    if (containsCustomerAccessDenial(error)) {
      throw new ShopifyCustomerDataAccessError();
    }
    throw error;
  }
  const result = (await response.json()) as CustomerQuery;
  if (!response.ok || result.errors?.length) {
    const errorMessage = result.errors?.map((error) => error.message).join("; ");
    if (errorMessage?.includes("not approved to access the Customer object")) {
      throw new ShopifyCustomerDataAccessError();
    }
    throw new Error(
      errorMessage || "Shopify could not verify the customer profile.",
    );
  }

  const customer = result.data?.customer;
  if (!customer) return null;

  const name = [customer.firstName, customer.lastName]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ");
  return {
    verifiedEmail: customer.verifiedEmail,
    email: customer.email,
    createdAt: customer.createdAt,
    phone: customer.phone,
    defaultAddress: customer.defaultAddress
      ? {
          countryCode: customer.defaultAddress.countryCodeV2,
          phone: customer.defaultAddress.phone,
          address1: customer.defaultAddress.address1,
          address2: customer.defaultAddress.address2,
          city: customer.defaultAddress.city,
          provinceCode: customer.defaultAddress.provinceCode,
          postalCode: customer.defaultAddress.zip,
        }
      : null,
    name: name || customer.email?.split("@")[0] || "",
  };
}
