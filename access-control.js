"use strict";

const crypto = require("crypto");
const { URL } = require("url");

function createAccessControl(options = {}) {
  const host = options.host || "127.0.0.1";
  const network = !["127.0.0.1", "::1", "localhost"].includes(host);
  const operatorToken = process.env.CYBERSLIDES_ACCESS_TOKEN || "";
  const viewerToken = process.env.CYBERSLIDES_VIEWER_TOKEN || "";
  if (network && operatorToken.length < 16) {
    throw new Error("LAN binding requires CYBERSLIDES_ACCESS_TOKEN (at least 16 characters).");
  }
  const sessions = new Map();
  const lifetime = 12 * 60 * 60 * 1000;

  function equal(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  function originAllowed(req) {
    if (!req.headers.origin) return true;
    try {
      const origin = new URL(req.headers.origin);
      const expected = String(req.headers.host || "").toLowerCase();
      return (origin.protocol === "http:" || origin.protocol === "https:") &&
        origin.host.toLowerCase() === expected;
    } catch {
      return false;
    }
  }

  function role(req) {
    if (!network) return "operator";
    const cookie = String(req.headers.cookie || "").split(";").map((s) => s.trim())
      .find((s) => s.startsWith("cyberslides_session="));
    if (!cookie) return null;
    const token = cookie.slice("cyberslides_session=".length);
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const session = sessions.get(token);
    if (!session || session.expires < Date.now()) {
      sessions.delete(token);
      return null;
    }
    return session.role;
  }

  function deny(res, status, message) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ error: message }));
  }

  function loginPage(res) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'" });
    res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Cyberslides access</title><style>body{font:16px system-ui;background:#101114;color:#eee;max-width:430px;margin:15vh auto;padding:24px}input,button{font:inherit;padding:12px;width:100%;box-sizing:border-box;margin:8px 0}input{background:#222;color:white;border:1px solid #555}button{background:#7dff9b;border:0;color:#111;cursor:pointer}</style><h1>Cyberslides</h1><p>LAN access requires an operator or viewer token.</p><input id="token" type="password" placeholder="Access token" autofocus><button id="go">Sign in</button><p id="error" role="alert"></p><script>document.getElementById("go").onclick=async()=>{const r=await fetch("/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:document.getElementById("token").value})});if(r.ok)location.href="/attackpath";else document.getElementById("error").textContent="Invalid token"};document.getElementById("token").addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("go").click()})</script></html>');
  }

  function login(req, res, payload) {
    if (!originAllowed(req)) return deny(res, 403, "Invalid origin.");
    const input = payload && typeof payload.token === "string" ? payload.token : "";
    const granted = operatorToken && equal(input, operatorToken) ? "operator" :
      viewerToken && viewerToken.length >= 16 && equal(input, viewerToken) ? "viewer" : null;
    if (!granted) return deny(res, 401, "Invalid token.");
    const ticket = crypto.randomBytes(32).toString("hex");
    const expires = Date.now() + lifetime;
    sessions.set(ticket, { role: granted, expires });
    const secure = req.socket.encrypted === true ? "; Secure" : "";
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store",
      "set-cookie": "cyberslides_session=" + ticket + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200" + secure });
    res.end(JSON.stringify({ role: granted }));
  }

  function authorizeHttp(req, res, pathname) {
    if (pathname === "/api/login" && req.method === "POST") return true;
    if (network && !role(req)) {
      if (req.method === "GET" && (pathname === "/" || pathname === "/attackpath" || pathname === "/index.html")) {
        loginPage(res);
      } else {
        deny(res, 401, "Authentication required.");
      }
      return false;
    }
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (unsafe && !originAllowed(req)) {
      deny(res, 403, "Cross-origin writes are not permitted.");
      return false;
    }
    if (network && role(req) === "viewer" && (unsafe || pathname.startsWith("/api/attackpath/") ||
      pathname === "/api/attackpath" || pathname === "/api/login")) {
      deny(res, 403, "Operator privileges required.");
      return false;
    }
    return true;
  }

  function authorizeUpgrade(req) {
    return originAllowed(req) && role(req) === "operator";
  }

  return { authorizeHttp, authorizeUpgrade, login, role, network };
}

module.exports = { createAccessControl };
