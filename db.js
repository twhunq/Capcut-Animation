import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('⚠️  SUPABASE_URL / SUPABASE_KEY chưa được set — tính năng quản lý tài khoản sẽ không hoạt động.');
}

const supabase = (SUPABASE_URL && SUPABASE_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
    : null;

const COOLDOWN_DAYS = 7;
const BATCH_MAX = 29;
const EXPIRED_RETENTION_DAYS = 90;

function isExpired(row, now = Date.now()) {
    const addedAt = new Date(row.added_at).getTime();
    return addedAt + row.ttl_days * 86400_000 <= now;
}

function classify(row, now = Date.now()) {
    if (isExpired(row, now)) return 'expired';

    const lastFailed = row.last_failed_at ? new Date(row.last_failed_at).getTime() : 0;
    const lastJoined = row.last_joined_at ? new Date(row.last_joined_at).getTime() : 0;
    if (lastFailed > 0 && lastFailed > lastJoined) return 'failed';

    if (lastJoined > 0 && lastJoined + COOLDOWN_DAYS * 86400_000 > now) return 'joined';

    return 'active';
}

async function migrateExpired() {
    if (!supabase) return;
    const { data: rows, error } = await supabase.from('accounts').select('*');
    if (error) { console.error('migrateExpired select:', error.message); return; }

    const now = Date.now();
    const expired = (rows || []).filter(r => isExpired(r, now));
    if (expired.length > 0) {
        const toInsert = expired.map(r => ({
            email: r.email,
            password: r.password,
            added_at: r.added_at,
            ttl_days: r.ttl_days,
            last_joined_at: r.last_joined_at,
            last_failed_at: r.last_failed_at,
            fail_reason: r.fail_reason,
        }));

        const { error: e1 } = await supabase
            .from('expired_accounts')
            .upsert(toInsert, { onConflict: 'email,added_at', ignoreDuplicates: true });
        if (e1) { console.error('migrateExpired insert:', e1.message); return; }

        const ids = expired.map(r => r.id);
        const { error: e2 } = await supabase.from('accounts').delete().in('id', ids);
        if (e2) console.error('migrateExpired delete:', e2.message);
    }

    const pruneCutoff = new Date(now - EXPIRED_RETENTION_DAYS * 86400_000).toISOString();
    const { error: e3 } = await supabase
        .from('expired_accounts')
        .delete()
        .lt('expired_at', pruneCutoff);
    if (e3) console.error('migrateExpired prune:', e3.message);
}

function batchKey(row) {
    return new Date(row.added_at).toISOString().slice(0, 10);
}

export function isReady() {
    return supabase !== null;
}

export async function listAccounts() {
    if (!supabase) return { active: [], joined: [], failed: [], expired: [] };

    await migrateExpired();

    const [activeRes, expiredRes] = await Promise.all([
        supabase.from('accounts').select('*').order('added_at', { ascending: true }),
        supabase.from('expired_accounts').select('*').order('expired_at', { ascending: false }),
    ]);
    if (activeRes.error) throw new Error(`Supabase listAccounts: ${activeRes.error.message}`);
    if (expiredRes.error) throw new Error(`Supabase listExpired: ${expiredRes.error.message}`);

    const now = Date.now();
    const out = { active: [], joined: [], failed: [], expired: [] };
    for (const row of activeRes.data || []) {
        const cat = classify(row, now);
        if (cat === 'expired') continue; // shouldn't happen post-migrate but guard
        out[cat].push({
            id: row.id,
            email: row.email,
            password: row.password,
            addedAt: row.added_at,
            ttlDays: row.ttl_days,
            expiresAt: new Date(new Date(row.added_at).getTime() + row.ttl_days * 86400_000).toISOString(),
            lastJoinedAt: row.last_joined_at,
            lastFailedAt: row.last_failed_at,
            failReason: row.fail_reason,
            batch: batchKey(row),
        });
    }
    for (const row of expiredRes.data || []) {
        out.expired.push({
            id: row.id,
            email: row.email,
            password: row.password,
            addedAt: row.added_at,
            ttlDays: row.ttl_days,
            expiresAt: row.expired_at,
            lastJoinedAt: row.last_joined_at,
            lastFailedAt: row.last_failed_at,
            failReason: row.fail_reason,
            batch: batchKey(row),
        });
    }
    return out;
}

export async function addAccounts(rawText, ttlDays) {
    if (!supabase) throw new Error('Supabase chưa cấu hình.');
    if (![35, 90, 180].includes(ttlDays)) throw new Error('ttlDays phải là 35, 90 hoặc 180.');

    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const rows = [];
    const errors = [];
    for (const line of lines) {
        const parts = line.split('|');
        if (parts.length < 2 || !parts[0].includes('@')) {
            errors.push(line);
            continue;
        }
        rows.push({ email: parts[0].trim(), password: parts[1].trim(), ttl_days: ttlDays });
    }
    if (rows.length === 0) return { inserted: 0, skipped: lines.length, errors };

    const { data, error } = await supabase
        .from('accounts')
        .upsert(rows, { onConflict: 'email', ignoreDuplicates: true })
        .select();
    if (error) throw new Error(`Supabase addAccounts: ${error.message}`);
    return { inserted: data?.length ?? 0, skipped: lines.length - (data?.length ?? 0), errors };
}

export async function deleteAccount(id) {
    if (!supabase) throw new Error('Supabase chưa cấu hình.');
    const [r1, r2] = await Promise.all([
        supabase.from('accounts').delete().eq('id', id),
        supabase.from('expired_accounts').delete().eq('id', id),
    ]);
    if (r1.error && r2.error) throw new Error(`Supabase deleteAccount: ${r1.error.message}`);
}

export async function deleteAccountsByCategory(category) {
    if (!supabase) throw new Error('Supabase chưa cấu hình.');
    const all = await listAccounts();
    const ids = (all[category] || []).map(a => a.id);
    if (ids.length === 0) return { deleted: 0 };
    const table = category === 'expired' ? 'expired_accounts' : 'accounts';
    const { error } = await supabase.from(table).delete().in('id', ids);
    if (error) throw new Error(`Supabase deleteAccountsByCategory: ${error.message}`);
    return { deleted: ids.length };
}

export async function restoreAccount(id) {
    if (!supabase) throw new Error('Supabase chưa cấu hình.');
    const { error } = await supabase
        .from('accounts')
        .update({ last_failed_at: null, fail_reason: null })
        .eq('id', id);
    if (error) throw new Error(`Supabase restoreAccount: ${error.message}`);
}

export async function markJoinedById(id) {
    if (!supabase) return;
    const { error } = await supabase
        .from('accounts')
        .update({ last_joined_at: new Date().toISOString(), last_failed_at: null, fail_reason: null })
        .eq('id', id);
    if (error) console.error(`markJoinedById error: ${error.message}`);
}

export async function markFailedById(id, reason) {
    if (!supabase) return;
    const { error } = await supabase
        .from('accounts')
        .update({ last_failed_at: new Date().toISOString(), fail_reason: reason?.slice(0, 500) || 'unknown' })
        .eq('id', id);
    if (error) console.error(`markFailedById error: ${error.message}`);
}

export async function pickNextBatch() {
    const { active } = await listAccounts();
    if (active.length === 0) return [];

    const groups = new Map();
    for (const acc of active) {
        if (!groups.has(acc.batch)) groups.set(acc.batch, []);
        groups.get(acc.batch).push(acc);
    }

    const sortedBatches = [...groups.entries()].sort((a, b) => {
        const expA = new Date(a[1][0].expiresAt).getTime();
        const expB = new Date(b[1][0].expiresAt).getTime();
        return expA - expB;
    });

    const [, picked] = sortedBatches[0];
    return picked.slice(0, BATCH_MAX);
}
