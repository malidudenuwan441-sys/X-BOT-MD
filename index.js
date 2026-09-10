/**
 * Knight Bot - A WhatsApp Bot
 * Copyright (c) 2024 Professor
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 * 
 * Credits:
 * - Baileys Library by @adiwajshing
 * - Pair Code implementation inspired by TechGod143 & DGXEON
 */
require('./settings')
const dns = require('dns')
try {
    if (typeof dns.setDefaultResultOrder === 'function') {
        dns.setDefaultResultOrder('ipv4first')
    }
} catch (e) {}
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay,
    Browsers
} = require("@whiskeysockets/baileys")
const NodeCache = require("node-cache")
// Using a lightweight persisted store instead of makeInMemoryStore (compat across versions)
const pino = require("pino")
const readline = require("readline")
const { parsePhoneNumber } = require("libphonenumber-js")
const { PHONENUMBER_MCC } = require('@whiskeysockets/baileys/lib/Utils/generics')
const { rmSync, existsSync } = require('fs')
const { join } = require('path')

// Import lightweight store
const store = require('./lib/lightweight_store')
const QRCode = require('qrcode')
const dashboard = require('./dashboard')

// Initialize store
store.readFromFile()
const settings = require('./settings')
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

let currentSock = null
let reconnectTimer = null
let reconnectAttempts = 0

function scheduleReconnect(delayMs = 5000, reasonText = 'Connection closed') {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
    }
    reconnectAttempts++;
    // Exponential backoff capped at 30 seconds
    const backoff = Math.min(delayMs + (reconnectAttempts > 3 ? (reconnectAttempts - 3) * 3000 : 0), 30000);
    console.log(chalk.yellow(`[Auto-Reconnect] Scheduling in ${Math.round(backoff / 1000)}s (Attempt ${reconnectAttempts}) [${reasonText}]...`));
    
    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        try {
            if (currentSock) {
                try { currentSock.end(); } catch (e) {}
                currentSock = null;
            }
            await startXeonBotInc();
        } catch (err) {
            console.error('[Auto-Reconnect] Failed to start socket:', err.message);
            scheduleReconnect(5000, 'Retry after startup failure');
        }
    }, backoff);
}

// Start dashboard server on port 3000
dashboard.startDashboardServer(async (requestedPhone) => {
    if (!currentSock) {
        return { error: 'Bot is initializing. Please wait a few seconds and try again.' };
    }
    try {
        // Wait for socket to be open if it's currently connecting
        for (let i = 0; i < 20; i++) {
            if (currentSock && currentSock.ws && currentSock.ws.isOpen) break;
            await delay(500);
        }
        if (!currentSock || !currentSock.ws || !currentSock.ws.isOpen) {
            return { error: 'WhatsApp socket connection is not ready. Please try again in 5 seconds.' };
        }
        let code = await currentSock.requestPairingCode(requestedPhone);
        code = code?.match(/.{1,4}/g)?.join("-") || code;
        return { code };
    } catch (err) {
        return { error: err.message || 'Failed to request pairing code' };
    }
});

// Memory optimization - Force garbage collection if available
setInterval(() => {
    if (global.gc) {
        global.gc()
        console.log('🧹 Garbage collection completed')
    }
}, 60_000) // every 1 minute

let phoneNumber = process.env.OWNER_NUMBER || settings.ownerNumber || "94719531525"
let owner = process.env.OWNER_NUMBER || settings.ownerNumber || "94719531525"

global.botname = "X BOT"
global.themeemoji = "•"
const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

// Only create readline interface if we're in an interactive environment
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => {
    if (rl) {
        return new Promise((resolve) => rl.question(text, resolve))
    } else {
        // In non-interactive environment, use ownerNumber from settings
        return Promise.resolve(settings.ownerNumber || phoneNumber)
    }
}


