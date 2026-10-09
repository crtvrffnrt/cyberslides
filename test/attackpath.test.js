"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateScope, parseTarget, permitted, withinCidr, createDeck, discoverBackground,
  createAttackPathService } = require("../attackpath");
const { createAccessControl } = require("../access-control");

test("guided deck has one cover, one scope and ten editable workflow slides", () => {
  const deck = createDeck("Lab assessment");
  assert.equal(deck.slides.length, 12);
  assert.equal(deck.contentSlides.length, 12);
  assert.equal(deck.slides[0].type, "cover");
  assert.ok(deck.contentSlides[1].includes("Scope"));
  assert.ok(deck.contentSlides[11].includes("Debrief"));
});

test("scope rejects malformed targets, credentials and CIDR ranges", () => {
  assert.throws(() => validateScope({ ips: ["not-an-ip"] }));
  assert.throws(() => validateScope({ cidrs: ["10.0.0.0/33"] }));
  assert.throws(() => validateScope({ urls: ["file:///etc/passwd"] }));
  assert.throws(() => validateScope({ urls: ["https://alice:secret@example.org"] }));
  assert.throws(() => parseTarget("ssh://example.org"));
  assert.throws(() => parseTarget("https://alice:secret@example.org/"));
  assert.throws(() => parseTarget("https://example.org/\n"));
});

test("exact names, wildcard names, CIDR membership and exclusions are respected", () => {
  const scope = validateScope({
    authorized: true, domains: ["example.org", "*.lab.example.org"], ips: ["192.0.2.10"],
    cidrs: ["198.51.100.0/27", "2001:db8::/64"], exclusions: ["deny.lab.example.org"]
  });
  assert.equal(permitted(scope, parseTarget("https://example.org/a")), true);
  assert.equal(permitted(scope, parseTarget("https://other.example.org/")), false);
  assert.equal(permitted(scope, parseTarget("https://ok.lab.example.org/")), true);
  assert.equal(permitted(scope, parseTarget("https://deny.lab.example.org/")), false);
  assert.equal(permitted(scope, parseTarget("192.0.2.10")), true);
  assert.equal(permitted(scope, parseTarget("198.51.100.31")), true);
  assert.equal(permitted(scope, parseTarget("198.51.100.32")), false);
  assert.equal(withinCidr("2001:db8::42", "2001:db8::/64"), true);
  assert.equal(withinCidr("2001:db9::42", "2001:db8::/64"), false);
});

test("background discovery prefers project root and skips symlinks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-background-"));
  try {
    fs.mkdirSync(path.join(root, "images"));
    fs.writeFileSync(path.join(root, "images", "background.png"), "fake");
    assert.equal(discoverBackground(root), "/images/background.png");
    fs.writeFileSync(path.join(root, "background.png"), "fake");
    assert.equal(discoverBackground(root), "/background.png");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("projects persist, create 12 slides, and block scans without authorization", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-project-"));
  try {
    const service = createAttackPathService(root);
    const call = async (pathname, method, data) => {
      const response = {};
      await service.handle({ method }, response, pathname, async () => data,
        (_res, code, body) => { response.code = code; response.body = body; });
      return response;
    };
    let result = await call("/api/attackpath/projects", "POST", { name: "Authorized Lab" });
    assert.equal(result.code, 201);
    const id = result.body.project.id;
    assert.equal(result.body.project.presentation.slides.length, 12);
    const demo = await call("/api/attackpath/projects/" + id + "/jobs", "POST", { tool: "demo" });
    assert.equal(demo.code, 201);
    assert.equal(demo.body.job.status, "completed");
    assert.match(demo.body.job.output, /NO NETWORK TRAFFIC/);
    result = await call("/api/attackpath/projects/" + id + "/jobs", "POST",
      { tool: "nmap", target: "192.0.2.10" });
    assert.equal(result.code, 403);
    result = await call("/api/attackpath/projects/" + id + "/scope", "PUT",
      { authorized: true, profile: "standard", ips: ["192.0.2.10"] });
    assert.equal(result.code, 200);
    result = await call("/api/attackpath/projects/" + id + "/jobs", "POST",
      { tool: "nmap", target: "203.0.113.1" });
    assert.equal(result.code, 403);
    result = await call("/api/attackpath/projects", "GET");
    assert.equal(result.body.projects.length, 1);
    assert.equal(service.getPresentation(id).slides.length, 12);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("LAN authentication protects HTTP and terminal WebSocket", () => {
  const original = process.env.CYBERSLIDES_ACCESS_TOKEN;
  process.env.CYBERSLIDES_ACCESS_TOKEN = "testing-access-token-long";
  try {
    const access = createAccessControl({ host: "0.0.0.0" });
    const response = () => ({
      headers: {}, writeHead(code, headers) { this.status = code; this.headers = headers; },
      end(value) { this.body = value; }
    });
    const plain = { method: "GET", headers: { host: "192.168.1.2:8080" }, socket: {} };
    const denied = response();
    assert.equal(access.authorizeHttp(plain, denied, "/api/presentation"), false);
    assert.equal(denied.status, 401);
    const loginRes = response();
    access.login({ ...plain, method: "POST" }, loginRes, { token: "testing-access-token-long" });
    assert.equal(loginRes.status, 200);
    const cookie = loginRes.headers["set-cookie"].split(";")[0];
    const authenticated = { ...plain, headers: { ...plain.headers, cookie } };
    assert.equal(access.authorizeHttp(authenticated, response(), "/api/presentation"), true);
    assert.equal(access.authorizeUpgrade(authenticated), true);
    const hostile = { ...authenticated, headers: { ...authenticated.headers, origin: "https://evil.invalid" } };
    assert.equal(access.authorizeUpgrade(hostile), false);
    const blocked = response();
    assert.equal(access.authorizeHttp({ ...hostile, method: "PUT" }, blocked, "/api/presentation"), false);
    assert.equal(blocked.status, 403);
  } finally {
    if (original === undefined) delete process.env.CYBERSLIDES_ACCESS_TOKEN;
    else process.env.CYBERSLIDES_ACCESS_TOKEN = original;
  }
});
