import cron from "node-cron";
import { exec } from "child_process";
import fs from "fs";

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const interval = config.checkIntervalSeconds || 15;

cron.schedule(`*/${interval} * * * * *`, () => {
  console.log(`🚀 Running scrape-leads.js (every ${interval}s)`);
  exec("node scrape-leads.js", (err, stdout, stderr) => {
    if (err) console.error(err);
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  });
});
