import fetch from "node-fetch";

function enc(i){let h='';for(const c of i){h+=(c.charCodeAt(0)^0x05).toString(16).padStart(2,'0')}return h}

const e = enc('huber@risanmedia.id');
const p = enc('marinecapcut');

async function test(label, qStr, endpointDomain) {
    const fd = new URLSearchParams();
    fd.append('mix_mode', '1');
    fd.append('email', e);
    fd.append('password', p);
    fd.append('fixed_mix_mode', '1');
    
    const url = `https://${endpointDomain}/passport/web/email/login/?` + qStr;
    const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
        body: fd
    });
    const d = await r.json();
    console.log(`${label} => ${d.message} | ${d.data?.description || d.data?.error_code || ''}`);
    if (d.message === 'success') console.log('SUCCESS!');
}

async function run() {
    const baseQ = 'aid=348188&account_sdk_source=web&language=en&verifyFp=verify_test';
    
    // 1. Without check_region
    await test('No region checks', baseQ, 'www.capcut.com');
    
    // 2. With force_user_region=ID
    await test('Force ID', baseQ + '&check_region=1&force_user_region=ID', 'www.capcut.com');
    
    // 3. Try the login.us endpoint
    await test('US Endpoint', baseQ + '&check_region=1', 'login.us.capcut.com');
    
    // 4. Try login.row endpoint (Rest of World)
    await test('ROW Endpoint', baseQ + '&check_region=1', 'login-row.www.capcut.com');
}

run();
