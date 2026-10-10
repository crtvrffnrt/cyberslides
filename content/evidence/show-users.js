const fs = require("fs");
const path = require("path");

const fixturePath = path.join(__dirname, "users.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

console.log("SYNTHETIC USER LIST — local fixture only");
console.log(fixture.toolContext);
console.log(`Tenant labels: ${fixture.tenantLabels.join(" · ")}`);
console.table(fixture.users);
