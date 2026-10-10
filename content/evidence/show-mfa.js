const fs = require("fs");
const path = require("path");

const fixturePath = path.join(__dirname, "mfa-events.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

console.log("SYNTHETIC MFA EVENT SUMMARY — no live authentication");
console.table(fixture.events.map(({ at, event, result }) => ({ at, event, result })));
console.log(`Access complete: ${fixture.accessComplete ? "yes" : "no"}`);
console.log(`Remaining decision: ${fixture.remainingDecision}`);
