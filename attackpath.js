"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");
const https = require("https");
const crypto = require("crypto");
const { spawn } = require("child_process");

const STEP_TITLES = [
  "Engagement Overview & Attack Strategy", "Passive Reconnaissance", "Shodan Intelligence",
  "DNS, Host Discovery & Asset Validation", "Network Discovery with Nmap",
  "HTTP Probing & Technology Fingerprinting", "Web Content, Routes & API Discovery",
  "Nuclei Vulnerability Triage", "Evidence Review & Attack Path Analysis",
  "Assessment Summary & Training Debrief"
];
const STEP_BODIES = [
  "Review scope, constraints, trust boundaries, and initial hypotheses. No scanning starts automatically.",
  "Collect permitted public records and preserve provenance and timestamps.",
  "Compare Shodan host observations with current evidence. Historic banners are not live confirmation.",
  "Validate candidate assets before promoting them into an authorized target list.",
  "Run bounded service discovery and compare observed ports with passive intelligence.",
  "Identify reachable HTTP services and corroborate framework or technology fingerprints.",
  "Map routes, APIs, authentication boundaries, and potential trust-boundary transitions.",
  "Triage conservative Nuclei findings; scanner matches remain unconfirmed until validated.",
  "Correlate entrypoints, prerequisites, and evidence into plausible attack-path hypotheses.",
  "Review confirmed observations, outstanding questions, actions, and incomplete scans."
];
const validJobs = new Set(["demo", "nmap", "nuclei", "c3po", "shodan"]);
const idPattern = /^[a-f0-9-]{36}$/;
const maxOutput = 100000;

