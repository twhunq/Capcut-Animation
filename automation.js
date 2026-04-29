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
const CONCURRENCY_LIMIT = parseInt(process.env.CONCURRENCY_LIMIT, 10) || 5; // Cloud: set CONCURRENCY_LIMIT=2 for 512MB RAM tiers.
const LOGIN_RETRY_MAX = 2; // Max retries per account for login flow

// Human-like random delay
function humanDelay(minMs, maxMs) {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(r => setTimeout(r, ms));
}

// Clear an input field completely before typing
async function clearAndType(page, selector, text, options = {}) {
    const input = await page.$(selector);
    if (!input) return false;
    await input.click({ clickCount: 3 }); // Select all
    await humanDelay(50, 150);
    await page.keyboard.press('Backspace');
    await humanDelay(50, 100);
    await input.type(text, { delay: options.delay || (Math.random() * 8 + 4) });
    return true;
}

// Detect CAPTCHA or verification challenge on page
async function detectCaptchaOrChallenge(page) {
    try {
        const indicators = await page.evaluate(() => {
            const text = document.body.innerText.toLowerCase();
            const html = document.body.innerHTML.toLowerCase();
            return {
                hasCaptcha: html.includes('captcha') || html.includes('recaptcha') || html.includes('hcaptcha') || html.includes('geetest'),
                hasSlider: !!document.querySelector('.captcha-slider, .geetest_slider, [class*="slider-captcha"], [class*="verify-slider"]'),
                hasPuzzle: html.includes('puzzle') || html.includes('verify your identity'),
                hasRateLimit: text.includes('too many') || text.includes('maximum') || text.includes('rate limit') || text.includes('try again later') || text.includes('quá nhiều'),
                hasSuspicious: text.includes('suspicious') || text.includes('unusual activity') || text.includes('đáng ngờ'),
            };
        });
        return indicators;
    } catch {
        return {};
    }
}

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

const withTimeout = (promise, ms, name = 'Puppeteer operation') => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        clearTimeout(timeoutId);
    });
};


// Install a background auto-clicker that dismisses CapCut popups (Terms of Service, etc.)
// This runs in the background via MutationObserver so it catches popups no matter when they appear.
async function installPopupDismisser(page) {
    if (!page) return;
    try {
        await withTimeout(page.evaluate(() => {
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
        }), 5000, 'installPopupDismisser');
    } catch (e) {
        // ignore Execution context destroyed or timeouts silently
    }
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
                    return true;
                } else {
                    logToSocket(socket, `[${jobId}] Verify Failed: ${verifyData.data?.message}`, 'error');
                    return false;
                }
            } else {
                logToSocket(socket, `[${jobId}] Timeout waiting for email.`, 'error');
                return false;
            }
        } else {
            logToSocket(socket, `[${jobId}] Register Req Failed: ${reqnya?.data?.description || reqnya?.message}`, 'error');
            return false;
        }
    } catch (error) {
        logToSocket(socket, `[${jobId}] Error: ${error.message}`, 'error');
        return false;
    }
}

export async function runRegisterFlow(count, customPassword, socket) {
    logToSocket(socket, `Starting Robust Parallel Registration (Target: ${count} accounts, ${CONCURRENCY_LIMIT} threads)`, 'info');

    const domainList = await getEmailRandom(socket);
    if (!domainList || domainList.length === 0) {
        logToSocket(socket, 'Network Error: Cannot fetch domains.', 'error');
        return;
    }

    let successfulCount = 0;
    let inProgressCount = 0;
    let jobIdCounter = 0;

    // Worker function: dynamic loop until target is met
    async function worker() {
        while (true) {
            if (successfulCount >= count) {
                return; // Goal reached
            }
            if (successfulCount + inProgressCount >= count) {
                // Wait and see if currently running jobs finish successfully
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            // Start a new registration attempt
            inProgressCount++;
            jobIdCounter++;
            const currentJobId = jobIdCounter;
            
            const success = await processSingleAccount(currentJobId, domainList, customPassword, socket);
            
            inProgressCount--;
            if (success) {
                successfulCount++;
            }
        }
    }

    // Start CONCURRENCY_LIMIT workers
    const workers = [];
    for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);

    logToSocket(socket, 'ALL JOBS COMPLETED', 'success');
    if (socket) socket.emit('register-complete');
}



async function nativeClick(page, selector, buttonTextMatches = null) {
    const btns = await page.$$(selector);
    for (const handle of btns) {
        if (buttonTextMatches) {
            const text = await page.evaluate(el => el.innerText, handle).catch(() => '');
            if (buttonTextMatches.some(m => text && text.includes(m))) {
                await handle.click().catch(() => {});
                return true;
            }
        } else {
            await handle.click().catch(() => {});
            return true;
        }
    }
    return false;
}

