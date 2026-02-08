import fs from "fs";

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const INTERVAL = (config.checkIntervalSeconds || 60) * 1000;

async function run() {
  while (true) {
    try {
      console.log("🚀 Running scrape-leads.js");
      await import("./scrape-leads.js");
    } catch (err) {
      console.error("❌ Run failed:", err);
    }

    // IMPORTANT: let memory settle
    await new Promise((res) => setTimeout(res, INTERVAL));
  }
}

run();
