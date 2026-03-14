'use strict';

const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const config = require('./settings.json');
const express = require('express');
const http = require('http');
const https = require('https');

// ============================================================
// EXPRESS SERVER - Dashboard & Health Checks
// ============================================================
const app = express();
const PORT = process.env.PORT || 5000;

let botState = {
    connected: false,
    startTime: Date.now(),
    reconnectAttempts: 0,
    errors: [],
    lastActivity: Date.now()
};

app.get('/', (req, res) => {
    res.send(`
        <body style="background:#0f172a; color:white; font-family:sans-serif; text-align:center; padding:50px;">
            <h1 style="color:#2dd4bf;">🤖 ${config.name} Dashboard</h1>
            <p>Status: <strong>${botState.connected ? 'ONLINE' : 'RECONNECTING'}</strong></p>
            <p>Server: ${config.server.ip}</p>
            <p>Uptime: ${Math.floor((Date.now() - botState.startTime) / 1000)}s</p>
            <script>setTimeout(() => location.reload(), 10000);</script>
        </body>
    `);
});

app.get('/health', (req, res) => {
    res.json({
        status: botState.connected ? 'connected' : 'disconnected',
        uptime: Math.floor((Date.now() - botState.startTime) / 1000),
        coords: (bot && bot.entity) ? bot.entity.position : null
    });
});

app.get('/ping', (req, res) => res.send('pong'));

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Dashboard active on port ${PORT}`);
});

// ============================================================
// RENDER KEEP-ALIVE SYSTEM
// ============================================================
function startSelfPing() {
    const renderUrl = process.env.RENDER_EXTERNAL_URL;
    if (!renderUrl) {
        console.log('[KeepAlive] WARNING: RENDER_EXTERNAL_URL not set in environment variables!');
        return;
    }
    
    setInterval(() => {
        const protocol = renderUrl.startsWith('https') ? https : http;
        protocol.get(`${renderUrl}/ping`, (res) => {
            console.log(`[KeepAlive] Ping successful: ${res.statusCode}`);
        }).on('error', (err) => {
            console.log(`[KeepAlive] Ping failed: ${err.message}`);
        });
    }, 5 * 60 * 1000); // Ping every 5 minutes
}
startSelfPing();

// ============================================================
// BOT LOGIC & RECONNECTION
// ============================================================
let bot = null;
let isReconnecting = false;
let activeIntervals = [];

function clearAllIntervals() {
    activeIntervals.forEach(clearInterval);
    activeIntervals = [];
}

function createBot() {
    if (isReconnecting) return;

    // Thorough Cleanup
    if (bot) {
        bot.removeAllListeners();
        try { bot.quit(); } catch (e) {}
        bot = null;
    }
    clearAllIntervals();

    console.log(`[Bot] Connecting to ${config.server.ip}...`);

    bot = mineflayer.createBot({
        host: config.server.ip,
        port: config.server.port,
        username: config['bot-account'].username,
        version: config.server.version || false,
        auth: config['bot-account'].type || 'offline',
        checkTimeoutInterval: 60000
    });

    bot.loadPlugin(pathfinder);

    bot.once('spawn', () => {
        botState.connected = true;
        botState.reconnectAttempts = 0;
        isReconnecting = false;
        console.log(`[Bot] [+] Spawned on ${config.server.ip}`);

        const mcData = require('minecraft-data')(bot.version);
        const defaultMove = new Movements(bot, mcData);
        initializeModules(bot, defaultMove);
    });

    bot.on('resourcePack', () => {
        bot.acceptResourcePack();
        console.log('[Bot] Accepted Server Resource Pack');
    });

    bot.on('error', (err) => console.log(`[Error] ${err.message}`));

    bot.on('end', (reason) => {
        botState.connected = false;
        console.log(`[Disconnect] Reason: ${reason}`);
        scheduleReconnect();
    });

    bot.on('kicked', (reason) => {
        console.log(`[Kicked] Reason: ${reason}`);
    });
}

function scheduleReconnect() {
    if (isReconnecting) return;
    isReconnecting = true;

    const delay = Math.min(10000 * (botState.reconnectAttempts + 1), 60000);
    botState.reconnectAttempts++;

    console.log(`[Retry] Reconnecting in ${delay / 1000}s (Attempt ${botState.reconnectAttempts})`);
    setTimeout(() => {
        isReconnecting = false;
        createBot();
    }, delay);
}

// ============================================================
// AFK MODULES
// ============================================================
function initializeModules(bot, move) {
    // 1. Anti-AFK Random Walk
    const walkInt = setInterval(() => {
        if (!bot.pathfinder || !botState.connected) return;
        const rx = (Math.random() - 0.5) * 6;
        const rz = (Math.random() - 0.5) * 6;
        const goal = new GoalBlock(
            Math.floor(bot.entity.position.x + rx),
            Math.floor(bot.entity.position.y),
            Math.floor(bot.entity.position.z + rz)
        );
        bot.pathfinder.setMovements(move);
        bot.pathfinder.setGoal(goal);
    }, 45000);

    // 2. Swing Arm
    const swingInt = setInterval(() => {
        if (botState.connected) bot.swingArm();
    }, 15000);

    // 3. Look Around
    const lookInt = setInterval(() => {
        if (botState.connected) {
            bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * Math.PI, false);
        }
    }, 30000);

    activeIntervals.push(walkInt, swingInt, lookInt);
}

// ============================================================
// CRASH PROTECTION
// ============================================================
process.on('uncaughtException', (err) => {
    console.log(`[CRITICAL] Uncaught Exception: ${err.message}`);
    if (!isReconnecting) scheduleReconnect();
});

process.on('unhandledRejection', (reason) => {
    console.log(`[CRITICAL] Unhandled Rejection: ${reason}`);
});

// Start the Application
createBot();
