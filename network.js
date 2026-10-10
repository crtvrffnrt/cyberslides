const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const configPath = path.join(__dirname, "network.config.json");
const modes = new Set(["localhost", "all", "interfaces"]);
const families = new Set(["ipv4", "ipv6", "dual"]);

function loadNetworkConfig(filePath = configPath) {
  const config = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Network config must be a JSON object.");
  }
  for (const key of Object.keys(config)) {
    if (!["mode", "port", "family", "interfaces"].includes(key)) {
      throw new Error(`Unknown network config key: ${key}`);
    }
  }

  const mode = config.mode ?? "localhost";
  const family = config.family ?? "ipv4";
  const port = process.env.PORT === undefined ? config.port ?? 8080 : Number(process.env.PORT);
  const interfaces = config.interfaces ?? [];
  if (!modes.has(mode)) {
    throw new Error("Network mode must be localhost, all, or interfaces.");
  }
  if (!families.has(family)) {
    throw new Error("Network family must be ipv4, ipv6, or dual.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Network port must be an integer from 1 to 65535.");
  }
  if (!Array.isArray(interfaces) || interfaces.some((name) => typeof name !== "string" || !name.trim())) {
    throw new Error("Network interfaces must be an array of interface names.");
  }
  if (mode === "interfaces" && interfaces.length === 0) {
    throw new Error("Network mode interfaces requires at least one interface name.");
  }
  if (mode !== "interfaces" && interfaces.length > 0) {
    throw new Error("Network interfaces are only used with mode interfaces.");
  }
  return { mode, family, port, interfaces };
}

function resolveBindTargets(config, available) {
  const wantIpv4 = config.family !== "ipv6";
  const wantIpv6 = config.family !== "ipv4";
  if (config.mode === "localhost") {
    return [
      ...(wantIpv4 ? [{ host: "127.0.0.1" }] : []),
      ...(wantIpv6 ? [{ host: "::1", ipv6Only: true }] : [])
    ];
  }
  if (config.mode === "all") {
    return [
      ...(wantIpv4 ? [{ host: "0.0.0.0" }] : []),
      ...(wantIpv6 ? [{ host: "::", ipv6Only: true }] : [])
    ];
  }

  const networkInterfaces = available || os.networkInterfaces();
  const targets = [];
  for (const name of config.interfaces) {
    const addresses = networkInterfaces[name];
    if (!Array.isArray(addresses)) {
      throw new Error(`Network interface not found: ${name}`);
    }
    const matches = addresses.filter((entry) => {
      const version = net.isIP(entry.address);
      return (version === 4 && wantIpv4) || (version === 6 && wantIpv6);
    });
    if (matches.length === 0) {
      throw new Error(`Network interface ${name} has no ${config.family} address.`);
    }
    for (const entry of matches) {
      const isIpv6 = net.isIP(entry.address) === 6;
      const host = isIpv6 && entry.scopeid && !entry.address.includes("%")
        ? `${entry.address}%${name}`
        : entry.address;
      targets.push({ host, ...(isIpv6 ? { ipv6Only: true } : {}) });
    }
  }
  return Array.from(new Map(targets.map((target) => [target.host, target])).values());
}

module.exports = { loadNetworkConfig, resolveBindTargets };
