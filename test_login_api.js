import fetch from "node-fetch";
import { writeFileSync } from 'fs';

function enc(i){let h='';for(const c of i){h+=(c.charCodeAt(0)^0x05).toString(16).padStart(2,'0')}return h}

const email = 'huber@risanmedia.id';
const password = 'marinecapcut';
const e = enc(email);
const p = enc(password);
const results = [];

async function tryLogin(label, endpoint, params, extraQuery) {
    const q = new URLSearchParams({
        aid: '348188',
        account_sdk_source: 'web',
        language: 'en',
        verifyFp: 'verify_test',
        check_region: '1',
        ...(extraQuery || {})
    });
    const fd = new URLSearchParams(params);
    try {
        const r = await fetch(endpoint + '?' + q.toString(), {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded', 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Origin': 'https://www.capcut.com',
                'Referer': 'https://www.capcut.com/login'
            },
            body: fd
        });
        const d = await r.json();
        const ck = r.headers.raw()['set-cookie'];
        results.push({ label, msg: d.message, desc: d.data?.description, err: d.data?.error_code, cookies: ck ? ck.length : 0 });
        if (d.message === 'success') {
            results.push({ label: label + '_SUCCESS', data: d, cookiesSample: ck?.slice(0, 2) });
        }
    } catch(err) {
        results.push({ label, error: err.message });
    }
}

const loginUrl = 'https://www.capcut.com/passport/web/email/login/';

// The issue is likely that mix_mode=1 with XOR encryption might not match what the CapCut login page actually sends.
// Registration uses type=34, login might use a different type value.

// Test: encrypted email without type
await tryLogin('enc_noType', loginUrl, { mix_mode:'1', email:e, password:p, fixed_mix_mode:'1' });

// Test: encrypted email with type=8 (email login type in ByteDance system)
await tryLogin('enc_type8', loginUrl, { mix_mode:'1', email:e, password:p, type:'8', fixed_mix_mode:'1' });

// Test: try using 'mobile_or_email' field
await tryLogin('enc_mobileOrEmail', loginUrl, { mix_mode:'1', mobile_or_email:e, password:p, fixed_mix_mode:'1' });

// Test: mix_mode=1 but fixed_mix_mode not set
await tryLogin('enc_noFixedMix', loginUrl, { mix_mode:'1', email:e, password:p });

// Test: The XOR key might be different for login. Let's try without encryption but with mix_mode=1
await tryLogin('plain_mix1', loginUrl, { mix_mode:'1', email:email, password:password, fixed_mix_mode:'1' });

// Test: Maybe the XOR key is different. Try XOR with 0x01 instead of 0x05 
function enc2(i, key){let h='';for(const c of i){h+=(c.charCodeAt(0)^key).toString(16).padStart(2,'0')}return h}

await tryLogin('enc_xor01', loginUrl, { mix_mode:'1', email:enc2(email,0x01), password:enc2(password,0x01), fixed_mix_mode:'1' });
await tryLogin('enc_xor03', loginUrl, { mix_mode:'1', email:enc2(email,0x03), password:enc2(password,0x03), fixed_mix_mode:'1' });

// Test: Try the register_verify_login endpoint but as login (since it's named register_verify_LOGIN)
// The existing register flow endpoint name suggests it can also do login
const regVerifyUrl = 'https://www.capcut.com/passport/web/email/register_verify_login/';
await tryLogin('regVerify_login', regVerifyUrl, { mix_mode:'1', email:e, password:p, type:'34', fixed_mix_mode:'1' });

writeFileSync('test_out.txt', JSON.stringify(results, null, 2), 'utf-8');
console.log('DONE');
