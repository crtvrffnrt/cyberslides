const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadNetworkConfig, resolveBindTargets } = require("../network");

function withConfig(config, callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberslides-network-"));
  const file = path.join(dir, "network.config.json");
  try {
    fs.writeFileSync(file, JSON.stringify(config));
    return callback(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("default config binds only IPv4 loopback", () => {
  const config = loadNetworkConfig();
  assert.equal(config.mode, "localhost");
  assert.deepEqual(resolveBindTargets(config), [{ host: "127.0.0.1" }]);
});

test("all mode supports explicit dual stack", () => {
  withConfig({ mode: "all", port: 8080, family: "dual" }, (file) => {
    const targets = resolveBindTargets(loadNetworkConfig(file));
    assert.deepEqual(targets, [{ host: "0.0.0.0" }, { host: "::", ipv6Only: true }]);
  });
});

test("selected interfaces bind only their addresses", () => {
  withConfig({ mode: "interfaces", port: 8080, family: "ipv4", interfaces: ["lan0", "lan1"] }, (file) => {
    const targets = resolveBindTargets(loadNetworkConfig(file), {
      lan0: [{ address: "192.168.1.20", family: "IPv4" }, { address: "fe80::1", family: "IPv6" }],
      lan1: [{ address: "10.0.0.7", family: "IPv4" }],
      other: [{ address: "172.16.0.2", family: "IPv4" }]
    });
    assert.deepEqual(targets, [{ host: "192.168.1.20" }, { host: "10.0.0.7" }]);
  });
});

test("missing interfaces and invalid settings fail instead of widening access", () => {
  withConfig({ mode: "interfaces", interfaces: ["missing"] }, (file) => {
    assert.throws(() => resolveBindTargets(loadNetworkConfig(file), {}), /not found/);
  });
  withConfig({ mode: "all", interfaces: ["lan0"] }, (file) => {
    assert.throws(() => loadNetworkConfig(file), /only used/);
  });
  withConfig({ mode: "all", port: 65536 }, (file) => {
    assert.throws(() => loadNetworkConfig(file), /port/);
  });
});