// --- Core login attempt for a single account (extracted for retry logic) ---
async function attemptLogin(page, email, password, accountLabel, socket) {
    // --- STEP 1: NAVIGATE TO LOGIN ---
    logToSocket(socket, `[${accountLabel}] Opening CapCut Login Page...`, 'info');
    await withTimeout(page.goto('https://www.capcut.com/login', { waitUntil: 'domcontentloaded', timeout: 45000 }), 50000, 'Goto login');
    await installPopupDismisser(page);
    await humanDelay(800, 1500); // Chờ trang render xong hoàn toàn

    // Kiểm tra CAPTCHA ngay từ đầu
    const captchaCheck = await detectCaptchaOrChallenge(page);
    if (captchaCheck.hasCaptcha || captchaCheck.hasSlider || captchaCheck.hasPuzzle) {
        throw new Error('CAPTCHA_DETECTED: CapCut đang yêu cầu xác minh CAPTCHA. Cần đổi IP/VPN.');
    }
    if (captchaCheck.hasRateLimit) {
        throw new Error('RATE_LIMITED: IP đã bị giới hạn. Cần đợi hoặc đổi mạng.');
    }

    // Wait for login form to appear - try multiple selectors with fallback
    const emailSelectors = [
        'input[name="signUsername"]',
        'input[type="email"]',
        'input[name="email"]',
        '.lv-input',
        'input[placeholder*="email" i]',
        'input[placeholder*="Email"]',
    ];
    
    let emailInputFound = null;
    for (const sel of emailSelectors) {
        emailInputFound = await page.waitForSelector(sel, { timeout: 3000 }).catch(() => null);
        if (emailInputFound) break;
    }
    
    if (!emailInputFound) {
        // Last resort: wait longer for any input
        emailInputFound = await page.waitForSelector('input', { timeout: 15000 }).catch(() => null);
        if (!emailInputFound) throw new Error('Không tìm thấy ô nhập email trên trang login.');
    }

    // --- NHẬP EMAIL (clear trước, type sau) ---
    await humanDelay(300, 600);
    // Click ô input trước
    await emailInputFound.click().catch(() => {});
    await humanDelay(100, 200);
    // Select all + delete để clear
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await humanDelay(100, 200);
    // Type từng ký tự giống người thật
    await emailInputFound.type(email, { delay: Math.random() * 12 + 6 });
    
    // --- BƯỚC CONTINUE (nếu có) ---
    await humanDelay(600, 1200); // Đợi React render
    
    const continueSelectors = [
        '.lv_sign_in_panel_wide-primary-button',
        'button[type="submit"]',
        'button.lv-btn-primary',
    ];
    
    let continueClicked = false;
    for (const sel of continueSelectors) {
        const btn = await page.$(sel).catch(() => null);
        if (btn) {
            const btnText = await page.evaluate(el => el.innerText, btn).catch(() => '');
            if (btnText.includes('Continue') || btnText.includes('Tiếp tục') || btnText.includes('Next')) {
                logToSocket(socket, `[${accountLabel}] Clicked Continue, waiting for Password field...`, 'info');
                // Gỡ disabled + click
                await page.evaluate((s) => {
                    const b = document.querySelector(s);
                    if (b) { b.removeAttribute('disabled'); b.click(); }
                }, sel);
                await btn.click().catch(() => {});
                continueClicked = true;
                break;
            }
        }
    }

    // --- NHẬP PASSWORD ---
    const passwordSelectors = [
        'input[name="signPassword"]',
        'input[type="password"]',
        'input[name="password"]',
        'input[placeholder*="password" i]',
    ];
    
    let passInputFound = null;
    const pwTimeout = continueClicked ? 30000 : 15000;
    
    for (const sel of passwordSelectors) {
        passInputFound = await page.waitForSelector(sel, { timeout: Math.min(pwTimeout, 8000) }).catch(() => null);
        if (passInputFound) break;
    }
    
    if (!passInputFound) {
        // Kiểm tra lại lỗi cụ thể
        const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
        if (pageText.includes('has not been registered') || pageText.includes('không tồn tại') || pageText.includes('not registered')) {
            throw new Error('ACCOUNT_NOT_EXIST: Tài khoản chưa đăng ký hoặc đã bị xóa.');
        }
        if (pageText.includes('Too many') || pageText.includes('Maximum') || pageText.includes('quá nhiều')) {
            throw new Error('RATE_LIMITED: IP bị giới hạn - quá nhiều lượt thử.');
        }
        // Kiểm tra CAPTCHA
        const captcha2 = await detectCaptchaOrChallenge(page);
        if (captcha2.hasCaptcha || captcha2.hasSlider) {
            throw new Error('CAPTCHA_DETECTED: CAPTCHA xuất hiện sau bước email.');
        }
        throw new Error(`Timeout chờ Mật khẩu. Page: ${pageText.substring(0, 120).replace(/\n/g, ' ')}...`);
    }
    
    await humanDelay(300, 500);
    // Clear + type password
    await passInputFound.click().catch(() => {});
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await humanDelay(100, 200);
    await passInputFound.type(password, { delay: Math.random() * 12 + 6 });

    logToSocket(socket, `[${accountLabel}] Typing done, clicking Login...`, 'info');
    await humanDelay(400, 800);
    
    // Click login button
    const loginBtnSelector = 'button[type="submit"], button.lv-btn-primary, .lv_sign_in_panel_wide-primary-button';
    await page.waitForSelector(loginBtnSelector, { timeout: 5000 }).catch(() => {});
    await nativeClick(page, loginBtnSelector, ['Log in', 'Đăng nhập', 'Sign in', 'Continue', 'Tiếp tục']).catch(() => {});
    
    logToSocket(socket, `[${accountLabel}] Validating login result...`, 'info');
    
    // Chờ login API response - dùng polling thay vì sleep cố định
    let loginSuccess = false;
    for (let check = 0; check < 8; check++) {
        await humanDelay(800, 1200);
        
        const currentUrl = page.url();
        // Nếu URL đã chuyển khỏi /login -> thành công
        if (!currentUrl.includes('/login') && !currentUrl.includes('/passport')) {
            loginSuccess = true;
            break;
        }
        
        // Kiểm tra CAPTCHA giữa chừng
        const midCaptcha = await detectCaptchaOrChallenge(page);
        if (midCaptcha.hasCaptcha || midCaptcha.hasSlider) {
            throw new Error('CAPTCHA_DETECTED: CAPTCHA xuất hiện sau khi bấm Login.');
        }
        
        // Kiểm tra error message
        const errText = await page.evaluate(() => document.body.innerText).catch(() => '');
        const errLower = errText.toLowerCase();
        if (errLower.includes('incorrect') || errLower.includes('sai mật khẩu') || errLower.includes('wrong password')) {
            throw new Error('WRONG_PASSWORD: Sai mật khẩu.');
        }
        if (errLower.includes('not exist') || errLower.includes('không tồn tại') || errLower.includes('not registered')) {
            throw new Error('ACCOUNT_NOT_EXIST: Tài khoản không tồn tại.');
        }
        if (errLower.includes('maximum number of attempts') || errLower.includes('too many attempts') || errLower.includes('too many')) {
            throw new Error('RATE_LIMITED: Quá nhiều lần thử đăng nhập.');
        }
    }
    
    // Fallback check: vẫn còn trên trang login?
    if (!loginSuccess) {
        const isStillLogin = await page.$('input[name="signPassword"], input[type="password"]').catch(() => null);
        if (isStillLogin) {
            throw new Error('LOGIN_FAILED: Vẫn ở trang login sau khi chờ. Có thể sai MK hoặc bị block.');
        }
    }
    
    logToSocket(socket, `[${accountLabel}] Login OK: ${email}`, 'success');
    return true; // Login thành công
}