async function startXeonBotInc() {
    try {
        let { version, isLatest } = await fetchLatestBaileysVersion()
        const { state, saveCreds } = await useMultiFileAuthState(`./session`)
        const msgRetryCounterCache = new NodeCache()

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: !pairingCode,
            browser: Browsers.ubuntu('Chrome'),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async (key) => {
                let jid = jidNormalizedUser(key.remoteJid)
                let msg = await store.loadMessage(jid, key.id)
                return msg?.message || ""
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 120000,
            connectTimeoutMs: 120000,
            keepAliveIntervalMs: 10000,
            mediaUploadTimeoutMs: 1800000, // 30 minutes timeout for large video uploads
        })

        // Save credentials when they update
        XeonBotInc.ev.on('creds.update', saveCreds)

        currentSock = XeonBotInc
        dashboard.botState.sock = XeonBotInc
        dashboard.botState.status = 'connecting'
        dashboard.log('info', 'Connecting to WhatsApp network...')

    store.bind(XeonBotInc.ev)

    // Message handling
    XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
        try {
            dashboard.botState.messageCount++
            const mek = chatUpdate.messages[0]
            if (!mek.message) return
            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message
            if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                await handleStatus(XeonBotInc, chatUpdate);
                return;
            }
            if (!XeonBotInc.public && !mek.key.fromMe && chatUpdate.type === 'notify') {
                const isGroup = mek.key?.remoteJid?.endsWith('@g.us')
                if (!isGroup) return
            }
            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return

            // Clear message retry cache to prevent memory bloat
            if (XeonBotInc?.msgRetryCounterCache) {
                XeonBotInc.msgRetryCounterCache.clear()
            }

            try {
                await handleMessages(XeonBotInc, chatUpdate, true)
            } catch (err) {
                console.error("Error in handleMessages:", err)
                if (mek.key && mek.key.remoteJid) {
                    await XeonBotInc.sendMessage(mek.key.remoteJid, {
                        text: '❌ An error occurred while processing your message.'
                    }).catch(console.error);
                }
            }
        } catch (err) {
            console.error("Error in messages.upsert:", err)
        }
    })

    // Add these event handlers for better functionality
    XeonBotInc.decodeJid = (jid) => {
        if (!jid) return jid
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {}
            return decode.user && decode.server && decode.user + '@' + decode.server || jid
        } else return jid
    }

    XeonBotInc.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = XeonBotInc.decodeJid(contact.id)
            if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
        }
    })

    XeonBotInc.getName = (jid, withoutContact = false) => {
        id = XeonBotInc.decodeJid(jid)
        withoutContact = XeonBotInc.withoutContact || withoutContact
        let v
        if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
            v = store.contacts[id] || {}
            if (!(v.name || v.subject)) v = XeonBotInc.groupMetadata(id) || {}
            resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
        })
        else v = id === '0@s.whatsapp.net' ? {
            id,
            name: 'WhatsApp'
        } : id === XeonBotInc.decodeJid(XeonBotInc.user.id) ?
            XeonBotInc.user :
            (store.contacts[id] || {})
        return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
    }

    XeonBotInc.public = true

    XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store)

    // Handle pairing code
    if (pairingCode && !XeonBotInc.authState.creds.registered) {
        dashboard.botState.status = 'waiting_pair'
        if (useMobile) throw new Error('Cannot use pairing code with mobile api')

        let phoneToUse
        if (!!global.phoneNumber) {
            phoneToUse = global.phoneNumber
        } else if (process.stdin.isTTY) {
            phoneToUse = await question(chalk.bgBlack(chalk.greenBright(`Please type your WhatsApp number 😍\nFormat: 94719531525 (without + or spaces) : `)))
        } else {
            phoneToUse = settings.ownerNumber || phoneNumber
        }

        // Clean the phone number - remove any non-digit characters
        phoneToUse = (phoneToUse || '').replace(/[^0-9]/g, '')

        // Validate the phone number using awesome-phonenumber
        const pn = require('awesome-phonenumber');
        if (!pn('+' + phoneToUse).isValid()) {
            console.log(chalk.yellow(`Phone number ${phoneToUse} not yet validated. Use Web Dashboard to link your WhatsApp.`))
            dashboard.log('warn', `Waiting for phone number via Web Dashboard to generate pairing code.`)
        } else {
            // Request pairing code only when socket WebSocket is open
            (async () => {
                try {
                    dashboard.botState.pairingPhone = phoneToUse;
                    // Wait up to 15 seconds for WebSocket to be open
                    for (let i = 0; i < 30; i++) {
                        if (XeonBotInc && XeonBotInc.ws && XeonBotInc.ws.isOpen) break;
                        await delay(500);
                    }
                    if (XeonBotInc && XeonBotInc.ws && XeonBotInc.ws.isOpen && !XeonBotInc.authState.creds.registered) {
                        let code = await XeonBotInc.requestPairingCode(phoneToUse);
                        code = code?.match(/.{1,4}/g)?.join("-") || code;
                        dashboard.botState.pairingCode = code;
                        dashboard.log('success', `Generated Pairing Code: ${code} for +${phoneToUse}`);
                        console.log(chalk.black(chalk.bgGreen(`Your Pairing Code : `)), chalk.black(chalk.white(code)));
                        console.log(chalk.yellow(`\nPlease enter this code in your WhatsApp app:\n1. Open WhatsApp\n2. Go to Settings > Linked Devices\n3. Tap "Link a Device"\n4. Enter the code shown above`));
                    }
                } catch (error) {
                    dashboard.log('info', `Pairing code standby: ${error.message}. You can request code anytime from Web Dashboard.`);
                }
            })();
        }
    }

    // Connection handling
    XeonBotInc.ev.on('connection.update', async (s) => {
        const { connection, lastDisconnect, qr } = s
        
        if (qr) {
            console.log(chalk.yellow('📱 QR Code generated. Please scan with WhatsApp or use Pairing Code.'))
            QRCode.toDataURL(qr, (err, url) => {
                if (!err) dashboard.botState.qrDataUrl = url
            })
            dashboard.log('info', '📱 QR Code generated for WhatsApp linking')
        }
        
        if (connection === 'connecting') {
            console.log(chalk.yellow('🔄 Connecting to WhatsApp...'))
            dashboard.botState.status = 'connecting'
            dashboard.log('info', '🔄 Connecting to WhatsApp servers...')
        }
        
        if (connection == "open") {
            reconnectAttempts = 0;
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            dashboard.botState.status = 'connected'
            dashboard.botState.connectedUser = XeonBotInc.user
            dashboard.botState.qrDataUrl = null
            dashboard.log('success', '🟢 Bot Connected Successfully to WhatsApp!')
            console.log(chalk.magenta(` `))
            console.log(chalk.yellow(`🌿Connected to => ` + JSON.stringify(XeonBotInc.user, null, 2)))

            try {
                const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
                await XeonBotInc.sendMessage(botNumber, {
                    text: `🚀 *X BOT Connected Successfully!*\n\n⏰ *Time:* ${new Date().toLocaleString()}\n🟢 *Status:* Online and Active!`
                });
            } catch (error) {
                // Ignore initial direct message error
            }

            await delay(1999)
            console.log(chalk.yellow(`\n\n                  ${chalk.bold.blue(`[ ${global.botname || 'X BOT'} ]`)}\n\n`))
            console.log(chalk.cyan(`< ================================================== >`))
            console.log(chalk.magenta(`${global.themeemoji || '•'} WA NUMBER: ${owner}`))
            console.log(chalk.magenta(`${global.themeemoji || '•'} CREDIT: BADMaliya2`))
            console.log(chalk.green(`${global.themeemoji || '•'} 🤖 Bot Connected Successfully! ✅`))
            console.log(chalk.blue(`Bot Version: ${settings.version}`))
        }
        
        if (connection === 'close') {
            dashboard.botState.status = 'disconnected'
            dashboard.botState.qrDataUrl = null

            const error = lastDisconnect?.error
            const statusCode = error?.output?.statusCode
            const errorMsg = error?.message || String(error || '')

            console.log(chalk.red(`[Connection Closed] Status: ${statusCode || 'unknown'}, Error: ${errorMsg}`))

            const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401
            const isForbidden = statusCode === DisconnectReason.forbidden || statusCode === 403
            const isBadSession = statusCode === DisconnectReason.badSession || statusCode === 500
            const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515
            const isTimedOut = statusCode === DisconnectReason.timedOut || statusCode === 408 || errorMsg.includes('QR refs attempts ended')
            const isConnectionReplaced = statusCode === DisconnectReason.connectionReplaced || statusCode === 440

            if (isLoggedOut || isForbidden || isBadSession) {
                console.log(chalk.yellow('Session is invalid or logged out. Resetting session files for clean authentication...'))
                dashboard.log('warn', 'Session invalid or logged out. Resetting session cache for fresh pairing.')
                try {
                    rmSync('./session', { recursive: true, force: true })
                } catch (e) {}
                dashboard.botState.pairingCode = null
                dashboard.botState.connectedUser = null
                dashboard.botState.status = 'waiting_pair'

                // Automatically restart clean session so user can pair immediately
                scheduleReconnect(3000, 'Fresh session restart after logout/bad session')
                return
            }

            if (isRestartRequired) {
                dashboard.log('info', 'Device paired successfully or WhatsApp requested restart. Reconnecting now...')
                scheduleReconnect(2000, 'WhatsApp restart required')
                return
            }

            if (isTimedOut) {
                dashboard.log('info', 'QR/Pairing code attempt expired. Refreshing connection...')
                scheduleReconnect(4000, 'QR/Pairing timeout refreshed')
                return
            }

            if (isConnectionReplaced) {
                dashboard.log('error', 'Connection replaced by another active session. Waiting before retry...')
                scheduleReconnect(15000, 'Connection replaced wait')
                return
            }

            // Other transient connection errors (Connection Failure, stream error, network drops)
            dashboard.log('warn', `Connection closed (${errorMsg || statusCode}). Reconnecting...`)
            scheduleReconnect(5000, 'Network reconnect')
        }
    })

    // Track recently-notified callers to avoid spamming messages
    const antiCallNotified = new Set();

    // Anticall handler: block callers when enabled
    XeonBotInc.ev.on('call', async (calls) => {
        try {
            const { readState: readAnticallState } = require('./commands/anticall');
            const state = readAnticallState();
            if (!state.enabled) return;
            for (const call of calls) {
                const callerJid = call.from || call.peerJid || call.chatId;
                if (!callerJid) continue;
                try {
                    try {
                        if (typeof XeonBotInc.rejectCall === 'function' && call.id) {
                            await XeonBotInc.rejectCall(call.id, callerJid);
                        } else if (typeof XeonBotInc.sendCallOfferAck === 'function' && call.id) {
                            await XeonBotInc.sendCallOfferAck(call.id, callerJid, 'reject');
                        }
                    } catch {}

                    if (!antiCallNotified.has(callerJid)) {
                        antiCallNotified.add(callerJid);
                        setTimeout(() => antiCallNotified.delete(callerJid), 60000);
                        await XeonBotInc.sendMessage(callerJid, { text: '⚠️ *Incoming calls are not allowed.* Your call was rejected and you will be blocked automatically.' });
                    }
                } catch {}
                setTimeout(async () => {
                    try { await XeonBotInc.updateBlockStatus(callerJid, 'block'); } catch {}
                }, 800);
            }
        } catch (e) {
            // ignore
        }
    });

    XeonBotInc.ev.on('group-participants.update', async (update) => {
        await handleGroupParticipantUpdate(XeonBotInc, update);
    });

    XeonBotInc.ev.on('messages.upsert', async (m) => {
        if (m.messages[0].key && m.messages[0].key.remoteJid === 'status@broadcast') {
            await handleStatus(XeonBotInc, m);
        }
    });

    XeonBotInc.ev.on('status.update', async (status) => {
        await handleStatus(XeonBotInc, status);
    });

    XeonBotInc.ev.on('messages.reaction', async (status) => {
        await handleStatus(XeonBotInc, status);
    });

    return XeonBotInc
    } catch (error) {
        console.error('Error in startXeonBotInc:', error)
        await delay(5000)
        startXeonBotInc()
    }
}


// Start the bot with error handling
startXeonBotInc().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
})
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err)
})

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err)
})

let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(chalk.redBright(`Update ${__filename}`))
    delete require.cache[file]
    require(file)
})
