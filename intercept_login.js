import puppeteer from 'puppeteer';

(async () => {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Intercept network requests
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (request.method() === 'POST' && url.includes('passport')) {
      console.log('--- CAPTURED PASSPORT POST REQUEST ---');
      console.log('URL:', url);
      console.log('HEADERS:', request.headers());
      console.log('POST DATA:', request.postData());
      console.log('--------------------------------------\n');
    }
    request.continue();
  });

  try {
    console.log("Navigating to login...");
    await page.goto('https://www.capcut.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const emailSelector = 'input.lv_sign_in_panel_wide-input';
    await page.waitForSelector(emailSelector, { timeout: 15000 });
    await page.type(emailSelector, 'huber@risanmedia.id', { delay: 50 });

    const continueSelector = 'button.lv_sign_in_panel_wide-primary-button';
    await page.waitForSelector(continueSelector, { timeout: 5000 });
    await page.click(continueSelector);

    await new Promise(r => setTimeout(r, 2000));

    const passSelector = 'input[type="password"]';
    await page.waitForSelector(passSelector, { timeout: 15000 });
    await page.type(passSelector, 'marinecapcut', { delay: 50 });

    const loginBtnSelector = 'button.lv_sign_in_panel_wide-sign-in-button';
    await page.waitForSelector(loginBtnSelector, { timeout: 5000 });
    await page.click(loginBtnSelector);

    console.log("Waiting 5s for requests to form...");
    await new Promise(r => setTimeout(r, 5000));

  } catch (err) {
    console.log("Error:", err.message);
  } finally {
    await browser.close();
    console.log("Done");
  }
})();