// --- Core Join Team attempt (extracted for clarity) ---
async function attemptJoinTeam(page, email, inviteUrl, accountLabel, socket) {
    logToSocket(socket, `[${accountLabel}] Navigating to Space Invite...`, 'info');
    await withTimeout(page.goto(inviteUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }), 35000, 'Goto invite');
    await installPopupDismisser(page);
    await humanDelay(2000, 3500); // Đợi trang invite load xong

    // Kiểm tra link hết hạn
    const preText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const preTextLower = preText.toLowerCase();
    if (preTextLower.includes('expired') || preTextLower.includes('hết hạn') || preTextLower.includes("can't submit") || preTextLower.includes('không thể submit') || preTextLower.includes('invalid') || preTextLower.includes('not found')) {
        return { success: false, reason: 'Link Invite ĐÃ HẾT HẠN hoặc KHÔNG HỢP LỆ!' };
    }
    
    // Kiểm tra đã join rồi chưa
    if (preTextLower.includes('already') || preTextLower.includes('đã tham gia') || preTextLower.includes('already a member')) {
        return { success: true, reason: 'Đã là thành viên rồi (skip)' };
    }

    // Tìm nút Join với nhiều selectors
    const joinSelectors = [
        'button.lv-btn.lv-btn-primary',
        'button.lv-btn-primary',
        'button[class*="primary"]',
    ];
    
    let joinBtnFound = null;
    for (const sel of joinSelectors) {
        joinBtnFound = await page.waitForSelector(sel, { timeout: 5000 }).catch(() => null);
        if (joinBtnFound) break;
    }

    if (!joinBtnFound) {
        return { success: false, reason: 'Không tìm thấy nút Join trên trang invite.' };
    }

    // Click nút Join
    let clicked = await nativeClick(page, 'button.lv-btn.lv-btn-primary', ['Gửi', 'Join', 'Accept', 'Bergabung', 'Tham gia', 'Submit', 'Request']);
    if (!clicked) {
        clicked = await nativeClick(page, 'button.lv-btn-primary');
    }
    if (!clicked) {
        // Fallback: click bất kỳ primary button nào
        clicked = await page.evaluate(() => {
            const btns = document.querySelectorAll('button');
            for (const btn of btns) {
                if (btn.className.includes('primary') && btn.offsetParent !== null) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });
    }

    if (!clicked) {
        return { success: false, reason: 'Không thể click nút Join.' };
    }

    await humanDelay(2500, 4000); // Chờ response từ server

    // Kiểm tra kết quả
    const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const ptLower = pageText.toLowerCase();
    
    if (ptLower.includes('full') || ptLower.includes('giới hạn') || ptLower.includes('limit') || ptLower.includes('không thể tham gia') || ptLower.includes('cannot join')) {
        return { success: false, reason: 'Nhóm ĐÃ ĐẦY hoặc không thể join.' };
    }
    
    // Kiểm tra "Pending" / "Submitted" / "Success"
    if (ptLower.includes('pending') || ptLower.includes('submitted') || ptLower.includes('success') || ptLower.includes('đã gửi') || ptLower.includes('thành công')) {
        return { success: true, reason: 'Join request submitted!' };
    }
    
    // Nếu không có lỗi rõ ràng, coi như thành công
    return { success: true, reason: 'Join command sent (no error detected).' };
}

