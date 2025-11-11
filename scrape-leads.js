// scrape-leads.js
import { chromium } from "playwright";
import fs from "fs";

// --- Load Config ---
const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const { maxLeadsPerDay, minOrderValue, keywords, message } = config;

// --- Helper functions ---
async function clickLabelOrCheckInput(page, labelSelector, inputSelector) {
  try {
    const label = await page.$(labelSelector);
    if (label) {
      await label.scrollIntoViewIfNeeded();
      await label.click({ force: true });
      return true;
    }

    const ok = await page
      .$eval(inputSelector, (inp) => {
        if (!inp) return false;
        inp.checked = true;
        const ev = new Event("change", { bubbles: true });
        inp.dispatchEvent(ev);
        const clickEv = new MouseEvent("click", { bubbles: true });
        inp.dispatchEvent(clickEv);
        return true;
      })
      .catch(() => false);
    return ok;
  } catch (e) {
    return false;
  }
}

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync("contacted-history.json", "utf8"));
  } catch {
    return [];
  }
}

function saveHistory(history) {
  fs.writeFileSync("contacted-history.json", JSON.stringify(history, null, 2));
}

function getTodaysContacts(history) {
  const today = new Date().toISOString().split("T")[0];
  return history.filter((h) => h.date.startsWith(today));
}

// --- Main Function ---
(async () => {
  console.log("🚀 Launching browser...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: "state.json" });
  const page = await context.newPage();

  const history = loadHistory();
  const todays = getTodaysContacts(history);
  console.log(`📂 Loaded ${history.length} total, ${todays.length} today.`);

  if (todays.length >= maxLeadsPerDay) {
    console.log(`✅ Already contacted ${maxLeadsPerDay} leads today. Exiting.`);
    await browser.close();
    return;
  }

  console.log("➡️ Navigating to Recent Leads...");
  await page.goto("https://seller.indiamart.com/bltxn/?pref=recent", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(3000);

  // --- Extract leads ---
  console.log("📋 Extracting leads...");
  const leads = await page.$$eval("#bl_listing .bl_grid", (nodes) =>
    nodes.map((el, idx) => {
      const title =
        el.querySelector('input[name="ofrtitle"]')?.value ||
        el.querySelector(".lstNwLftCnt h2")?.innerText?.trim() ||
        el.querySelector(".lstNwLftCnt")?.innerText?.split("\n")?.[0]?.trim() ||
        "Unknown";

      const city = el.querySelector('input[id^="card_city_"]')?.value || "";
      const state = el.querySelector('input[id^="card_state_"]')?.value || "";
      const category = el.querySelector('input[name="mcatname"]')?.value || "";
      const probableText =
        Array.from(el.querySelectorAll("table tbody tr")).find((r) =>
          r.innerText.toLowerCase().includes("probable order value")
        )?.innerText || "";
      const probableMatch =
        probableText.match(/Rs\.?\s*([\d,]+)(?:\s*-\s*([\d,]+))?/i) ||
        probableText.match(/₹\s?([\d,]+)/);
      let probableOrderValue = probableMatch ? probableMatch[0].trim() : "";

      const offerId = el.querySelector('input[name="ofrid"]')?.value || "";

      return {
        index: idx,
        offerId,
        title,
        category,
        city,
        state,
        probableOrderValue,
      };
    })
  );

  console.log(`📦 Found ${leads.length} leads, filtering...`);

  // --- Apply filters ---
  const filtered = leads.filter((lead) => {
    const lowerTitle = lead.title.toLowerCase();
    const lowerAll = JSON.stringify(lead).toLowerCase();
    const matchesKeyword = keywords.some(
      (k) => lowerTitle.includes(k) || lowerAll.includes(k)
    );

    let maxValue = 0;
    const match = lead.probableOrderValue?.match(/([\d,]+)/g);
    if (match?.length) {
      const numbers = match.map((n) => parseInt(n.replace(/,/g, ""), 10));
      maxValue = Math.max(...numbers);
    }

    const isHighValue = maxValue >= minOrderValue;
    return matchesKeyword || isHighValue;
  });

  console.log(
    `🎯 Found ${filtered.length} filtered leads (≥ ₹${minOrderValue} or keyword match).`
  );

  // --- Skip already contacted ---
  const newLeads = filtered.filter(
    (l) => !history.some((h) => h.offerId === l.offerId)
  );

  if (newLeads.length === 0) {
    console.log("✅ No new leads found.");
    await browser.close();
    return;
  }

  const remainingQuota = maxLeadsPerDay - todays.length;
  const leadsToContact = newLeads.slice(0, remainingQuota);
  console.log(`📞 Will contact up to ${leadsToContact.length} leads today.`);

  for (const lead of leadsToContact) {
    try {
      const card = (await page.$$("#bl_listing .bl_grid"))[lead.index];
      const contactBtn = await card.$(".btnCBN");
      if (!contactBtn) continue;
      await contactBtn.scrollIntoViewIfNeeded();
      console.log(`👉 Clicking 'Contact Buyer Now' for: ${lead.title}`);
      await contactBtn.click({ delay: 300 });
      await page.waitForTimeout(4000);

      const msgBox = await page.$("#txtmsgbox");
      if (msgBox) {
        await msgBox.fill(message);
        const sendBtn = await page.$("#sendbutton");
        if (sendBtn) {
          await sendBtn.click();
          console.log("✅ Message sent successfully!");
        }
      }

      history.push({
        offerId: lead.offerId,
        title: lead.title,
        date: new Date().toISOString(),
      });
      saveHistory(history);
      console.log(`💾 Updated history (${history.length} total).`);
    } catch (err) {
      console.log(`⚠️ Error contacting ${lead.title}:`, err.message);
    }

    await page.waitForTimeout(5000);
  }

  await browser.close();
  console.log("🏁 Done for now.");
})();
