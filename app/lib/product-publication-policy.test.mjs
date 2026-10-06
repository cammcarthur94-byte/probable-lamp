import assert from "node:assert/strict";
import test from "node:test";
import { getRafflePublicationAction } from "./product-publication-policy.ts";

const start = new Date("2026-10-05T12:00:00.000Z");
const close = new Date("2026-10-06T12:00:00.000Z");

test("future entry windows wait until their start time", () => {
  assert.equal(
    getRafflePublicationAction({
      status: "ACTIVE",
      startsAt: start,
      closesAt: close,
      wasPublished: true,
      restrictedAt: null,
    }, new Date("2026-10-05T11:59:00.000Z")),
    "wait",
  );
});

test("active entry windows enforce Online Store unpublishing", () => {
  assert.equal(
    getRafflePublicationAction({
      status: "ACTIVE",
      startsAt: start,
      closesAt: close,
      wasPublished: false,
      restrictedAt: null,
    }, start),
    "enforce",
  );
});

test("a closed entry window stays hidden until the draw and claims settle", () => {
  assert.equal(
    getRafflePublicationAction({
      status: "ACTIVE",
      startsAt: start,
      closesAt: close,
      wasPublished: true,
      restrictedAt: start,
    }, close),
    "wait",
  );
  assert.equal(
    getRafflePublicationAction({
      status: "DRAWN",
      startsAt: start,
      closesAt: close,
      wasPublished: true,
      restrictedAt: start,
    }, close),
    "wait",
  );
});

test("completed or cancelled raffles restore only products published before the raffle", () => {
  assert.equal(
    getRafflePublicationAction({
      status: "COMPLETED",
      startsAt: start,
      closesAt: close,
      wasPublished: false,
      restrictedAt: start,
    }, close),
    "finish",
  );
  assert.equal(
    getRafflePublicationAction({
      status: "COMPLETED",
      startsAt: start,
      closesAt: close,
      wasPublished: true,
      restrictedAt: start,
    }, close),
    "restore",
  );
});
