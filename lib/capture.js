const { chromium } = require("playwright");
async function captureCover(html) {
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    try {
      browser = await chromium.launch({ headless: true });
    } catch {
      throw new Error(
        "截图需要 Chrome，或先运行 npx playwright install chromium；也可使用 --cover 图片文件。",
      );
    }
  }
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: "load", timeout: 20000 });
    await page.evaluate(() =>
      Promise.race([
        document.fonts.ready,
        new Promise((r) => setTimeout(r, 2000)),
      ]),
    );
    await page.waitForTimeout(800);
    return await page.screenshot({ type: "jpeg", quality: 82 });
  } finally {
    await browser.close();
  }
}
module.exports = { captureCover };
