import test from "node:test";
import assert from "node:assert/strict";

import {
  hostnameOf,
  net,
  networkOf,
  pickForNetwork,
  repoUrl,
} from "./site.ts";

// --- hostnameOf -------------------------------------------------------------

test("hostnameOf lowercases the host and drops the rest of the URL", () => {
  assert.equal(hostnameOf("https://Anonomi.org/paylinks?x=1"), "anonomi.org");
  assert.equal(hostnameOf("http://localhost:4321/"), "localhost");
});

test("hostnameOf returns empty for input that is not a URL", () => {
  assert.equal(hostnameOf("anonomi.org"), "");
  assert.equal(hostnameOf(""), "");
});

// --- networkOf --------------------------------------------------------------

test("networkOf recognises an onion origin", () => {
  assert.equal(networkOf("http://dwbgp2zfjqxcrk6fk3j7tr5uyqes4lxkipnsvm6atyi5eo7smsa6ykqd.onion"), "onion");
  assert.equal(networkOf("http://EXAMPLE.ONION/paylinks"), "onion");
});

test("networkOf recognises a development origin", () => {
  assert.equal(networkOf("http://localhost:4321"), "local");
  assert.equal(networkOf("http://127.0.0.1:4321"), "local");
});

test("networkOf treats the public site as clearnet", () => {
  assert.equal(networkOf("https://anonomi.org"), "clearnet");
  assert.equal(networkOf("https://anonomi-org.github.io"), "clearnet");
});

test("networkOf fails closed on anything it does not recognise", () => {
  // Unparseable input and unknown hosts must not be handed onion behaviour.
  assert.equal(networkOf(""), "clearnet");
  assert.equal(networkOf("not a url"), "clearnet");
  assert.equal(networkOf("https://onion.example.com"), "clearnet");
});

test("networkOf is not fooled by .onion appearing off the end of the host", () => {
  assert.equal(networkOf("https://notreally.onion.example.com"), "clearnet");
  assert.equal(networkOf("https://anonomi.org/.onion"), "clearnet");
});

// --- pickForNetwork ---------------------------------------------------------

test("pickForNetwork gives the onion form only on the onion", () => {
  assert.equal(pickForNetwork("onion", "onion-url", "clearnet-url"), "onion-url");
  assert.equal(pickForNetwork("clearnet", "onion-url", "clearnet-url"), "clearnet-url");
  assert.equal(pickForNetwork("local", "onion-url", "clearnet-url"), "clearnet-url");
});

// --- this build -------------------------------------------------------------

test("net and repoUrl agree with the build's own network", () => {
  // Under the test runner there is no PUBLIC_SITE_BASE_URL, so this is the
  // localhost default: a developer gets the links they can actually open.
  assert.equal(net("onion-url", "clearnet-url"), "clearnet-url");
  assert.equal(repoUrl(), "https://github.com/anonomi-org");
  assert.equal(repoUrl("anonomi.org"), "https://github.com/anonomi-org/anonomi.org");
});