export async function runLoginFlow(accountList, inviteUrl, socket) {
    const LOGIN_CONCURRENCY = CONCURRENCY_LIMIT; // 5 luồng song song
    logToSocket(socket, `Starting Parallel Login Flow (${accountList.length} accounts, ${LOGIN_CONCURRENCY} threads, Max ${LOGIN_RETRY_MAX} retries each)`, 'info');

    let browser = null;
    let rateLimitHitCount = 0;
    let abortAll = false; // Flag to stop all workers
    const MAX_RATE_LIMIT_BEFORE_ABORT = 3;
    
    try {
        logToSocket(socket, 'Launching stealth browser (headless)...', 'info');
        browser = await puppeteer.launch({
            headless: 'new', // Ẩn tab như reg tài khoản
            args: [
                '--no-sandbox', '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', '--disable-gpu',
                '--window-size=1280,720',
                '--disable-blink-features=AutomationControlled',
            ],
            defaultViewport: { width: 1280, height: 720 }
        });
    } catch (e) {
        logToSocket(socket, 'Browser launch failed: ' + e.message, 'error');
        return;
    }

    let successCount = 0;
    let failCount = 0;

    // Build job queue from account list
    const jobQueue = [];
    for (let i = 0; i < accountList.length; i++) {
        const accLine = accountList[i].trim();
        if (!accLine) continue;
        const parts = accLine.split('|');
        const email = parts[0];
        const password = parts[1] || APP_PASSWORD;
        if (!email) continue;
        jobQueue.push({ index: i, total: accountList.length, email, password, accLine });
    }

    // Worker function — each worker picks jobs from shared queue
    async function worker(workerId) {
        while (jobQueue.length > 0 && !abortAll) {
            const job = jobQueue.shift();
            if (!job) break;

            // Check rate limit abort flag
            if (abortAll) {
                if (socket) socket.emit('failed-account', job.accLine);
                failCount++;
                continue;
            }

            const accountLabel = `W${workerId}-${job.index + 1}/${job.total}`;
            logToSocket(socket, `[${accountLabel}] Login: ${job.email}`, 'info');

            let accountSuccess = false;

            // === RETRY LOOP ===
            for (let attempt = 1; attempt <= LOGIN_RETRY_MAX; attempt++) {
                if (abortAll) break;

                let context;
                try {
                    context = await browser.createBrowserContext();
                    const page = await context.newPage();
                    
                    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                    
                    if (attempt > 1) {
                        logToSocket(socket, `[${accountLabel}] ↻ Retry #${attempt}...`, 'warn');
                    }

                    // Attempt login
                    await attemptLogin(page, job.email, job.password, accountLabel, socket);

                    // Login thành công -> Join Team
                    rateLimitHitCount = 0;
                    
                    if (inviteUrl) {
                        const joinResult = await attemptJoinTeam(page, job.email, inviteUrl, accountLabel, socket);
                        
                        if (joinResult.success) {
                            logToSocket(socket, `[${accountLabel}] ✓ Join Team Success: ${job.email} — ${joinResult.reason}`, 'success');
                            accountSuccess = true;
                        } else {
                            logToSocket(socket, `[${accountLabel}] ✗ Join FAILED: ${job.email} — ${joinResult.reason}`, 'error');
                            accountSuccess = false;
                        }
                    } else {
                        accountSuccess = true;
                    }
                    
                    break; // Exit retry loop on success

                } catch (error) {
                    const errMsg = error.message || '';
                    
                    if (errMsg.includes('RATE_LIMITED')) {
                        rateLimitHitCount++;
                        logToSocket(socket, `[${accountLabel}] ⚠ RATE LIMIT (${rateLimitHitCount}/${MAX_RATE_LIMIT_BEFORE_ABORT}): ${errMsg}`, 'error');
                        
                        if (rateLimitHitCount >= MAX_RATE_LIMIT_BEFORE_ABORT) {
                            logToSocket(socket, `⚠️ ĐÃ BỊ RATE LIMIT ${rateLimitHitCount} LẦN. Dừng tất cả workers!`, 'error');
                            abortAll = true;
                            break;
                        }
                        
                        logToSocket(socket, `[${accountLabel}] ⏳ Chờ 15-25 giây trước khi thử lại...`, 'warn');
                        await humanDelay(15000, 25000);
                        
                    } else if (errMsg.includes('CAPTCHA_DETECTED')) {
                        rateLimitHitCount++;
                        logToSocket(socket, `[${accountLabel}] 🤖 CAPTCHA detected! Cần đổi IP.`, 'error');
                        if (attempt >= LOGIN_RETRY_MAX) break;
                        logToSocket(socket, `[${accountLabel}] ⏳ Chờ 20-30 giây rồi thử lại...`, 'warn');
                        await humanDelay(20000, 30000);
                        
                    } else if (errMsg.includes('ACCOUNT_NOT_EXIST')) {
                        logToSocket(socket, `[${accountLabel}] ✗ Tài khoản không tồn tại: ${job.email} — Bỏ qua.`, 'error');
                        break;
                        
                    } else if (errMsg.includes('WRONG_PASSWORD')) {
                        logToSocket(socket, `[${accountLabel}] ✗ Sai mật khẩu: ${job.email} — Bỏ qua.`, 'error');
                        break;
                        
                    } else {
                        logToSocket(socket, `[${accountLabel}] Error (attempt ${attempt}/${LOGIN_RETRY_MAX}): ${errMsg}`, 'error');
                        if (attempt < LOGIN_RETRY_MAX) {
                            logToSocket(socket, `[${accountLabel}] ⏳ Chờ 5-10 giây trước khi retry...`, 'warn');
                            await humanDelay(5000, 10000);
                        }
                    }
                    
                } finally {
                    if (context) await context.close().catch(() => {});
                }
            }
            // === END RETRY LOOP ===

            if (accountSuccess) {
                successCount++;
            } else {
                failCount++;
                if (socket) socket.emit('failed-account', job.accLine);
            }

            // Nếu bị abort, đánh dấu tất cả job còn lại là failed
            if (abortAll) {
                while (jobQueue.length > 0) {
                    const remaining = jobQueue.shift();
                    if (remaining && socket) socket.emit('failed-account', remaining.accLine);
                    failCount++;
                }
                break;
            }

            // Cooldown ngắn giữa các account (1-3s thay vì 2-5s vì đã chia nhỏ ra 5 workers)
            if (jobQueue.length > 0) {
                const delayMs = Math.floor(Math.random() * 2000) + 1000;
                await new Promise(r => setTimeout(r, delayMs));
            }
        }
    }

    try {
        // Start LOGIN_CONCURRENCY workers in parallel
        const workers = [];
        for (let i = 0; i < Math.min(LOGIN_CONCURRENCY, jobQueue.length); i++) {
            workers.push(worker(i + 1));
        }
        await Promise.all(workers);
    } finally {
        if (browser) await browser.close().catch(() => {});
        logToSocket(socket, `✅ Login Jobs Completed — Thành công: ${successCount}, Thất bại: ${failCount}`, 'success');
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


// ============================================================
// =================== GROK REGISTRATION ======================
// ============================================================

async function functionGetGrokCode(email, domain) {
    try {
        const res = await fetchWithTimeout('https://generator.email/', {
            headers: {
                'cookie': `_gid=GA1.2.989703044.1735637209; embx=%5B%22xaviermoen51%40dogonoithatlienha.com%22%5D; _ga=GA1.1.1696815852.1733235907; surl=${domain}%2F${email}`,
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            method: 'GET'
        });

        const text = await res.text();
        const $ = cheerio.load(text);

        // Check for xAI / Grok confirmation email
        const emailContent = $("#email-table").text();
        if (emailContent.includes('xAI') || emailContent.includes('x.ai') || emailContent.includes('Validate your email') || emailContent.includes('confirmation code')) {
            // The code format is XXX-XXX (e.g., VM6-QFZ) — 6 alphanumeric chars with dash
            // Look in the email body for the code pattern
            const bodyText = $(".e7m.mess_bodiyy").text();
            
            // Try to match code format: 3 chars, dash, 3 chars (uppercase alphanumeric)
            const codeMatch = bodyText.match(/\b([A-Z0-9]{3})-([A-Z0-9]{3})\b/);
            if (codeMatch) {
                // Return the full code with dash for display, and raw for input
                return {
                    display: `${codeMatch[1]}-${codeMatch[2]}`,
                    raw: `${codeMatch[1]}${codeMatch[2]}` // 6 chars without dash for OTP input
                };
            }

            // Also try from subject line: "3KH-WKI xAI confirmation code"
            const subjectText = $(".e7m.col-md-12.ma1").text();
            const subjectMatch = subjectText.match(/([A-Z0-9]{3})-([A-Z0-9]{3})\s*xAI/);
            if (subjectMatch) {
                return {
                    display: `${subjectMatch[1]}-${subjectMatch[2]}`,
                    raw: `${subjectMatch[1]}${subjectMatch[2]}`
                };
            }
        }
        return null;
    } catch (err) {
        return null;
    }
}

async function processSingleGrokAccount(jobId, domainList, browser, customPassword, socket) {
    let context;
    try {
        const domain = domainList[Math.floor(Math.random() * domainList.length)];
        const name = faker.internet.username().toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 8);
        const email = `${name}@${domain}`;
        const password = customPassword || 'Marine12345@';
        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();

        logToSocket(socket, `[${jobId}] Started Grok: ${email}`, 'info');

        context = await browser.createBrowserContext();
        const page = await context.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // ===== STEP 1: Go to sign-up page =====
        logToSocket(socket, `[${jobId}] Opening Grok Sign-up...`, 'info');
        await page.goto('https://accounts.x.ai/sign-up', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await humanDelay(1500, 3000);

        // Click "Đăng ký bằng email" / "Sign up with email"
        const emailSignupBtnFound = await page.evaluate(() => {
            const btns = document.querySelectorAll('button');
            for (const btn of btns) {
                const text = btn.innerText.toLowerCase();
                if (text.includes('email') && (text.includes('sign up') || text.includes('đăng ký'))) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });

        if (!emailSignupBtnFound) {
            // Fallback: try finding by class structure from screenshot
            await nativeClick(page, 'button.relative.isolate', ['email', 'Email']).catch(() => {});
        }

        logToSocket(socket, `[${jobId}] Clicked "Sign up with email"`, 'info');
        await humanDelay(1500, 2500);

        // ===== STEP 2: Enter email =====
        const emailInputSelector = 'input[name="email"], input[type="email"], input[autocomplete="email"]';
        const emailInput = await page.waitForSelector(emailInputSelector, { timeout: 15000 });
        
        if (!emailInput) {
            throw new Error('Không tìm thấy ô nhập email trên trang Grok sign-up.');
        }

        await humanDelay(300, 600);
        await emailInput.click();
        await humanDelay(100, 200);
        await emailInput.type(email, { delay: Math.random() * 15 + 8 });
        
        logToSocket(socket, `[${jobId}] Entered email: ${email}`, 'info');
        await humanDelay(500, 1000);

        // Click "Đăng ký" / "Sign up" submit button
        const submitClicked = await page.evaluate(() => {
            const btns = document.querySelectorAll('button[type="submit"], button');
            for (const btn of btns) {
                const text = btn.innerText.trim().toLowerCase();
                if (text === 'đăng ký' || text === 'sign up' || text === 'continue' || text === 'tiếp tục') {
                    btn.click();
                    return true;
                }
            }
            // Fallback: click first submit button
            const submitBtn = document.querySelector('button[type="submit"]');
            if (submitBtn) { submitBtn.click(); return true; }
            return false;
        });

        if (!submitClicked) {
            throw new Error('Không tìm thấy nút Đăng ký.');
        }

        logToSocket(socket, `[${jobId}] Submitted email, waiting for verification code...`, 'info');
        await humanDelay(3000, 5000);

        // Check for errors (email already registered, etc.)
        const pageTextAfterSubmit = await page.evaluate(() => document.body.innerText).catch(() => '');
        if (pageTextAfterSubmit.includes('already') || pageTextAfterSubmit.includes('đã được sử dụng') || pageTextAfterSubmit.includes('already registered')) {
            throw new Error(`Email ${email} đã được đăng ký trước đó.`);
        }

        // ===== STEP 3: Get verification code from generator.email =====
        logToSocket(socket, `[${jobId}] Polling generator.email for xAI code...`, 'info');
        
        let verificationCode = null;
        let attempts = 0;
        const maxAttempts = 30; // 150s max wait
        
        do {
            verificationCode = await functionGetGrokCode(email.split('@')[0], email.split('@')[1]);
            if (!verificationCode) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // 5s between polls
            }
            attempts++;
            if (attempts > maxAttempts) break;
        } while (!verificationCode);

        if (!verificationCode) {
            throw new Error(`Timeout: Không nhận được mã xác minh sau ${maxAttempts * 5}s.`);
        }

        logToSocket(socket, `[${jobId}] Got xAI Code: ${verificationCode.display}`, 'success');

        // ===== STEP 4: Enter OTP code =====
        // The OTP input uses data-input-otp library — single input with maxlength=6
        const otpInputSelector = 'input[data-input-otp="true"], input[autocomplete="one-time-code"], input[maxlength="6"]';
        const otpInput = await page.waitForSelector(otpInputSelector, { timeout: 15000 }).catch(() => null);
        
        if (otpInput) {
            await otpInput.click();
            await humanDelay(200, 400);
            // Type the 6-char code (without dash)
            await otpInput.type(verificationCode.raw, { delay: Math.random() * 50 + 30 });
        } else {
            // Fallback: try typing into any focused input
            await page.keyboard.type(verificationCode.raw, { delay: Math.random() * 50 + 30 });
        }

        logToSocket(socket, `[${jobId}] Entered verification code, waiting...`, 'info');
        await humanDelay(2000, 3000);

        // Click "Confirmer l'e-mail" / "Confirm email" / "Xác nhận"
        await page.evaluate(() => {
            const btns = document.querySelectorAll('button[type="submit"], button');
            for (const btn of btns) {
                const text = btn.innerText.trim().toLowerCase();
                if (text.includes('confirm') || text.includes('xác nhận') || text.includes('verify') || text.includes('xác minh') || text.includes('continue') || text.includes('tiếp tục')) {
                    btn.click();
                    return;
                }
            }
            // Fallback
            document.querySelector('button[type="submit"]')?.click();
        });

        logToSocket(socket, `[${jobId}] Confirmed code, waiting for profile form...`, 'info');
        await humanDelay(3000, 5000);

        // ===== STEP 5: Complete registration - Name + Password =====
        // Wait for the "Hoàn tất đăng ký" page
        // From screenshot: First name and Last name inputs, then Password
        
        // Try to find name inputs
        const nameInputSelector = 'input[type="text"], input[name*="name" i], input[autocomplete*="name" i]';
        await page.waitForSelector(nameInputSelector, { timeout: 20000 }).catch(() => null);
        await humanDelay(500, 1000);

        // Get all text inputs on the page
        const textInputs = await page.$$(nameInputSelector);
        
        if (textInputs.length >= 2) {
            // First name
            await textInputs[0].click();
            await humanDelay(100, 200);
            await textInputs[0].type(firstName, { delay: Math.random() * 12 + 6 });
            
            await humanDelay(300, 600);
            
            // Last name
            await textInputs[1].click();
            await humanDelay(100, 200);
            await textInputs[1].type(lastName, { delay: Math.random() * 12 + 6 });
            
            logToSocket(socket, `[${jobId}] Entered name: ${firstName} ${lastName}`, 'info');
        } else if (textInputs.length === 1) {
            // Single name field
            await textInputs[0].click();
            await humanDelay(100, 200);
            await textInputs[0].type(`${firstName} ${lastName}`, { delay: Math.random() * 12 + 6 });
        }

        await humanDelay(400, 800);

        // Password input
        const passwordSelector = 'input[type="password"], input[name="password"], input[autocomplete="new-password"]';
        const passInput = await page.waitForSelector(passwordSelector, { timeout: 10000 }).catch(() => null);
        
        if (passInput) {
            await passInput.click();
            await humanDelay(100, 200);
            await passInput.type(password, { delay: Math.random() * 12 + 6 });
            logToSocket(socket, `[${jobId}] Entered password`, 'info');
        }

        await humanDelay(1000, 2000);

        // ===== STEP 6: Wait for and click Cloudflare Turnstile =====
        logToSocket(socket, `[${jobId}] Waiting for Cloudflare Turnstile...`, 'warn');
        
        try {
            await humanDelay(2000, 3000); // Wait for the turnstile to fully render
            
            // Ensure we target a VISIBLE Turnstile iframe
            const iframeSelector = 'iframe[src*="challenge-platform"], iframe[title*="Widget"], iframe[src*="turnstile"]';
            const iframeHandle = await page.waitForSelector(iframeSelector, { visible: true, timeout: 15000 });
            
            if (iframeHandle) {
                logToSocket(socket, `[${jobId}] Chuyển focus vào màn hình Turnstile...`, 'info');
                
                await page.evaluate((el) => { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, iframeHandle);
                await humanDelay(1500, 2000);

                let isClicked = false;

                // Method 1: Inject click into the iframe context directly
                const frame = await iframeHandle.contentFrame();
                if (frame) {
                    try {
                        const cb = await frame.$('input[type="checkbox"], body');
                        if (cb) {
                            await cb.click({ delay: Math.random() * 50 + 40 });
                            logToSocket(socket, `[${jobId}] Đã click thông qua Iframe Context gốc.`, 'info');
                            isClicked = true;
                        }
                    } catch(err) {
                        // Ignore inner click error
                    }
                }

                // Method 2: Natural Mouse Emulation fallback
                if (!isClicked) {
                    logToSocket(socket, `[${jobId}] Dùng chuột ảo di chuyển tới Checkbox...`, 'info');
                    const box = await iframeHandle.boundingBox();
                    if (box && box.width > 0) {
                        // Turnstile checkbox is on the left, add slight random float mapping
                        const targetX = box.x + 25 + (Math.random() * 10); 
                        const targetY = box.y + (box.height / 2) + (Math.random() * 6 - 3);

                        // Move roughly to the center of iframe first
                        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
                        await humanDelay(100, 250);
                        // Slide to the checkbox
                        await page.mouse.move(targetX, targetY, { steps: 10 });
                        await humanDelay(100, 200);

                        await page.mouse.down();
                        await humanDelay(Math.random() * 60 + 30);
                        await page.mouse.up();
                        logToSocket(socket, `[${jobId}] Đã mô phỏng click vật lý vào tọa độ (${targetX.toFixed(0)}, ${targetY.toFixed(0)}).`, 'info');
                    }
                }
                
                await humanDelay(3000, 5000); // Wait for verification to complete
            }
        } catch (e) {
            logToSocket(socket, `[${jobId}] Error trying to click Turnstile: ${e.message}`, 'warn');
        }

        logToSocket(socket, `[${jobId}] Waiting for Turnstile to pass (up to 30s)...`, 'warn');
        
        let turnstilePassed = false;
        for (let t = 0; t < 30; t++) {
            const cfStatus = await page.evaluate(() => {
                // Cloudflare injects this hidden field. If it has a value, user is verified.
                const responseInput = document.querySelector('[name="cf-turnstile-response"]');
                if (responseInput && responseInput.value) return 'passed';
                
                const text = document.body.innerText.toLowerCase();
                // "success" text is sometimes shown in the iframe but we can't always read it cross-origin
                if (text.includes('thành công') || text.includes('success')) return 'passed';
                
                return 'waiting';
            });
            
            if (cfStatus === 'passed') {
                turnstilePassed = true;
                logToSocket(socket, `[${jobId}] ✓ Cloudflare Turnstile passed!`, 'success');
                break;
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        if (!turnstilePassed) {
            logToSocket(socket, `[${jobId}] ⚠ Cloudflare chưa pass, thử submit anyway...`, 'warn');
        }

        await humanDelay(500, 1000);

        // ===== STEP 7: Click "Hoàn tất đăng ký" / "Complete registration" =====
        const finalSubmit = await page.evaluate(() => {
            const btns = document.querySelectorAll('button[type="submit"], button');
            for (const btn of btns) {
                const text = btn.innerText.trim().toLowerCase();
                if (text.includes('hoàn tất') || text.includes('complete') || text.includes('finish') || text.includes('create') || text.includes('tạo') || text.includes('đăng ký')) {
                    btn.click();
                    return true;
                }
            }
            const submitBtn = document.querySelector('button[type="submit"]');
            if (submitBtn) { submitBtn.click(); return true; }
            return false;
        });

        if (finalSubmit) {
            logToSocket(socket, `[${jobId}] Clicked "Hoàn tất đăng ký"...`, 'info');
        }

        // Wait for completion
        await humanDelay(3000, 5000);

        // Check if registration succeeded
        const finalUrl = page.url();
        const finalPageText = await page.evaluate(() => document.body.innerText).catch(() => '');
        
        const hasError = finalPageText.toLowerCase().includes('error') || 
                         finalPageText.toLowerCase().includes('lỗi') ||
                         finalPageText.toLowerCase().includes('failed');
        const stillOnSignup = finalUrl.includes('/sign-up');

        if (hasError && stillOnSignup) {
            throw new Error(`Đăng ký không thành công. URL: ${finalUrl}`);
        }

        // SAVE ACCOUNT
        const accountLine = `${email}|${password}`;
        await saveToFile('grok_accounts.txt', `${accountLine}\n`);
        logToSocket(socket, `[${jobId}] ✅ GROK SAVED: ${email} | ${firstName} ${lastName}`, 'success');
        if (socket) socket.emit('grok-account-created', accountLine);
        return true;

    } catch (error) {
        logToSocket(socket, `[${jobId}] ✗ Grok Error: ${error.message}`, 'error');
        return false;
    } finally {
        if (context) await context.close().catch(() => {});
    }
}

export async function runGrokRegisterFlow(count, customPassword, socket) {
    logToSocket(socket, `Starting Grok Registration (Target: ${count} accounts)`, 'info');

    const domainList = await getEmailRandom(socket);
    if (!domainList || domainList.length === 0) {
        logToSocket(socket, 'Network Error: Cannot fetch email domains.', 'error');
        if (socket) socket.emit('grok-register-complete');
        return;
    }
    logToSocket(socket, `Fetched ${domainList.length} email domains`, 'info');

    logToSocket(socket, 'Launching stealth browser for Grok...', 'info');
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: process.env.NODE_ENV === 'production' ? 'new' : false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--window-size=1280,720',
                '--disable-blink-features=AutomationControlled',
                '--disable-site-isolation-trials',
                '--disable-features=IsolateOrigins,site-per-process'
            ],
            defaultViewport: null
        });
    } catch (e) {
        logToSocket(socket, 'Browser launch failed: ' + e.message, 'error');
        if (socket) socket.emit('grok-register-complete');
        return;
    }

    let successCount = 0;
    let failCount = 0;
    // Run sequentially for stability (xAI is strict with rate limiting)
    const GROK_CONCURRENCY = 1;

    const jobs = Array.from({ length: count }, (_, i) => i + 1);

    async function worker() {
        while (jobs.length > 0) {
            const currentJob = jobs.shift();
            const success = await processSingleGrokAccount(currentJob, domainList, browser, customPassword, socket);
            if (success) {
                successCount++;
            } else {
                failCount++;
            }
            // Cooldown between accounts
            if (jobs.length > 0) {
                const cooldown = Math.floor(Math.random() * 3000) + 3000; // 3-6s
                logToSocket(socket, `[${currentJob}] ⏳ Cooldown ${(cooldown/1000).toFixed(1)}s before next...`, 'info');
                await new Promise(r => setTimeout(r, cooldown));
            }
        }
    }

    const workers = [];
    for (let i = 0; i < GROK_CONCURRENCY; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);

    logToSocket(socket, 'Closing browser (Grok)...', 'info');
    await browser.close().catch(() => {});
    logToSocket(socket, `✅ Grok Registration Complete — Thành công: ${successCount}, Thất bại: ${failCount}`, 'success');
    if (socket) socket.emit('grok-register-complete');
}
