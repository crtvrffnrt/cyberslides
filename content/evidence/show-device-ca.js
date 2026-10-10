const fs = require("fs");
const path = require("path");

const fixturePath = path.join(__dirname, "device-ca.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const deviceRows = Object.entries(fixture.device).map(([state, value]) => ({ state, value }));

console.log("SYNTHETIC DEVICE / CONDITIONAL ACCESS FIXTURE");
console.table(deviceRows);
console.log(`Required controls: ${fixture.conditionalAccess.requiredControls.join(" + ")}`);
console.log(`Simulated decision: ${fixture.conditionalAccess.decision.toUpperCase()}`);
console.log(`Reason: ${fixture.conditionalAccess.reason}`);
console.log(`Uncertainty: ${fixture.uncertainty.join("; ")}`);
