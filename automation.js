import fetch from "node-fetch";
import * as cheerio from 'cheerio';
import { faker } from '@faker-js/faker';
import { promises as fs, readFileSync } from 'fs';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

let config = {};
try {
    config = JSON.parse(readFileSync('./config.json', 'utf-8'));
} catch (e) {
    console.log('No config.json found, using process.env or defaults.');
}
const APP_PASSWORD = process.env.PASSWORD || config.password || 'marinecapcut';
const CONCURRENCY_LIMIT = 5; // 16GB RAM can handle 5-10 easily.

// --- Helper Functions ---

function encryptToTargetHex(input) {
    let hexResult = "";
    for (const char of input) {
        const encryptedCharCode = char.charCodeAt(0) ^ 0x05;
        hexResult += encryptedCharCode.toString(16).padStart(2, "0");
    }
    return hexResult;
}

function getCurrentTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `[${hours}:${minutes}:${seconds}]`;
}

function logToSocket(socket, message, type = 'info') {
    if (socket) {
        socket.emit('log', { time: getCurrentTime(), message, type });
    }
    console.log(`${getCurrentTime()} ${message}`);
}

// Install a background auto-clicker that dismisses CapCut popups (Terms of Service, etc.)
// This runs in the background via MutationObserver so it catches popups no matter when they appear.
async function installPopupDismisser(page) {
    await page.evaluate(() => {
        function tryDismiss() {
            const btns = document.querySelectorAll('button.lv-btn-primary, button[class*="footer-btn"]');
            for (const btn of btns) {
                if (btn.innerText.trim() === 'OK' && btn.offsetParent !== null) {
                    btn.click();
                    return true;
                }
            }
            return false;
        }
        // Try immediately in case popup is already there
        tryDismiss();
        // Watch for future popups
        const observer = new MutationObserver(() => { tryDismiss(); });
        observer.observe(document.body, { childList: true, subtree: true });
        // Also use interval as fallback
        const iv = setInterval(() => {
            if (tryDismiss()) clearInterval(iv);
        }, 500);
        // Clean up after 30s
        setTimeout(() => { observer.disconnect(); clearInterval(iv); }, 30000);
    }).catch(() => {});
}