function bad(message, status = 400) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}
function cleanList(value, max = 100) {
  if (!Array.isArray(value) || value.length > max) throw bad("Expected a bounded array.");
  return value.map((v) => {
    if (typeof v !== "string" || !v.trim() || v.length > 256) throw bad("Invalid scope entry.");
    return v.trim();
  });
}
function validateScope(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw bad("Scope must be an object.");
  const scope = {
    domains: cleanList(raw.domains || []).map((x) => x.toLowerCase()),
    ips: cleanList(raw.ips || []).map((x) => x.toLowerCase()),
    cidrs: cleanList(raw.cidrs || []).map((x) => x.toLowerCase()),
    urls: cleanList(raw.urls || []),
    exclusions: cleanList(raw.exclusions || []).map((x) => x.toLowerCase()),
    authorized: raw.authorized === true,
    profile: ["passive", "standard", "lab"].includes(raw.profile) ? raw.profile : "passive",
    maxSeconds: Math.min(600, Math.max(10, Number(raw.maxSeconds) || 90)),
    maxRequestsPerSecond: Math.min(10, Math.max(1, Number(raw.maxRequestsPerSecond) || 2))
  };
  for (const domain of scope.domains) {
    if (!/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) || domain.includes(".."))
      throw bad("Invalid domain: " + domain);
  }
  for (const ip of scope.ips) if (!net.isIP(ip)) throw bad("Invalid IP address: " + ip);
  for (const cidr of scope.cidrs) {
    const [ip, prefix, extra] = cidr.split("/");
    const version = net.isIP(ip);
    const limit = version === 4 ? 32 : 128;
    if (!version || extra !== undefined || !/^\d+$/.test(prefix || "") ||
        Number(prefix) > limit) throw bad("Invalid CIDR: " + cidr);
  }
  for (const item of scope.urls) {
    let url;
    try { url = new URL(item); } catch { throw bad("Invalid URL: " + item); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw bad("Only HTTP(S) URLs without embedded credentials are allowed.");
  }
  return scope;
}
function ipNumber(address) {
  const version = net.isIP(address);
  if (version === 4) return { number: address.split(".").reduce((n, b) => (n << 8n) + BigInt(b), 0n), bits: 32 };
  if (version !== 6) return null;
  let value = address.toLowerCase();
  if (value.includes(".")) {
    const i = value.lastIndexOf(":");
    const tail = value.slice(i + 1).split(".").map(Number);
    value = value.slice(0, i) + ":" + ((tail[0] << 8) + tail[1]).toString(16) + ":" +
      ((tail[2] << 8) + tail[3]).toString(16);
  }
  const pieces = value.split("::");
  if (pieces.length > 2) return null;
  const left = pieces[0] ? pieces[0].split(":") : [];
  const right = pieces[1] ? pieces[1].split(":") : [];
  const groups = pieces.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  if (groups.length !== 8) return null;
  return { number: groups.reduce((n, x) => (n << 16n) + BigInt(parseInt(x, 16)), 0n), bits: 128 };
}
function withinCidr(ip, cidr) {
  const [base, length] = cidr.split("/");
  const left = ipNumber(ip), right = ipNumber(base);
  if (!left || !right || left.bits !== right.bits) return false;
  const shift = BigInt(left.bits - Number(length));
  return (left.number >> shift) === (right.number >> shift);
}
function parseTarget(input) {
  if (typeof input !== "string" || !input || input.length > 2048 ||
      /[\x00-\x20\x7f]/.test(input)) throw bad("Invalid target.");
  if (net.isIP(input)) return { host: input.toLowerCase(), value: input, isUrl: false };
  let url;
  try { url = new URL(input); } catch { throw bad("Targets must be IP addresses or explicit HTTP(S) URLs."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
    throw bad("Invalid HTTP(S) target.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname.includes("%")) throw bad("Invalid hostname.");
  return { host: hostname, value: url.href, isUrl: true };
}
function permitted(scope, parsed) {
  const host = parsed.host;
  if (scope.exclusions.some((e) => e === host || e === parsed.value.toLowerCase())) return false;
  if (net.isIP(host)) return scope.ips.includes(host) || scope.cidrs.some((c) => withinCidr(host, c));
  if (parsed.isUrl && scope.urls.some((u) => u === parsed.value)) return true;
  return scope.domains.some((domain) =>
    domain.startsWith("*.") ? host.endsWith(domain.slice(1)) && host !== domain.slice(2) : host === domain);
}
function createDeck(name) {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "presentation.config.json"), "utf8"));
  const titles = ["Scope & Authorization", ...STEP_TITLES];
  const body = [
    "Define authorized domains, IPs, CIDRs, URLs, exclusions and limits using the Attack Path control panel.\n\n**No active scan is permitted until authorization is confirmed.**",
    ...STEP_BODIES
  ];
  config.title = name;
  config.cover = {
    kicker: "Attack Path Simulation / Training",
    title: name,
    subtitle: "Authorized reconnaissance and web assessment — evidence-driven workflow",
    agendaTitle: "Assessment workflow",
    agenda: STEP_TITLES
  };
  config.slides = [{ type: "cover", layout: "cover", terminal: { enabled: false }, mustReadUrl: "" },
    ...titles.map((t) => ({ type: "dense", layout: "center", terminal: { enabled: false }, mustReadUrl: "" }))];
  config.contentSlides = [
    "# " + name + "\n\nAuthorized Red Team assessment & training",
    ...titles.map((t, i) => "# " + t + "\n\n" + body[i] + "\n\n---\n\n**Evidence:** View the Attack Path control panel.")
  ];
  return config;
}
function discoverBackground(rootDir) {
  const ignored = new Set([".git", "node_modules", "attackpath-data", ".cache", "dist", "build", "coverage"]);
  const found = [];
  function visit(directory, depth) {
    if (depth > 7 || found.length > 80) return;
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".") || ignored.has(entry.name)) continue;
      const current = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === "background.png") {
        const relative = path.relative(rootDir, current);
        found.push(relative);
      } else if (entry.isDirectory()) visit(current, depth + 1);
    }
  }
  visit(rootDir, 0);
  found.sort((a, b) => {
    const priority = (x) => x === "background.png" ? 0 : /^(content|assets|images|public)\//.test(x) ? 1 : 2;
    return priority(a) - priority(b) || a.localeCompare(b);
  });
  return found[0] ? "/" + found[0].split(path.sep).map(encodeURIComponent).join("/") : null;
}
function summarize(tool, output) {
  const text = String(output || "");
  if (!text.trim()) return { items: 0, note: "No structured observations received." };
  if (tool === "nuclei") {
    const findings = text.split("\n").filter(Boolean).flatMap((line) => {
      try { const item = JSON.parse(line);
        return item && typeof item === "object" ? [{
          template: item["template-id"] || item.templateID || "unknown",
          severity: item.info?.severity || "unknown", target: item["matched-at"] || item.host || ""
        }] : [];
      } catch { return []; }
    });
    return { items: findings.length, findings: findings.slice(0, 25), status: "scanner leads; manual validation required" };
  }
  if (tool === "shodan") {
    try { const data = JSON.parse(text);
      return { ip: data.ip_str || "", ports: Array.isArray(data.ports) ? data.ports : [],
        lastSeen: data.last_update || null, status: "historic indexed observations" };
    } catch { return { items: 0, note: "Shodan response was not valid JSON." }; }
  }
  if (tool === "c3po") {
    try { const data = JSON.parse(text);
      return { schema: data.schema_version || data.schema || "unrecognized", keys: Object.keys(data).slice(0, 30),
        status: "review the full C3PO structured evidence before confirming claims" };
    } catch { return { items: 0, note: "C3PO output was not valid JSON." }; }
  }
  if (tool === "nmap") {
    const ports = [...text.matchAll(/<port\b[^>]*portid="(\d+)"[^>]*>[\s\S]*?<state\b[^>]*state="open"/g)];
    return { items: ports.length, openPorts: [...new Set(ports.map((m) => Number(m[1])))].slice(0, 100),
      status: "scanner observations" };
  }
  return { items: 0 };
}
function createAttackPathService(rootDir) {
  const directory = path.join(rootDir, "attackpath-data");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const running = new Map();
  function location(id) {
    if (!idPattern.test(id)) throw bad("Invalid project ID.", 404);
    return path.join(directory, id + ".json");
  }
  function read(id) {
    let project;
    try { project = JSON.parse(fs.readFileSync(location(id), "utf8")); }
    catch (error) { if (error.code === "ENOENT") throw bad("Project not found.", 404); throw error; }
    return project;
  }
  function save(project) {
    project.updatedAt = new Date().toISOString();
    const dest = location(project.id), temp = dest + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(project, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, dest);
  }
  function create(name) {
    const safeName = typeof name === "string" ? name.trim().slice(0, 90) : "";
    if (!safeName) throw bad("Project name is required.");
    const project = { schemaVersion: 1, id: crypto.randomUUID(), name: safeName,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      scope: validateScope({}), presentation: createDeck(safeName), jobs: [] };
    save(project);
    return project;
  }
  function list() {
    return fs.readdirSync(directory).filter((f) => /^[a-f0-9-]{36}\.json$/.test(f))
      .map((f) => { try { const p = read(f.slice(0, -5)); return { id: p.id, name: p.name,
        createdAt: p.createdAt, updatedAt: p.updatedAt, jobs: p.jobs.length }; }
      catch { return null; } }).filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  function execute(id, spec) {
    const project = read(id);
    if (!spec || !validJobs.has(spec.tool)) throw bad("Unsupported scanner.");
    if (spec.tool === "demo") {
      const job = { id: crypto.randomUUID(), tool: "demo", target: "synthetic.example.test",
        status: "completed", scope: structuredClone(project.scope),
        startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        exitCode: 0, error: "",
        output: JSON.stringify({ mode: "SYNTHETIC — NO NETWORK TRAFFIC",
          hosts: [{ host: "synthetic.example.test", ip: "192.0.2.10",
            services: [{ port: 443, protocol: "https", confidence: "simulated" }] }],
          findings: [{ title: "Example exposed test application", confirmed: false,
            impact: "Training example only — not a real vulnerability" }] }, null, 2),
        summary: { status: "synthetic training evidence only", items: 1 } };
      project.jobs.unshift(job);
      project.jobs = project.jobs.slice(0, 60);
      save(project);
      return job;
    }
    if (!project.scope.authorized) throw bad("Confirm authorization in Scope before scanning.", 403);
    if (project.scope.profile === "passive" && spec.tool !== "shodan")
      throw bad("Passive profile does not allow active tools.", 403);
    const target = parseTarget(spec.target);
    if (!permitted(project.scope, target)) throw bad("Target is outside the approved scope.", 403);
    if (spec.tool === "nmap" && target.isUrl) throw bad("Nmap requires an explicit IP target.");
    if (spec.tool === "nuclei" && !target.isUrl) throw bad("Nuclei requires an HTTP(S) URL.");
    if (spec.tool === "shodan" && !net.isIP(target.host)) throw bad("Shodan host lookup requires an IP address.");
    if (spec.tool === "c3po" && !target.isUrl && !net.isIP(target.host)) throw bad("C3PO target must be an IP or URL.");
    if (project.jobs.filter((j) => j.status === "running").length >= 1) throw bad("A scan is already running.", 409);
    const job = { id: crypto.randomUUID(), tool: spec.tool, target: target.value,
      scope: structuredClone(project.scope), status: "running", startedAt: new Date().toISOString(),
      finishedAt: null, exitCode: null, output: "", error: "" };
    project.jobs.unshift(job);
    project.jobs = project.jobs.slice(0, 60);
    save(project);
    function finish(status, exitCode, message = "") {
      const fresh = read(id), stored = fresh.jobs.find((j) => j.id === job.id);
      if (!stored || stored.status !== "running") return;
      stored.status = status;
      stored.summary = summarize(stored.tool, stored.output);
      stored.exitCode = exitCode;
      stored.finishedAt = new Date().toISOString();
      if (message) stored.error = message.slice(0, 1200);
      running.delete(job.id);
      save(fresh);
    }
    function append(kind, chunk) {
      const fresh = read(id), stored = fresh.jobs.find((j) => j.id === job.id);
      if (!stored || stored.status !== "running") return;
      const s = String(chunk);
      stored[kind] = (stored[kind] + s).slice(0, maxOutput);
      save(fresh);
    }
    if (spec.tool === "shodan") {
      const key = process.env.SHODANAPI;
      if (!key) { finish("failed", null, "SHODANAPI is not configured."); return job; }
      const request = https.get("https://api.shodan.io/shodan/host/" +
        encodeURIComponent(target.host) + "?key=" + encodeURIComponent(key), { timeout: 12000 }, (res) => {
        let body = "";
        res.on("data", (c) => { body = (body + c).slice(0, maxOutput); });
        res.on("end", () => { append("output", body); finish(res.statusCode === 200 ? "completed" : "failed",
          res.statusCode, res.statusCode === 200 ? "" : "Shodan API returned HTTP " + res.statusCode); });
      });
      running.set(job.id, { kill: () => request.destroy() });
      request.on("timeout", () => request.destroy(new Error("Shodan timed out")));
      request.on("error", (e) => finish("failed", null, e.message));
      return job;
    }
    let program, args, cwd = rootDir;
    if (spec.tool === "nmap") {
      program = "nmap";
      args = ["-sT", "-Pn", "-sV", "--version-light", "--top-ports", "100",
        "-T2", "--max-retries", "1", "-oX", "-", target.value];
    } else if (spec.tool === "nuclei") {
      program = "nuclei";
      args = ["-u", target.value, "-jsonl", "-silent", "-dr", "-pt", "http", "-severity", "high,medium,low",
        "-tags", "misconfig,exposure,ssl,tls,tech", "-etags", "dos,fuzz,headless,code,intrusive,bruteforce,dast,default-login",
        "-rate-limit", String(project.scope.maxRequestsPerSecond), "-concurrency", "1"];
    } else {
      const c3po = process.env.C3PO_PATH;
      if (!c3po || !fs.existsSync(path.join(c3po, "run.sh"))) {
        finish("failed", null, "Set C3PO_PATH to a local C3PO-Shodan-codex checkout.");
        return job;
      }
      program = "bash";
      args = [path.join(c3po, "run.sh"), "--research-json", "--target", target.value, "--no-nuclei"];
      cwd = c3po;
    }
    let child;
    try { child = spawn(program, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env }, detached: process.platform !== "win32" }); }
    catch (e) { finish("failed", null, e.message); return job; }
    const timer = setTimeout(() => {
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM"); }
      catch { /* Already exited. */ }
      finish("timed_out", null, "Scan exceeded configured timeout.");
    }, project.scope.maxSeconds * 1000);
    running.set(job.id, { kill: () => {
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM"); }
      catch { /* Already exited. */ }
    } });
    child.stdout.on("data", (chunk) => append("output", chunk));
    child.stderr.on("data", (chunk) => append("error", chunk));
    child.on("error", (e) => { clearTimeout(timer); finish("failed", null, e.message); });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0 ? "completed" : "failed", code, code === 0 ? "" : "Scanner exited with code " + code);
    });
    return job;
  }
  function cancel(id, jobId) {
    const p = read(id), job = p.jobs.find((j) => j.id === jobId);
    if (!job) throw bad("Job not found.", 404);
    if (job.status === "running") {
      const handle = running.get(jobId);
      if (handle) handle.kill();
      job.status = "cancelled";
      job.finishedAt = new Date().toISOString();
      save(p);
      running.delete(jobId);
    }
    return job;
  }
  // On boot, process state from a previous server process is never assumed to persist.
  for (const entry of fs.readdirSync(directory)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(entry)) continue;
    try { const p = read(entry.slice(0, -5)); let changed = false;
      for (const j of p.jobs) if (j.status === "running") {
        j.status = "interrupted"; j.finishedAt = new Date().toISOString(); changed = true;
      }
      if (changed) save(p);
    } catch { /* Ignore malformed projects until explicitly opened. */ }
  }
  async function handle(req, res, pathname, readBody, reply) {
    try {
      if (pathname === "/api/attackpath/background" && req.method === "GET")
        return reply(res, 200, { url: discoverBackground(rootDir) });
      if (pathname === "/api/attackpath/projects") {
        if (req.method === "GET") return reply(res, 200, { projects: list() });
        if (req.method === "POST") {
          const body = await readBody(req);
          const project = create(body.name);
          return reply(res, 201, { project });
        }
      }
      const match = pathname.match(/^\/api\/attackpath\/projects\/([a-f0-9-]{36})(?:\/(scope|jobs)(?:\/([a-f0-9-]{36})\/cancel)?)?$/);
      if (!match) throw bad("Unknown endpoint.", 404);
      const [, id, sub, jobId] = match;
      if (!sub && req.method === "GET") return reply(res, 200, { project: read(id) });
      if (sub === "scope" && req.method === "PUT") {
        const p = read(id), value = await readBody(req);
        if (p.jobs.some((j) => j.status === "running")) throw bad("Cancel running scans before changing scope.", 409);
        p.scope = validateScope(value);
        save(p);
        return reply(res, 200, { scope: p.scope });
      }
      if (sub === "jobs" && !jobId) {
        if (req.method === "GET") return reply(res, 200, { jobs: read(id).jobs });
        if (req.method === "POST") return reply(res, 201, { job: execute(id, await readBody(req)) });
      }
      if (sub === "jobs" && jobId && req.method === "POST")
        return reply(res, 200, { job: cancel(id, jobId) });
      throw bad("Unsupported endpoint.", 404);
    } catch (error) {
      reply(res, error.statusCode || 500, { error: error.statusCode ? error.message : "Attack Path service failed." });
    }
  }
  return { handle, read, save, getPresentation: (id) => read(id).presentation,
    savePresentation: (id, config) => { const p = read(id); p.presentation = config; save(p); },
    discoverBackground: () => discoverBackground(rootDir) };
}
module.exports = { createAttackPathService, validateScope, parseTarget, permitted, withinCidr, createDeck, discoverBackground, summarize };
