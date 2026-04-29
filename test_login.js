import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

puppeteer.use(StealthPlugin());

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    try {
        await page.goto('https://www.capcut.com/login', { waitUntil: 'networkidle2' });
        await page.waitForSelector('input[name="signUsername"]');
        await page.type('input[name="signUsername"]', 'test@example.com');
        await page.click('.lv_sign_in_panel_wide-primary-button');
        await new Promise(r => setTimeout(r, 4000));
        const html = await page.evaluate(() => document.body.innerHTML);
        fs.writeFileSync('login_page2.html', html);
        console.log('Saved login_page2.html');
    } catch(e) { console.error('Error:', e); }
    await browser.close();
})();