async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 20000 } = options; // 20s timeout

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(resource, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

async function getEmailRandom(socket) {
    try {
        const res = await fetchWithTimeout('https://generator.email/');
        const text = await res.text();
        const $ = cheerio.load(text);
        const result = [];
        $('.e7m.tt-suggestions').find('div > p').each(function (index, element) {
            result.push($(element).text());
        });
        return result;
    } catch (err) {
        logToSocket(socket, `Error fetch email domains: ${err.message}`, 'error');
        return [];
    }
}

async function functionGetLink(email, domain) {
    try {
        const res = await fetchWithTimeout('https://generator.email/', {
            headers: {
                'cookie': `_gid=GA1.2.989703044.1735637209; embx=%5B%22xaviermoen51%40dogonoithatlienha.com%22%2C%22sadahayuv%40jagomail.com%22%2C%22sadahayua%40jagomail.com%22%2C%22sadahayu%40jagomail.com%22%2C%22ajacoba%40auhit.com%22%5D; _ga=GA1.1.1696815852.1733235907; __gads=ID=08e2714256afd00c:T=1733235907:RT=1735638862:S=ALNI_MaFvYNYLhdTjGzS2xa3eZ3jls6QMQ; __gpi=UID=00000f7f6013ca38:T=1733235907:RT=1735638862:S=ALNI_MayYarsiugqTzh0Ky4wHiYNrSnGtQ; __eoi=ID=101f6e905a8358a1:T=1733235907:RT=1735638862:S=AA-AfjZCYAfxlwf-nyRYeP_9J9rE; FCNEC=%5B%5B%22AKsRol8j6KSk9Pga59DuS0D4a2pk72ZTqwfVO82pNZ4h-bO_EWCi04aWAU6ULkfWs6oHpsd6Cs949FJ6fmNfbqNhHt8GslL8Aa0Dzr20gerHRB_kL3qK8nW6DeD0WzT9KfeamIWXb1LyD2b7IDCPM94I8fUvBRcTqA%3D%3D%22%5D%5D; _ga_1GPPTBHNKN=GS1.1.1735637208.2.1.1735638882.38.0.0; surl=${domain}%2F${email}`,
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            method: 'GET'
        });

        const text = await res.text();
        const $ = cheerio.load(text);
        const src = $("#email-table > div.e7m.row.list-group-item > div.e7m.col-md-12.ma1 > div.e7m.mess_bodiyy > div > div > div:nth-child(2) > p:nth-child(2) > span").text().trim();
        return src;
    } catch (err) {
        return null;
    }
}

async function functionGetGptCode(email, domain) {
    try {
        const res = await fetchWithTimeout('https://generator.email/', {
            headers: {
                'cookie': `_gid=GA1.2.989703044.1735637209; embx=%5B%22xaviermoen51%40dogonoithatlienha.com%22%2C%22sadahayuv%40jagomail.com%22%2C%22sadahayua%40jagomail.com%22%2C%22sadahayu%40jagomail.com%22%2C%22ajacoba%40auhit.com%22%5D; _ga=GA1.1.1696815852.1733235907; __gads=ID=08e2714256afd00c:T=1733235907:RT=1735638862:S=ALNI_MaFvYNYLhdTjGzS2xa3eZ3jls6QMQ; __gpi=UID=00000f7f6013ca38:T=1733235907:RT=1735638862:S=ALNI_MayYarsiugqTzh0Ky4wHiYNrSnGtQ; __eoi=ID=101f6e905a8358a1:T=1733235907:RT=1735638862:S=AA-AfjZCYAfxlwf-nyRYeP_9J9rE; FCNEC=%5B%5B%22AKsRol8j6KSk9Pga59DuS0D4a2pk72ZTqwfVO82pNZ4h-bO_EWCi04aWAU6ULkfWs6oHpsd6Cs949FJ6fmNfbqNhHt8GslL8Aa0Dzr20gerHRB_kL3qK8nW6DeD0WzT9KfeamIWXb1LyD2b7IDCPM94I8fUvBRcTqA%3D%3D%22%5D%5D; _ga_1GPPTBHNKN=GS1.1.1735637208.2.1.1735638882.38.0.0; surl=${domain}%2F${email}`,
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            method: 'GET'
        });

        const text = await res.text();
        const $ = cheerio.load(text);
        
        // Target the subject or check if its from OpenAI
        const emailContent = $("#email-table").text();
        if (emailContent.includes('OpenAI')) {
            // Usually the code is a 6 digit number, let's extract it
            // This regex looks for exactly 6 digits, bordered by word boundaries
            // We might need to look specifically in the body.
            const bodyText = $(".e7m.mess_bodiyy").text();
            const codeMatch = bodyText.match(/\b\d{6}\b/);
            if (codeMatch) {
                return codeMatch[0];
            }
        }
        return null;
    } catch (err) {
        return null;
    }
}

async function regist_sendRequest(encryptedEmail, encryptedPassword) {
    try {
        const url = new URL('https://www.capcut.com/passport/web/email/send_code/');
        const queryParams = {
            aid: '348188',
            account_sdk_source: 'web',
            language: 'en',
            verifyFp: 'verify_m7euzwhw_PNtb4tlY_I0az_4me0_9Hrt_sEBZgW5GGPdn',
            check_region: '1'
        };
        Object.entries(queryParams).forEach(([key, value]) => { url.searchParams.append(key, value); });

        const formData = new URLSearchParams();
        formData.append('mix_mode', '1');
        formData.append('email', encryptedEmail);
        formData.append('password', encryptedPassword);
        formData.append('type', '34');
        formData.append('fixed_mix_mode', '1');

        // Short timeout for initial request
        const response = await fetchWithTimeout(url.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData,
            timeout: 10000
        });
        return await response.json();
    } catch (error) {
        return { message: error.message };
    }
}

async function verify_sendRequest(encryptedEmail, encryptedPassword, encryptedCode) {
    try {
        const originalDate = faker.date.birthdate()
        const dateObj = new Date(originalDate);
        const formattedDate = dateObj.toISOString().split('T')[0];
        const url = new URL('https://www.capcut.com/passport/web/email/register_verify_login/');
        const queryParams = {
            aid: '348188',
            account_sdk_source: 'web',
            language: 'en',
            verifyFp: 'verify_m7euzwhw_PNtb4tlY_I0az_4me0_9Hrt_sEBZgW5GGPdn',
            check_region: '1'
        };
        Object.entries(queryParams).forEach(([key, value]) => { url.searchParams.append(key, value); });

        const formData = new URLSearchParams();
        formData.append('mix_mode', '1');
        formData.append('email', encryptedEmail);
        formData.append('code', encryptedCode);
        formData.append('password', encryptedPassword);
        formData.append('type', '34');
        formData.append('birthday', formattedDate);
        formData.append('force_user_region', 'ID');
        formData.append('biz_param', '%7B%7D');
        formData.append('check_region', '1');
        formData.append('fixed_mix_mode', '1');

        const response = await fetchWithTimeout(url.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            body: formData,
            timeout: 15000
        });
        const data = await response.json();
        const cookies = response.headers.raw()['set-cookie'];
        return { data, cookies };
    } catch (error) {
        return { data: { message: error.message } };
    }
}

async function saveToFile(filename, data) {
    await fs.writeFile(filename, data, { flag: 'a' });
}

async function launchSharedBrowser() {
    return await puppeteer.launch({
        headless: process.env.NODE_ENV === 'production' ? 'new' : false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        defaultViewport: null
    });
}

async function joinSpace(browser, cookies, inviteUrl, socket, accountId) {
    if (!inviteUrl) return;

    // logToSocket(socket, `[${accountId}] Joining space...`, 'info');
    let context;
    try {
        context = await browser.createBrowserContext();
        const page = await context.newPage();

        if (cookies && cookies.length > 0) {
            const cookieObjects = cookies.map(c => {
                const [nameValue, ...rest] = c.split(';');
                const [name, ...valueParts] = nameValue.split('=');
                return {
                    name: name.trim(),
                    value: valueParts.join('=').trim(),
                    domain: '.capcut.com',
                    path: '/',
                };
            });
            await page.setCookie(...cookieObjects);
        }

        await page.goto(inviteUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await installPopupDismisser(page);

        const selector = "button.lv-btn.lv-btn-primary";
        // Fast fail if not found
        await page.waitForSelector(selector, { timeout: 8000 }).catch(() => { });

        await page.evaluate((sel) => {
            const btns = document.querySelectorAll(sel);
            for (const btn of btns) {
                if (btn.innerText.includes('Gửi')) {
                    btn.click();
                    return;
                }
            }
            if (btns.length > 0) btns[0].click();
        }, selector);

        logToSocket(socket, `[${accountId}] Joined space command sent!`, 'success');
        // Minimal delay to ensure click registered
        await new Promise(r => setTimeout(r, 1000));

    } catch (error) {
        logToSocket(socket, `[${accountId}] Join error: ${error.message}`, 'error');
    } finally {
        if (context) await context.close();
    }
}

async function processSingleAccount(jobId, domainList, customPassword, socket) {
    try {
        const domain = domainList[Math.floor(Math.random() * domainList.length)];
        const name = faker.internet.username().toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 5);
        const email = `${name}@${domain}`;

        logToSocket(socket, `[${jobId}] Started: ${email}`, 'info');

        const password = customPassword || APP_PASSWORD;
        const encryptedHexEmail = encryptToTargetHex(email);
        const encryptedHexPassword = encryptToTargetHex(password);

        const reqnya = await regist_sendRequest(encryptedHexEmail, encryptedHexPassword);

        if (reqnya && reqnya.message === "success") {
            let verificationCode;
            let attempts = 0;
            do {
                verificationCode = await functionGetLink(email.split('@')[0], email.split('@')[1]);
                if (!verificationCode) await new Promise(resolve => setTimeout(resolve, 3000)); // 3s wait
                attempts++;
                if (attempts > 20) break; // 60s max wait
            } while (!verificationCode);

            if (verificationCode) {
                const encryptedHexCode = encryptToTargetHex(verificationCode);
                const verifyData = await verify_sendRequest(encryptedHexEmail, encryptedHexPassword, encryptedHexCode);

                if (verifyData.data && verifyData.data.message === "success") {
                    await saveToFile('accounts.txt', `${email}|${password}\n`);
                    logToSocket(socket, `[${jobId}] SAVED: ${email}`, 'success');
                    if (socket) socket.emit('account-created', `${email}|${password}`);
                } else {
                    logToSocket(socket, `[${jobId}] Verify Failed: ${verifyData.data?.message}`, 'error');
                }
            } else {
                logToSocket(socket, `[${jobId}] Timeout waiting for email.`, 'error');
            }
        } else {
            logToSocket(socket, `[${jobId}] Register Req Failed.`, 'error');
        }
    } catch (error) {
        logToSocket(socket, `[${jobId}] Error: ${error.message}`, 'error');
    }
}

export async function runRegisterFlow(count, customPassword, socket) {
    logToSocket(socket, `Starting Parallel Registration (${count} accounts, ${CONCURRENCY_LIMIT} threads)`, 'info');

    const domainList = await getEmailRandom(socket);
    if (!domainList || domainList.length === 0) {
        logToSocket(socket, 'Network Error: Cannot fetch domains.', 'error');
        return;
    }

    // Queue of jobs: [1, 2, ..., count]
    const jobs = Array.from({ length: count }, (_, i) => i + 1);

    // Worker function: takes job from queue, processes, then takes next
    async function worker(workerId) {
        while (jobs.length > 0) {
            const currentJob = jobs.shift(); // take first job
            await processSingleAccount(currentJob, domainList, customPassword, socket);
        }
    }

    // Start CONCURRENCY_LIMIT workers
    const workers = [];
    for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
        workers.push(worker(i));
    }

    await Promise.all(workers);

    logToSocket(socket, 'ALL JOBS COMPLETED', 'success');
    if (socket) socket.emit('register-complete');
}

