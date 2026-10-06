import assert from "node:assert/strict";
import test from "node:test";
import { buildWinnerClaimEmailContent } from "./mailer.server.ts";

test("manual winner email includes the claim link and deadline but no invoice URL", () => {
  const email = buildWinnerClaimEmailContent({
    winnerName: "Raffle Winner",
    storeName: "Test Store",
    replyTo: null,
    subjectTemplate: "You won {{raffle}}!",
    messageTemplate: "Claim {{product}} by {{deadline}} for {{store}}.",
    raffleTitle: "Sneaker Drop",
    productTitle: "Test Sneaker",
    deadlineAt: new Date("2026-10-06T12:00:00.000Z"),
    timeZone: "UTC",
    claimUrl: "https://example.myshopify.com/apps/fairdrop/claim/secret-token",
  });

  assert.equal(email.subject, "You won Sneaker Drop!");
  assert.match(email.text, /Claim Test Sneaker by/);
  assert.match(email.text, /https:\/\/example\.myshopify\.com\/apps\/fairdrop\/claim\/secret-token/);
  assert.match(email.text, /Claim deadline:/);
  assert.doesNotMatch(email.text, /invoice|checkoutToken/);
});
