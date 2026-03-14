'use strict';

const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const config = require('./settings.json');
const express = require('express');
const http = require('http');
const https = require('https');

// ============================================================
// EXPRESS DASHBOARD - Tricking Render to stay 24/7
// ============================================================
const app = express();
const PORT = process.env.PORT || 5000;

let botState = {
    connected: false,
    startTime: Date.now(),
    reconnectAttempts: 0,
    lastError: "None"
};

app.get('/', (req, res) => {
    res.send(`
        <body style="background:#0f172a; color:white; font-family:sans-serif; text-align:center; padding:50px;">
            <h1 style="color:#2dd4bf;">🤖 ${config.name} AFK Dashboard</h1>
            <div style="background:#1e293b; padding:20px; border-radius:15px; display:inline-block; border:1px solid #334155;">
                <p>Status: <strong style="color:${botState.connected ? '#4ade80' : '#f87171'}">${botState.connected ? 'ONLINE' : 'RECONNECTING'}</strong></p>
                <p>Server: ${config.server.ip}</p>
                <p>Attempts: ${botState.reconnectAttempts}</p>
                <p>Last Error: <small style="color:#94a3b8">${botState.lastError}</small></p>
            </div>
            <script>setTimeout(() => location.reload(), 15000);</script>
        </body>
    `);
});

app.get('/ping', (req, res) => res.send('pong'));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[System] Dashboard active on port ${PORT}`);
});

// ============================================================
// RENDER SELF-PING (The "Stay Awake" Engine)
// ============================================================
function startKeepAlive() {
    const url = process.env.RENDER_EXTERNAL_URL;
    if (!url) {
        console.log('[KeepAlive] ERROR: RENDER_EXTERNAL_URL environment variable is missing!');
        return;
    }
    
    setInterval(() => {
        const protocol = url.startsWith('https') ? https : http;
        protocol.get(`${url}/ping`, (res) => {
            console.log(`[KeepAlive] Pinged dashboard. Status: ${res.statusCode}`);
        }).on('error', (e) => console.log(`[KeepAlive] Ping failed: ${e.message}`));
    }, 5 * 60 * 1000); // 5 minutes
}
startKeepAlive();

// ============================================================
// BOT CORE LOGIC
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

    // Destructive Cleanup
    if (bot) {
        bot.removeAllListeners();
        try { bot.quit(); } catch (e) {}
        bot = null;
    }
    clearAllIntervals();

    console.log(`[Bot] Attempting to join ${config.server.ip}...`);

    bot = mineflayer.createBot({
        host: config.server.ip,
        port: parseInt(config.server.port) || 25565,
        username: config['bot-account'].username,
        version: config.server.version || false, // false = auto-detect
        auth: 'offline', // Required for Aternos Cracked mode
        hideErrors: false,
        checkTimeoutInterval: 60000
    });

    bot.loadPlugin(pathfinder);

    bot.on('login', () => console.log('[Bot] Logged into server, waiting for spawn...'));

    bot.once('spawn', () => {
        botState.connected = true;
        botState.reconnectAttempts = 0;
        isReconnecting = false;
        console.log(`[Bot] [+] SUCCESS: Spawned at ${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}`);

        const mcData = require('minecraft-data')(bot.version);
        const defaultMove = new Movements(bot, mcData);
        startAFKModules(bot, defaultMove);
    });

    // Handle Aternos specific popups/packs
    bot.on('resourcePack', () => {
        bot.acceptResourcePack();
        console.log('[Bot] Resource pack accepted.');
    });

    bot.on('kicked', (reason) => {
        botState.lastError = "Kicked: " + (typeof reason === 'string' ? reason : JSON.stringify(reason));
        console.log(`[Bot] KICKED: ${botState.lastError}`);
    });

    bot.on('error', (err) => {
        botState.lastError = err.message;
        console.log(`[Bot] ERROR: ${err.message}`);
    });

    bot.on('end', (reason) => {
        botState.connected = false;
        console.log(`[Bot] Connection ended: ${reason}`);
        if (!isReconnecting) scheduleReconnect();
    });
}

function scheduleReconnect() {
    if (isReconnecting) return;
    isReconnecting = true;

    botState.reconnectAttempts++;
    const delay = Math.min(15000 * botState.reconnectAttempts, 60000);

    console.log(`[Retry] Waiting ${delay / 1000}s before next attempt...`);
    setTimeout(() => {
        isReconnecting = false;
        createBot();
    }, delay);
}

// ============================================================
// AFK BEHAVIORS (Anti-Kick)
// ============================================================
function startAFKModules(bot, move) {
    // 1. Movement: Walking in a small square area
    const walkInterval = setInterval(() => {
        if (!bot.pathfinder || !botState.connected) return;
        const x = bot.entity.position.x + (Math.random() - 0.5) * 4;
        const z = bot.entity.position.z + (Math.random() - 0.5) * 4;
        bot.pathfinder.setMovements(move);
        bot.pathfinder.setGoal(new GoalBlock(Math.floor(x), Math.floor(bot.entity.position.y), Math.floor(z)));
    }, 40000);

    // 2. Action: Swing arm (simulates clicking)
    const swingInterval = setInterval(() => {
        if (botState.connected) bot.swingArm();
    }, 15000);

    // 3. Action: Look around randomly
    const lookInterval = setInterval(() => {
        if (botState.connected) {
            const yaw = Math.random() * Math.PI * 2;
            const pitch = (Math.random() - 0.5) * Math.PI;
            bot.look(yaw, pitch, false);
        }
    }, 25000);

    activeIntervals.push(walkInterval, swingInterval, lookInterval);
}

// ============================================================
// SYSTEM RECOVERY
// ============================================================
process.on('uncaughtException', (err) => {
    console.log(`[CrashGuard] Exception: ${err.message}`);
    if (!isReconnecting) scheduleReconnect();
});

// INITIAL START
createBot();
