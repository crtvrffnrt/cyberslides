"use strict";

(() => {
  const byId = (id) => document.getElementById(id);
  let selectedId = null;
  const fields = ["domains", "ips", "cidrs", "urls", "exclusions"];
  function entries(id) { return byId(id).value.split(/[\n,]+/).map((v) => v.trim()).filter(Boolean); }
  function showStatus(message, error = false) {
    byId("status").textContent = message;
    byId("status").style.color = error ? "#ffaaa6" : "#a5ffb8";
  }
  async function request(url, options) {
    const result = await fetch(url, options);
    const data = await result.json().catch(() => ({}));
    if (!result.ok) throw new Error(data.error || "HTTP " + result.status);
    return data;
  }
  function body(data) {
    return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) };
  }
  function edit(project) {
    selectedId = project.id;
    byId("editor").hidden = false;
    byId("projectName").textContent = project.name + " — Authorized scope";
    byId("openDeck").href = "/?project=" + encodeURIComponent(project.id);
    for (const id of fields) byId(id).value = (project.scope[id] || []).join("\n");
    byId("profile").value = project.scope.profile || "passive";
    byId("maxSeconds").value = project.scope.maxSeconds || 90;
    byId("rate").value = project.scope.maxRequestsPerSecond || 2;
    byId("authorized").checked = !!project.scope.authorized;
  }
  async function select(id) {
    try {
      const { project } = await request("/api/attackpath/projects/" + id);
      edit(project);
      showStatus("Scope loaded. Save scope before running new scans.");
    } catch (error) { showStatus(error.message, true); }
  }
  async function refresh() {
    const { projects } = await request("/api/attackpath/projects");
    const holder = byId("projects");
    holder.replaceChildren();
    if (!projects.length) { holder.textContent = "No saved training sessions."; return; }
    for (const project of projects) {
      const box = document.createElement("div");
      box.className = "project";
      const name = document.createElement("strong");
      name.textContent = project.name;
      const date = document.createElement("p");
      date.className = "muted";
      date.textContent = new Date(project.updatedAt).toLocaleString();
      const button = document.createElement("button");
      button.className = "secondary";
      button.textContent = "Open project";
      button.addEventListener("click", () => select(project.id));
      box.append(name, date, button);
      holder.append(box);
    }
  }
  byId("create").addEventListener("click", async () => {
    try {
      const { project } = await request("/api/attackpath/projects", body({ name: byId("name").value }));
      await refresh();
      edit(project);
      showStatus("Training session created. Define and save the authorized target scope.");
    } catch (error) { showStatus(error.message, true); }
  });
  byId("save").addEventListener("click", async () => {
    if (!selectedId) return;
    const scope = {
      domains: entries("domains"), ips: entries("ips"), cidrs: entries("cidrs"),
      urls: entries("urls"), exclusions: entries("exclusions"),
      profile: byId("profile").value, authorized: byId("authorized").checked,
      maxSeconds: Number(byId("maxSeconds").value),
      maxRequestsPerSecond: Number(byId("rate").value)
    };
    try {
      const options = body(scope);
      options.method = "PUT";
      await request("/api/attackpath/projects/" + selectedId + "/scope", options);
      showStatus("Scope saved.");
      await refresh();
    } catch (error) { showStatus(error.message, true); }
  });
  refresh().catch((error) => showStatus(error.message, true));
})();
