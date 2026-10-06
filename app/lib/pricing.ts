export function formatMoney(amount: number, currencyCode: string | null | undefined) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode || "USD",
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currencyCode ?? ""}`.trim();
  }
}

export function winnerPriceLabel(raffle: { winnerPrice: number | null; priceCurrency: string | null }) {
  return raffle.winnerPrice == null ? null : formatMoney(raffle.winnerPrice, raffle.priceCurrency);
}
