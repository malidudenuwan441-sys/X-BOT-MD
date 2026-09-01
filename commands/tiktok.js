const axios = require('axios');

const processedMessages = new Set();
// Reply sessions තබා ගැනීමට
const tiktokSessions = new Map();

async function tiktokCommand(sock, chatId, message) {
    try {
        if (processedMessages.has(message.key.id)) return false;
        processedMessages.add(message.key.id);
        setTimeout(() => processedMessages.delete(message.key.id), 5 * 60 * 1000);

        const text = message.message?.conversation || 
                     message.message?.extendedTextMessage?.text || 
                     message.message?.imageMessage?.caption || 
                     message.message?.videoMessage?.caption || '';

        const urlMatch = text.match(/https?:\/\/(www\.|vm\.|vt\.|mobile\.|t\.)?tiktok\.com\/[^\s]+/i);
        
        // ----------------------------------------------------
        // Command එක (.tiktok හෝ .tt) පමණක් යැවූ විට Warning Message එක යැවීම
        // ----------------------------------------------------
        const isTiktokCmd = text.trim().startsWith('.tiktok') || text.trim().startsWith('.tt');
        
        if (isTiktokCmd && !urlMatch) {
            await sock.sendMessage(chatId, { react: { text: '⚠️', key: message.key } });
            await sock.sendMessage(chatId, {
                text: "⚠️ *Usage:* Please provide a valid TikTok link!\n\n*Example:* `.tiktok https://vm.tiktok.com` or `.tt https://vm.tiktok.com`"
            }, { quoted: message });
            return true;
        }

        // ----------------------------------------------------
        // 1. LINK එකක් යැවූ විට MENU එක යැවීම
        // ----------------------------------------------------
        if (urlMatch) {
            const cleanUrl = urlMatch[0];
            await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });

            let title = "TikTok Video";
            try {
                const res = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}`, {
                    headers: { 
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
                    },
                    timeout: 8000
                });
                if (res.data?.data?.title) title = res.data.data.title;
            } catch (e) {}

            const menuText = `🎬 *TIKTOK VIDEO DOWNLOADER*\n\n📌 *Title:* ${title}\n\nReply to this message with option number:\n1️⃣ *SD Quality (Watermarkless / Fast)*\n2️⃣ *HD Quality (High Quality)*`;

            const sentMenu = await sock.sendMessage(chatId, { text: menuText }, { quoted: message });

            // Session එක Save කර විනාඩි 10 කින් Auto-delete කිරීමට සැකසීම
            tiktokSessions.set(sentMenu.key.id, {
                url: cleanUrl,
                title: title
            });

            setTimeout(() => {
                tiktokSessions.delete(sentMenu.key.id);
            }, 10 * 60 * 1000);

            await sock.sendMessage(chatId, { react: { text: '📝', key: message.key } });
            return true;
        }

        // ----------------------------------------------------
        // 2. MENU එකට REPLY (1 හෝ 2) කළ විට VIDEO එක YAVIMA
        // ----------------------------------------------------
        const quotedMsgId = message.message?.extendedTextMessage?.contextInfo?.stanzaId;

        if (quotedMsgId && tiktokSessions.has(quotedMsgId)) {
            const session = tiktokSessions.get(quotedMsgId);
            const userChoice = text.trim();

            if (userChoice !== '1' && userChoice !== '2') {
                await sock.sendMessage(chatId, { 
                    text: "❌ Invalid Option! Please reply with *1* for SD or *2* for HD." 
                }, { quoted: message });
                return true;
            }

            await sock.sendMessage(chatId, { react: { text: '⬇️', key: message.key } });

            let videoUrl = null;
            let qualityLabel = userChoice === '2' ? 'HD Quality' : 'SD Quality';

            // Method 1: TikWM Primary API
            try {
                const res = await axios.post('https://www.tikwm.com/api/', 
                    new URLSearchParams({ url: session.url, hd: userChoice === '2' ? '1' : '0' }), 
                    {
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                        },
                        timeout: 10000
                    }
                );

                if (res.data?.data) {
                    const rawUrl = (userChoice === '2' && res.data.data.hdplay) 
                        ? res.data.data.hdplay 
                        : res.data.data.play;

                    if (rawUrl) {
                        videoUrl = rawUrl.startsWith('http') ? rawUrl : `https://www.tikwm.com${rawUrl}`;
                    }
                }
            } catch (e) {
                console.error("TikWM Method 1 Failed:", e.message);
            }

            // Method 2: Backup API (DavidCyril API)
            if (!videoUrl) {
                try {
                    const backupRes = await axios.get(`https://api.davidcyriltech.my.id/download/tiktok?url=${encodeURIComponent(session.url)}`, { timeout: 10000 });
                    if (backupRes.data?.success && backupRes.data?.result) {
                        videoUrl = (userChoice === '2' && backupRes.data.result.hdvideo) 
                            ? backupRes.data.result.hdvideo 
                            : backupRes.data.result.video;
                    }
                } catch (e) {
                    console.error("Backup API Failed:", e.message);
                }
            }

            // Video එක WhatsApp හරහා යැවීම
            if (videoUrl) {
                const caption = `🎬 *${session.title}*\n✨ *Quality:* ${qualityLabel}`;

                await sock.sendMessage(chatId, {
                    video: { url: videoUrl },
                    mimetype: "video/mp4",
                    caption: caption
                }, { quoted: message });

                await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
                
                // Instant delete වෙන line එක මෙතැනින් අයින් කර ඇත.
            } else {
                throw new Error("Failed to fetch video stream URL from all APIs");
            }
            return true;
        }

        return false;

    } catch (error) {
        console.error('TikTok Downloader Error:', error.message);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, { 
            text: "❌ Failed to download TikTok video. The video might be private or API is temporarily down."
        }, { quoted: message });
        return true;
    }
}

module.exports = tiktokCommand;