export async function runLoginFlow(accountList, inviteUrl, socket) {
    const concurrencyLimit = 3;
    logToSocket(socket, `Starting Stealth Login Loop (${accountList.length} accounts, Concurrent: ${concurrencyLimit})`, 'info');
    let browser;
    try {
        browser = await launchSharedBrowser();
    } catch (e) { return; }

    try {
        for (let i = 0; i < accountList.length; i += concurrencyLimit) {
            const batch = accountList.slice(i, i + concurrencyLimit);
            const promises = batch.map(async (accLine, idx) => {
                const globalIndex = i + idx;
                
                accLine = accLine.trim();
                if (!accLine) return;

                const parts = accLine.split('|');
                const email = parts[0];
                const password = parts[1] || APP_PASSWORD; 
                if (!email) return;

                logToSocket(socket, `[${globalIndex + 1}/${accountList.length}] Login: ${email}`, 'info');

                let context;
                try {
                    context = await browser.createBrowserContext();
                    const page = await context.newPage();

                    await page.setViewport({ width: 1366, height: 768 });

                    // --- STEP 1: UI LOGIN IN STEALTH BROWSER ---
                    await page.goto('https://www.capcut.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await installPopupDismisser(page);

                    const emailSelector = 'input.lv_sign_in_panel_wide-input, input.lv-input.lv_sign_in_panel_wide-input, input[placeholder*="email" i], input[placeholder*="Nhập email" i]';
                    try {
                        await page.waitForSelector(emailSelector, { timeout: 15000 });
                    } catch (e) {
                        throw new Error("Cannot find email field. See /error_login.png for screenshot.");
                    }

                    await page.click(emailSelector);
                    await page.type(emailSelector, email, { delay: 0 }); // Fast typing

                    await new Promise(r => setTimeout(r, 200));

                    const continueSelector = 'button.lv_sign_in_panel_wide-primary-button, button.lv-btn-primary';
                    try {
                        await page.waitForSelector(continueSelector, { timeout: 5000 });
                        await page.evaluate((sel) => {
                            const btns = document.querySelectorAll(sel);
                            for (const btn of btns) {
                                const text = btn.innerText.trim();
                                if (text.includes('Tiếp tục') || text.includes('Continue') || text.includes('Next') || text.includes('Lanjut')) {
                                    btn.click();
                                    return;
                                }
                            }
                            if (btns.length > 0) btns[0].click();
                        }, continueSelector);
                    } catch (e) {
                        await page.keyboard.press('Enter');
                    }

                    const passSelector = 'input[type="password"]';
                    try {
                        // Wait up to 15s for the password field to be visible since it transitions in
                        await page.waitForSelector(passSelector, { timeout: 15000, visible: true });
                    } catch (e) {
                        throw new Error("Cannot find password field. See /error_login.png for screenshot.");
                    }

                    await page.click(passSelector);
                    await page.type(passSelector, password, { delay: 0 }); // Fast typing
                    
                    await new Promise(r => setTimeout(r, 200));

                    const loginBtnSelector = 'button.lv_sign_in_panel_wide-sign-in-button, button.lv_sign_in_panel_wide-primary-button, button.lv-btn-primary';
                    try {
                        await page.evaluate((sel) => {
                            const btns = document.querySelectorAll(sel);
                            for (const btn of btns) {
                                const text = btn.innerText.trim();
                                if (text.includes('Đăng nhập') || text.includes('Log in') || text.includes('Login') || text.includes('Sign in') || text.includes('Masuk')) {
                                    btn.click();
                                    return;
                                }
                            }
                            if (btns.length > 0) btns[0].click();
                        }, loginBtnSelector);
                    } catch (e) {
                        await page.keyboard.press('Enter');
                    }

                    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                    await new Promise(r => setTimeout(r, 1500)); // Minor buffer for CapCut post-login redirect routing

                    // --- VERIFY LOGIN SUCCESS ---
                    const currentUrl = page.url();
                    const isStillOnLogin = currentUrl.includes('/login') || currentUrl.includes('/signup');
                    if (isStillOnLogin) {
                        const errorMsg = await page.evaluate(() => {
                            const errEl = document.querySelector('.semi-form-field-error-message, .error-message, [class*="error"], .text-red, [class*="lv_sign_in_panel_wide-error"]');
                            return errEl ? errEl.innerText : '';
                        }).catch(() => '');
                        logToSocket(socket, `[${globalIndex + 1}] Login FAILED: ${email} - ${errorMsg || 'Still on login page'}`, 'error');
                        if (socket) socket.emit('failed-account', accLine);
                        return; 
                    }

                    logToSocket(socket, `[${globalIndex + 1}] Login OK: ${email}`, 'info');

                    // --- STEP 2: JOIN TEAM VIA BROWSER (if URL provided) ---
                    if (inviteUrl) {
                        await page.goto(inviteUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        await installPopupDismisser(page);

                        const joinSelector = "button.lv-btn.lv-btn-primary";
                        const joinBtnFound = await page.waitForSelector(joinSelector, { timeout: 10000 }).catch(() => null);

                        if (!joinBtnFound) {
                            logToSocket(socket, `[${globalIndex + 1}] Join FAILED: ${email} - Join button not found on page`, 'error');
                            if (socket) socket.emit('failed-account', accLine);
                            return;
                        }

                        const clicked = await page.evaluate((sel) => {
                            const btns = document.querySelectorAll(sel);
                            for (const btn of btns) {
                                if (btn.innerText.includes('Gửi') || btn.innerText.includes('Join') || btn.innerText.includes('Accept') || btn.innerText.includes('Bergabung')) {
                                    btn.click();
                                    return true;
                                }
                            }
                            if (btns.length > 0) { btns[0].click(); return true; }
                            return false;
                        }, joinSelector);

                        if (!clicked) {
                            logToSocket(socket, `[${globalIndex + 1}] Join FAILED: ${email} - Could not auto-click join button`, 'error');
                            if (socket) socket.emit('failed-account', accLine);
                            return;
                        }

                        await new Promise(r => setTimeout(r, 1000));
                        logToSocket(socket, `[${globalIndex + 1}] Join Team Success: ${email}`, 'success');
                    }

                } catch (error) {
                    logToSocket(socket, `[${globalIndex + 1}] Failed API or Browser: ${error.message}`, 'error');
                    if (socket) socket.emit('failed-account', accLine);
                } finally {
                    if (context) await context.close();
                }
            });

            await Promise.all(promises);
        }
    } finally {
        if (browser) await browser.close();
        logToSocket(socket, 'Login Jobs Completed', 'success');
    }
}

async function processSingleGptAccount(jobId, domainList, browser, socket) {
    try {
        const domain = domainList[Math.floor(Math.random() * domainList.length)];
        const name = faker.internet.username().toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 5);
        const email = `${name}@${domain}`;
        const password = faker.internet.password({ length: 12, pattern: /[A-Za-z0-9!@#$]/ }) + "A1@"; // Ensure complexity

        logToSocket(socket, `[${jobId}] Started GPT: ${email}`, 'info');

        const context = await browser.createBrowserContext();
        const page = await context.newPage();

        // 1. Visit ChatGPT sign up
        await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Wait and click "Tạo tài khoản" or "Sign up"
        // Based on user screenshot: button.btn.relative.group-focus-within/dialog:focus-visible... btn-secondary
        const signupBtnSelector = "button.btn-secondary"; 
        await page.waitForSelector(signupBtnSelector, { timeout: 15000 });
        await page.evaluate((sel) => {
            const btns = document.querySelectorAll(sel);
            for (const btn of btns) {
                if (btn.innerText.includes('Tạo tài khoản') || btn.innerText.includes('Sign up')) {
                    btn.click();
                    return;
                }
            }
            if (btns.length > 0) btns[0].click();
        }, signupBtnSelector);

        // Wait for iframe/cross-domain navigation
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});

        // 2. Email input
        // Based on user screenshot: input#email
        const emailInputSelector = "input#email";
        await page.waitForSelector(emailInputSelector, { timeout: 15000 });
        await page.type(emailInputSelector, email);

        // Click Continue
        // Based on user screenshot: "Tiếp tục" button
        const continueBtnSelector = "button.btn-primary";
        await page.evaluate((sel) => { 
             const btns = document.querySelectorAll(sel);
             for(let btn of btns) {
                 if(btn.innerText.includes('Tiếp tục') || btn.innerText.includes('Continue')) {
                     btn.click(); return;
                 }
             }
         }, continueBtnSelector);

        // 3. Password input
        // Based on screenshot: input[name="new-password"]
        const passwordInputSelector = "input[name='new-password']";
        await page.waitForSelector(passwordInputSelector, { timeout: 15000 });
        await page.type(passwordInputSelector, password);

        // Click Continue
        await page.evaluate((sel, pwdSel) => { 
            // Try explicit "Tiếp tục"
            const btns = document.querySelectorAll(sel);
            for(let btn of btns) {
                if(btn.innerText.includes('Tiếp tục') || btn.innerText.includes('Continue')) {
                    btn.click(); return;
                }
            }
            // fallback: find submit button near the form
            document.querySelector("button[type='submit']")?.click();
         }, continueBtnSelector, passwordInputSelector);

        // 4. Wait for verification code step
        logToSocket(socket, `[${jobId}] Waiting for OpenAI verification email...`, 'info');
        
        let verificationCode = null;
        let attempts = 0;
        do {
            verificationCode = await functionGetGptCode(email.split('@')[0], email.split('@')[1]);
            if (!verificationCode) await new Promise(resolve => setTimeout(resolve, 5000)); // 5s wait
            attempts++;
            if (attempts > 24) break; // 120s max wait
        } while (!verificationCode);

        if (verificationCode) {
            logToSocket(socket, `[${jobId}] Got Code: ${verificationCode}`, 'success');
            
            // Enter code
            const codeInputSelector = "input.code-input, input[inputmode='numeric']";
            await page.waitForSelector(codeInputSelector, { timeout: 30000 });
            
            // OpenAI code usually is 6 inputs, typing naturally handles it or pasting.
            await page.type(codeInputSelector, verificationCode); 

            // 5. Fill out profile (Birthday screen based on screenshot)
            // User screenshot shows name is just part of the input, let's look for text inputs
            const textInputs = "input[type='text']";
            await page.waitForSelector(textInputs, { timeout: 30000 }).catch(()=>null);
            
            // Name field usually comes first
            const inputs = await page.$$(textInputs);
            if (inputs.length > 0) {
                 await inputs[0].type(faker.person.fullName());
            }

            // Birthday field is usually the second one or specific
            if(inputs.length > 1) {
                 const originalDate = faker.date.birthdate({ min: 18, max: 65, mode: 'age' });
                 const day = String(originalDate.getDate()).padStart(2, '0');
                 const month = String(originalDate.getMonth() + 1).padStart(2, '0');
                 const year = originalDate.getFullYear();
                 // Depends on format, assuming DD/MM/YYYY
                 await inputs[1].type(`${day}${month}${year}`); 
            }

            // Click "Hoàn tất tạo tài khoản" (Complete)
            // Based on screenshot: data-dd-action-name="Continue"
            const submitProfileSelector = "button[data-dd-action-name='Continue'], button[type='submit']";
            await page.evaluate((sel) => { document.querySelector(sel)?.click() }, submitProfileSelector);
            
            logToSocket(socket, `[${jobId}] Profile filled, waiting for completion...`, 'info');
            
            // Wait for a bit to ensure it actually went through to ChatGPT interface
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});

            // Save account
            await saveToFile('gpt_accounts.txt', `${email}|${password}\n`);
            logToSocket(socket, `[${jobId}] GPT SAVED: ${email}`, 'success');

        } else {
            logToSocket(socket, `[${jobId}] Failed to get verification code.` , 'error');
        }

        await context.close();

    } catch (error) {
        logToSocket(socket, `[${jobId}] Error: ${error.message}`, 'error');
    }
}

export async function runGptRegisterFlow(count, socket) {
    logToSocket(socket, `Starting Parallel GPT Registration (${count} accounts, ${CONCURRENCY_LIMIT} threads)`, 'info');

    const domainList = await getEmailRandom(socket);
    if (!domainList || domainList.length === 0) {
        logToSocket(socket, 'Network Error: Cannot fetch domains.', 'error');
        return;
    }

    logToSocket(socket, 'Launching main browser (GPT)...', 'info');
    let browser;
    try {
        browser = await launchSharedBrowser(); // standard headless: false browser via previous config
    } catch (e) {
        logToSocket(socket, 'Browser launch failed.', 'error');
        return;
    }

    const jobs = Array.from({ length: count }, (_, i) => i + 1);

    async function worker(workerId) {
        while (jobs.length > 0) {
            const currentJob = jobs.shift();
            await processSingleGptAccount(currentJob, domainList, browser, socket);
        }
    }

    const workers = [];
    for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
        workers.push(worker(i));
    }

    await Promise.all(workers);

    logToSocket(socket, 'Closing main browser (GPT)...', 'info');
    await browser.close();
    logToSocket(socket, 'ALL GPT JOBS COMPLETED', 'success');
}
