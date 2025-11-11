// login-and-save-state.js
import { chromium } from "playwright";
import fs from "fs";

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("➡️ Opening IndiaMART seller portal...");
  await page.goto("https://seller.indiamart.com", {
    waitUntil: "domcontentloaded",
  });

  console.log(`
========================================================
🪄 Please log in manually using OTP or password in browser.
Once you see your Seller Dashboard or Leads Page,
come back here and press ENTER to save your login session.
========================================================
`);

  // Wait for user confirmation
  process.stdin.once("data", async () => {
    try {
      const storage = await context.storageState();
      fs.writeFileSync("state.json", JSON.stringify(storage, null, 2));
      console.log("\n💾 Login session saved to 'state.json'.");
      console.log(
        "✅ You can now close the browser and run: node scrape-leads.js\n"
      );
    } catch (err) {
      console.error("❌ Failed to save login state:", err);
    } finally {
      await browser.close();
      process.exit(0);
    }
  });
})();
