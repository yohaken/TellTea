import assert from "node:assert/strict";
import {
  TUNE_DESK_DEFAULT_WAIT_SEC,
  TUNE_DESK_NAME,
  TUNE_DESK_PROTOCOL,
  askStillWaiting,
  isAskTimedOut,
  type TuneDeskMessage,
} from "../src/lib/vat-agent-chat";

assert.equal(TUNE_DESK_NAME, "โต๊ะจูน");
assert.ok(TUNE_DESK_DEFAULT_WAIT_SEC >= 30);
assert.ok(TUNE_DESK_PROTOCOL.some((p) => p.includes("ออฟไลน์")));

const ask: TuneDeskMessage = {
  id: "a1",
  threadId: "vat-import",
  role: "local",
  name: "CursorLocal",
  body: "Grab คอลัมน์ไหนคือยอดโอน?",
  createdAt: 1000,
  isAsk: true,
  waitUntil: 1000 + 90_000,
  replyToId: null,
  clientMsgId: "c1",
};

assert.equal(askStillWaiting(ask, [ask], 1000 + 10_000), true);
assert.equal(isAskTimedOut(ask, [ask], 1000 + 10_000), false);
assert.equal(askStillWaiting(ask, [ask], 1000 + 100_000), false);
assert.equal(isAskTimedOut(ask, [ask], 1000 + 100_000), true);

const replied: TuneDeskMessage = {
  id: "m1",
  threadId: "vat-import",
  role: "mentor",
  name: "CloudMentor",
  body: "ใช้ Net / payout",
  createdAt: 20_000,
  isAsk: false,
  waitUntil: null,
  replyToId: "a1",
  clientMsgId: "c2",
};
assert.equal(isAskTimedOut(ask, [ask, replied], 1000 + 100_000), false);
assert.equal(askStillWaiting(ask, [ask, replied], 1000 + 10_000), false);

console.log("test-vat-agent-chat: ok");
