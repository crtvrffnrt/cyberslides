"use strict";

(() => {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("project");
  function element(tag, text, className) {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  }
  const link = element("a", projectId ? "Assessments" : "Attack Path mode");
  link.href = "/attackpath";
  link.style.cssText = "position:fixed;top:12px;left:14px;z-index:9999;background:#20232a;color:#7dff9b;border:1px solid #596558;padding:8px 12px;border-radius:7px;font:13px system-ui;text-decoration:none";
  document.body.append(link);
  if (!projectId || !/^[a-f0-9-]{36}$/.test(projectId)) return;

  const css = element("style");
  css.textContent = [
    "#ap-panel{position:fixed;top:56px;right:14px;z-index:9999;width:min(370px,36vw);max-height:calc(100vh - 85px);overflow:auto;background:rgba(15,18,23,.97);color:#e8eef5;border:1px solid #505964;border-radius:10px;padding:14px;box-shadow:0 10px 28px #0008;text-align:left;font:13px/1.45 system-ui}",
    "#ap-panel.collapsed .ap-detail{display:none}",
    "#ap-panel input,#ap-panel select,#ap-panel button{font:inherit;padding:7px;border-radius:5px}",
    "#ap-panel input,#ap-panel select{background:#161b22;border:1px solid #5b6573;color:white;width:100%;margin:5px 0 9px}",
    "#ap-panel button{background:#7dff9b;border:0;color:#09130c;font-weight:700;cursor:pointer}",
    "#ap-panel button.alt{background:#3b4553;color:white}",
    "#ap-panel .ap-row{display:flex;gap:7px;align-items:center;justify-content:space-between;margin:9px 0}",
    "#ap-panel .ap-job{border-top:1px solid #445;padding:10px 0}",
    "#ap-panel pre{font:11px/1.35 monospace;white-space:pre-wrap;word-break:break-word;max-height:170px;overflow:auto;background:#090b0e;padding:8px;border-radius:5px}",
    "#ap-panel a{color:#8ffbaa}#ap-panel .ap-muted{color:#a9b2c0}",
    "@media(max-width:800px){#ap-panel{width:min(360px,92vw);top:55px}}"
  ].join("\n");
  document.head.append(css);
  const panel = element("aside"); panel.id = "ap-panel";
  const heading = element("div", "ATTACK PATH / OPERATOR", "ap-row");
  const collapse = element("button", "Hide", "alt");
  heading.append(collapse);
  panel.append(heading);
  const detail = element("div"); detail.className = "ap-detail";
  const step = element("strong", "Loading...");
  const status = element("p", "", "ap-muted");
  const scopeLink = element("a", "Edit authorized scope");
  scopeLink.href = "/attackpath";
  const profile = element("p", "", "ap-muted");
  const label = element("label", "Scanner");
  const tool = element("select");
  for (const [value, title] of [["shodan", "Shodan host intelligence"], ["nmap", "Nmap service scan"],
    ["nuclei", "Nuclei web checks"], ["c3po", "C3PO research JSON"]]) {
    const opt = element("option", title); opt.value = value; tool.append(opt);
  }
  const targetLabel = element("label", "In-scope IP or HTTP(S) URL");
  const target = element("input"); target.placeholder = "Authorized IP or URL";
  const runRow = element("div"); runRow.className = "ap-row";
  const run = element("button", "Run approved scan");
  const reload = element("button", "Refresh", "alt"); runRow.append(run, reload);
  const jobs = element("div");
  detail.append(step, status, scopeLink, profile, element("hr"), label, tool, targetLabel, target, runRow,
    element("h4", "Recorded scans"), jobs);
  panel.append(detail);
  document.body.append(panel);
  collapse.addEventListener("click", () => {
    panel.classList.toggle("collapsed");
    collapse.textContent = panel.classList.contains("collapsed") ? "Show" : "Hide";
  });
  let currentProject = null;
  let jobSnapshot = "";
  async function request(url, method, data) {
    const response = await fetch(url, method ? {
      method, headers: { "content-type": "application/json" }, body: JSON.stringify(data || {})
    } : undefined);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "HTTP " + response.status);
    return result;
  }
  function activeSlide() {
    const slide = document.querySelector(".slide.active");
    return slide ? Number(slide.dataset.slideIndex) : 0;
  }
  function updateStep() {
    const index = activeSlide();
    step.textContent = index === 0 ? "Cover" : index === 1 ? "Scope & authorization" :
      "Training step " + (index - 1) + " / 10";
    if (index === 1) status.textContent = "Use the scope editor to authorize or exclude assets.";
    else if (index === 0) status.textContent = "Select a slide to explore reconnaissance and testing.";
  }
  async function refreshProject() {
    const { project } = await request("/api/attackpath/projects/" + projectId);
    currentProject = project;
    profile.textContent = "Profile: " + project.scope.profile + " · Authorization: " +
      (project.scope.authorized ? "confirmed" : "not confirmed");
  }
  async function refreshJobs() {
    const { jobs: saved } = await request("/api/attackpath/projects/" + projectId + "/jobs");
    const snapshot = JSON.stringify(saved);
    if (snapshot === jobSnapshot) return;
    jobSnapshot = snapshot;
    jobs.replaceChildren();
    if (!saved.length) jobs.append(element("p", "No scans recorded.", "ap-muted"));
    for (const job of saved.slice(0, 12)) {
      const div = element("div"); div.className = "ap-job";
      div.append(element("strong", job.tool.toUpperCase() + " · " + job.status));
      div.append(element("div", job.target, "ap-muted"));
      if (job.status === "running") {
        const cancel = element("button", "Cancel", "alt");
        cancel.addEventListener("click", async () => {
          try {
            await request("/api/attackpath/projects/" + projectId + "/jobs/" + job.id + "/cancel", "POST");
            await refreshJobs();
          } catch (error) { status.textContent = error.message; }
        });
        div.append(cancel);
      }
      if (job.output) div.append(element("pre", job.output.slice(0, 14000)));
      if (job.error) div.append(element("pre", job.error.slice(0, 3000)));
      jobs.append(div);
    }
  }
  run.addEventListener("click", async () => {
    run.disabled = true;
    try {
      const response = await request("/api/attackpath/projects/" + projectId + "/jobs", "POST",
        { tool: tool.value, target: target.value.trim() });
      status.textContent = "Scan " + response.job.status + " — " + response.job.id;
      await refreshJobs();
    } catch (error) { status.textContent = error.message; }
    finally { run.disabled = false; }
  });
  reload.addEventListener("click", async () => {
    try { await refreshProject(); await refreshJobs(); updateStep(); }
    catch (error) { status.textContent = error.message; }
  });
  setInterval(() => { updateStep(); if (!document.hidden) refreshJobs().catch(() => {}); }, 2500);
  refreshProject().then(refreshJobs).then(updateStep).catch((error) => { status.textContent = error.message; });
})();
