import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import open from 'open';
import { runRegisterFlow, runLoginFlow } from './automation.js';
import * as db from './db.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(join(__dirname, 'public')));
app.use(express.json({ limit: '2mb' }));

let joinInProgress = false;

app.get('/health', (req, res) => res.json({ ok: true }));

io.on('connection', (socket) => {
    console.log('Client connected');
    socket.emit('join-status', { running: joinInProgress });
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

app.post('/api/start-register', (req, res) => {
    const { count, password } = req.body;
    console.log(`Starting Register Flow: ${count} accounts`);
    runRegisterFlow(count, password, io);
    res.json({ message: 'Register flow started' });
});

// === Account management (Supabase) ===

app.get('/api/accounts', async (req, res) => {
    try {
        const data = await db.listAccounts();
        res.json(data);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

app.post('/api/accounts', async (req, res) => {
    try {
        const { rawText, ttlDays } = req.body;
        if (!rawText) return res.status(400).json({ message: 'Thiếu nội dung tài khoản.' });
        const result = await db.addAccounts(rawText, ttlDays === 'once' ? 'once' : parseInt(ttlDays, 10));
        res.json(result);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

app.delete('/api/accounts/:id', async (req, res) => {
    try {
        await db.deleteAccount(req.params.id);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

app.post('/api/accounts/:id/restore', async (req, res) => {
    try {
        await db.restoreAccount(req.params.id);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

app.delete('/api/accounts/category/:category', async (req, res) => {
    try {
        const result = await db.deleteAccountsByCategory(req.params.category);
        res.json(result);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// === Join flow ===

app.get('/api/join-status', (req, res) => {
    res.json({ running: joinInProgress });
});

app.post('/api/start-join', async (req, res) => {
    if (joinInProgress) {
        return res.status(409).json({ message: 'Đang chạy 1 join khác. Đợi xong rồi thử lại.' });
    }

    const { inviteUrl } = req.body;
    if (!inviteUrl) return res.status(400).json({ message: 'Thiếu invite URL.' });
    if (!db.isReady()) return res.status(500).json({ message: 'Supabase chưa cấu hình.' });

    let batch;
    try {
        batch = await db.pickNextBatch();
    } catch (e) {
        return res.status(500).json({ message: e.message });
    }
    if (batch.length === 0) {
        return res.status(400).json({ message: 'Không có tài khoản nào sẵn sàng (active).' });
    }

    const accountObjects = batch.map(a => ({ id: a.id, email: a.email, password: a.password }));
    console.log(`Starting Join Flow: ${batch.length} accounts (batch ${batch[0].batch})`);

    joinInProgress = true;
    io.emit('join-status', { running: true, batchDate: batch[0].batch, total: batch.length });
    res.json({ message: 'Join flow started', count: batch.length, batchDate: batch[0].batch });

    const onAccountResult = async (id, email, success, reason) => {
        if (success) {
            if (id) await db.markJoinedById(id);
            io.emit('account-joined', { id, email });
        } else {
            if (id) await db.markFailedById(id, reason);
            io.emit('account-failed', { id, email, reason });
        }
    };

    try {
        await runLoginFlow(accountObjects, inviteUrl, io, { onAccountResult });
    } catch (e) {
        console.error('runLoginFlow crashed:', e);
    } finally {
        joinInProgress = false;
        io.emit('join-status', { running: false });
        io.emit('join-complete');
    }
});

const PORT = process.env.PORT || 3000;

app.post('/api/download-accounts', (req, res) => {
    const { accounts } = req.body;
    if (!accounts || accounts.length === 0) {
        return res.status(400).json({ message: 'No accounts to download' });
    }
    const content = accounts.join('\n') + '\n';
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="capcut_accounts.txt"');
    res.send(content);
});

httpServer.listen(PORT, '0.0.0.0', async () => {
    console.log(`Server running at http://localhost:${PORT}`);
    if (process.env.NODE_ENV !== 'production') {
        try {
            await open(`http://localhost:${PORT}`);
        } catch (e) {
            console.log('Could not open browser automatically.');
        }
    } else {
        console.log(`Production mode active. Listening on port ${PORT}`);
    }
});
