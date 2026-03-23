import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import open from 'open';
import { runRegisterFlow, runLoginFlow } from './automation.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(join(__dirname, 'public')));
app.use(express.json());

io.on('connection', (socket) => {
    console.log('Client connected');
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

app.post('/api/start-register', (req, res) => {
    const { count, password } = req.body;
    console.log(`Starting Register Flow: ${count} accounts`);
    // Run async, don't wait for completion
    runRegisterFlow(count, password, io);
    res.json({ message: 'Register flow started' });
});

app.post('/api/start-login', (req, res) => {
    const { accounts, inviteUrl } = req.body;
    const accountList = accounts.split('\n').filter(line => line.trim() !== '');
    console.log(`Starting Login Flow: ${accountList.length} accounts`);
    // Run async
    runLoginFlow(accountList, inviteUrl, io);
    res.json({ message: 'Login flow started' });
});

const PORT = process.env.PORT || 3000;

// Download accounts as .txt file (receives accounts from frontend to avoid stale data)
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
