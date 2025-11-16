// scrape-leads.js
import { chromium } from "playwright";
import fs from "fs";
import { execSync } from "child_process";
import fetch from "node-fetch"; // 👈 For Telegram API

// --- Load Config ---
const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const {
  maxLeadsPerDay,
  minOrderValue,
  keywords,
  message,
  autoContact,
  telegram,
} = config;

// --- Helper functions ---
async function sendTelegramMessage(text) {
  if (!telegram?.enabled || !telegram.botToken || !telegram.chatId) return;
  try {
    await fetch(
      `https://api.telegram.org/bot${telegram.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegram.chatId,
          text,
          parse_mode: "HTML",
        }),
      }
    );
    console.log("📩 Sent update to Telegram");
  } catch (err) {
    console.log("⚠️ Telegram send failed:", err.message);
  }
}

async function launchBrowserSafe() {
  try {
    console.log("🚀 Launching browser...");
    return await chromium.launch({ headless: true });
  } catch (err) {
    console.log("⚠️ Chromium missing, reinstalling...");
    execSync("npx playwright install chromium", { stdio: "inherit" });
    return await chromium.launch({ headless: true });
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
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const istDate = new Date(istString);
  const today = istDate.toISOString().split("T")[0]; // ensures IST midnight reset
  return history.filter((h) => h.date.startsWith(today));
}

function parseOrderValue(text) {
  if (!text) return 0;
  text = text.toLowerCase().replace(/[₹,]/g, "").trim();

  text = text
    .replace(/crores?/g, " crore")
    .replace(/\bcr\b/g, " crore")
    .replace(/lakhs?/g, " lakh")
    .replace(/\bl\b/g, " lakh")
    .replace(/thousands?/g, " thousand")
    .replace(/\bk\b/g, " thousand");

  const numbers = text.match(/\d+(\.\d+)?/g);
  if (!numbers) return 0;

  let multiplier = 1;
  if (text.includes("crore")) multiplier = 1e7;
  else if (text.includes("lakh")) multiplier = 1e5;
  else if (text.includes("thousand")) multiplier = 1e3;

  const numericValues = numbers.map((n) => parseFloat(n) * multiplier);
  const maxValue = Math.max(...numericValues);

  if (/more than|above|over/i.test(text)) {
    return maxValue * 1.1;
  } else if (/upto|up to|below|less than/i.test(text)) {
    return maxValue * 0.9;
  }

  return maxValue;
}

// --- Main Function ---
(async () => {
  const browser = await launchBrowserSafe();
  const context = await browser.newContext({ storageState: "state.json" });
  const page = await context.newPage();

  const history = loadHistory();
  const todays = getTodaysContacts(history);
  console.log(`📂 Loaded ${history.length} total, ${todays.length} today.`);

  console.log("➡️ Navigating to Recent Leads...");
  await page.goto("https://seller.indiamart.com/bltxn/?pref=recent", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(3000);

  console.log("📋 Extracting leads...");
  const leads = await page.$$eval("#bl_listing .bl_grid", (nodes) =>
    nodes.map((el, idx) => {
      const title =
        el.querySelector('input[name="ofrtitle"]')?.value ||
        el.querySelector(".lstNwLftCnt h2")?.innerText?.trim() ||
        el.querySelector(".lstNwLftCnt")?.innerText?.split("\n")?.[0]?.trim() ||
        "Unknown";

      const probableText =
        Array.from(el.querySelectorAll("table tbody tr")).find((r) =>
          r.innerText.toLowerCase().includes("probable order value")
        )?.innerText || "";

      const offerId = el.querySelector('input[name="ofrid"]')?.value || "";

      const leadTime =
        el.querySelector(".lstNwRgtCnt .gryTxt")?.innerText?.trim() || ""; // 👈 this extracts the actual lead time

      return {
        index: idx,
        offerId,
        title,
        probableOrderValue: probableText,
        leadTime,
      };
    })
  );

  console.log(`📦 Found ${leads.length} leads in total:`);
  leads.forEach((l, i) => {
    console.log(
      `   ${i + 1}. ${l.title} → ${l.probableOrderValue || "No value"}`
    );
  });

  // --- Filter leads ---
  const filtered = leads.filter((lead) => {
    const lowerTitle = lead.title.toLowerCase();
    const lowerAll = JSON.stringify(lead).toLowerCase();
    const matchesKeyword = keywords.some(
      (k) => lowerTitle.includes(k) || lowerAll.includes(k)
    );

    const maxValue = parseOrderValue(lead.probableOrderValue);
    const isHighValue = maxValue >= minOrderValue;
    return matchesKeyword || isHighValue;
  });

  console.log(
    `🎯 Filtered ${filtered.length} leads (≥ ₹${minOrderValue} or keyword match):`
  );
  filtered.forEach((f, i) => {
    console.log(
      `   ${i + 1}. ${f.title} → ₹${parseOrderValue(
        f.probableOrderValue
      ).toLocaleString()}`
    );
  });

  if (filtered.length === 0) {
    console.log("✅ No relevant leads found.");
    await browser.close();
    return;
  }

  // --- Identify only *new* filtered leads for today ---
  const newFilteredLeads = filtered.filter(
    (lead) => !history.some((h) => h.offerId === lead.offerId)
  );

  if (newFilteredLeads.length === 0) {
    console.log("✅ No new leads since last check. Skipping Telegram.");
    await browser.close();
    return;
  }

  // --- Log & send Telegram for new leads only ---
  const now = new Date();
  const istTime = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
  const timeStr = istTime.toLocaleString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  let summary = `📢 <b>${newFilteredLeads.length} new lead${
    newFilteredLeads.length > 1 ? "s" : ""
  } above ₹${minOrderValue.toLocaleString()}</b>\n\n`;

  newFilteredLeads.forEach((lead, i) => {
    const val = parseOrderValue(lead.probableOrderValue);
    summary += `${i + 1}. ${
      lead.title
    }\nMax Value: ₹${val.toLocaleString()}\nTime: ${lead.leadTime}\n\n`;
  });

  console.log("🆕 New leads detected:");
  console.log(summary);
  await sendTelegramMessage(summary);

  // --- Save these new leads to history (even if not auto-contacted) ---
  newFilteredLeads.forEach((lead) => {
    history.push({
      offerId: lead.offerId,
      title: lead.title,
      date: new Date().toISOString(),
    });
  });
  saveHistory(history);
  console.log(`💾 Logged ${newFilteredLeads.length} new leads to history.`);

  // --- Skip contact clicks if disabled ---
  if (!autoContact) {
    console.log(
      "🚫 autoContact=false → Skipping contact clicks (but logged + Telegram sent)."
    );
    await browser.close();
    return;
  }

  // --- Skip contact clicks if daily quota reached ---
  if (todays.length >= maxLeadsPerDay) {
    console.log(
      `✅ Already contacted ${maxLeadsPerDay} leads today. Skipping clicks but Telegram sent.`
    );
    await browser.close();
    return;
  }

  // --- Contact only within remaining quota ---
  const remainingQuota = maxLeadsPerDay - todays.length;
  const leadsToContact = newFilteredLeads.slice(0, remainingQuota);

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
        await sendTelegramMessage("New Lead Bought: " + lead.title);
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
