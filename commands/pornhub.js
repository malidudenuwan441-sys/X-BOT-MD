const axios = require('axios');

global.phSessions = global.phSessions || {};

// Cloudflare / IP Block එක bypass කිරීම සඳහා Gateway එක
async function getBypassedHtml(viewKey) {
    const targetUrl = `https://www.pornhub.com/embed/${viewKey}`;
    
    // Cloudflare TLS Handshake bypass කරන Proxies
    const proxyGateways = [
        `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`
    ];

    for (const proxy of proxyGateways) {
        try {
            const res = await axios.get(proxy, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            if (res.data && (res.data.includes('mediaDefinitions') || res.data.includes('flashvars'))) {
                return res.data;
            }
        } catch (e) {
            continue;
        }
    }
    return null;
}

async function phCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation ||
                     message.message?.extendedTextMessage?.text ||
                     message.message?.imageMessage?.caption ||
                     message.message?.videoMessage?.caption || "";

        const args = text.trim().split(/\s+/);
        const videoUrl = args[1];

        if (!videoUrl || !videoUrl.includes('pornhub.com')) {
            return await sock.sendMessage(chatId, {
                text: "⚠️ කරුණාකර වලංගු Pornhub Link එකක් ලබාදෙන්න.\n\n*උදාහරණ:* `.ph https://www.pornhub.com/view_video.php?viewkey=65047122dba4d`"
            }, { quoted: message });
        }

        const matchKey = videoUrl.match(/viewkey=([a-zA-Z0-9]+)/);
        if (!matchKey || !matchKey[1]) {
            return await sock.sendMessage(chatId, {
                text: "❌ අසම්පූර්ණ Link එකකි. Viewkey එක හඳුනාගත නොහැක."
            }, { quoted: message });
        }

        const viewKey = matchKey[1];

        await sock.sendMessage(chatId, {
            text: "🔄 Cloudflare Bypass කරමින් Qualities සොයමින් පවතී..."
        }, { quoted: message });

        const html = await getBypassedHtml(viewKey);

        if (!html) {
            return await sock.sendMessage(chatId, {
                text: "❌ වීඩියෝ දත්ත සපයා ගැනීමට නොහැකි විය. Proxy Gateways Block වී ඇත."
            }, { quoted: message });
        }

        // Title Extraction
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        let videoTitle = titleMatch ? titleMatch[1].replace(' - Pornhub.com', '').replace(' - Embed Player', '').trim() : 'Pornhub Video';

        // Media Definitions Extraction
        const mediaMatch = html.match(/mediaDefinitions\s*:\s*(\[.*?\])\s*,/s);

        let mp4Videos = [];

        if (mediaMatch) {
            try {
                const mediaArray = JSON.parse(mediaMatch[1]);
                mp4Videos = mediaArray.filter(m => m.format === 'mp4' && m.videoUrl && m.quality);
            } catch (e) {}
        }

        if (mp4Videos.length === 0) {
            // Manual Regex Extraction Fallback
            const qualityRegex = /"quality":"?(\d+)"?,"videoUrl":"([^"]+)"/g;
            let match;
            while ((match = qualityRegex.exec(html)) !== null) {
                mp4Videos.push({
                    quality: match[1],
                    videoUrl: match[2].replace(/\\/g, '')
                });
            }
        }

        if (mp4Videos.length === 0) {
            return await sock.sendMessage(chatId, {
                text: "❌ direct MP4 Qualities සොයාගැනීමට නොහැකි විය."
            }, { quoted: message });
        }

        // High to Low Quality Sort
        mp4Videos.sort((a, b) => parseInt(b.quality) - parseInt(a.quality));

        // Unique Qualities
        const uniqueVideos = [];
        const seenQualities = new Set();

        for (const v of mp4Videos) {
            const q = `${v.quality}`;
            if (!seenQualities.has(q)) {
                seenQualities.add(q);
                uniqueVideos.push(v);
            }
        }

        // Session Memory
        global.phSessions[chatId] = {
            title: videoTitle,
            videos: uniqueVideos,
            timestamp: Date.now()
        };

        // Quality Menu
        let menuText = `🎬 *${videoTitle}*\n\n`;
        menuText += `කරුණාකර ඔබට අවශ්‍ය Quality එකෙහි අංකය Reply කරන්න:\n\n`;

        uniqueVideos.forEach((v, index) => {
            menuText += `*${index + 1}.* ${v.quality}p Quality\n`;
        });

        menuText += `\n📌 *උදාහරණ:* 720p සඳහා අදාළ අංකය Reply කරන්න.`;

        await sock.sendMessage(chatId, { text: menuText }, { quoted: message });

    } catch (error) {
        console.error("Bypass Error:", error.message);
        await sock.sendMessage(chatId, {
            text: "⚠️ වීඩියෝ දත්ත ලබා ගැනීමේදී දෝෂයක් සිදු විය!"
        }, { quoted: message });
    }
}

async function handlePhReply(sock, chatId, message, userText) {
    const session = global.phSessions[chatId];
    if (!session) return false;

    if (Date.now() - session.timestamp > 5 * 60 * 1000) {
        delete global.phSessions[chatId];
        return false;
    }

    const selectedIndex = parseInt(userText.trim()) - 1;

    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= session.videos.length) {
        return false;
    }

    const selectedVideo = session.videos[selectedIndex];
    const downloadUrl = selectedVideo.videoUrl;
    const videoTitle = session.title;
    const qualityLabel = `${selectedVideo.quality}p`;

    delete global.phSessions[chatId];

    await sock.sendMessage(chatId, {
        text: `⏳ *${qualityLabel}* වීඩියෝව Download වෙමින් පවතී...`
    }, { quoted: message });

    try {
        const videoStream = await axios.get(downloadUrl, {
            responseType: 'arraybuffer',
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' 
            }
        });

        const videoBuffer = Buffer.from(videoStream.data);
        const fileSizeInMB = videoBuffer.length / (1024 * 1024);

        if (fileSizeInMB <= 64) {
            await sock.sendMessage(chatId, {
                video: videoBuffer,
                caption: `🎬 *${videoTitle}*\n📊 Quality: ${qualityLabel}\n📦 Size: ${fileSizeInMB.toFixed(1)} MB`
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, {
                document: videoBuffer,
                mimetype: 'video/mp4',
                fileName: `${videoTitle.replace(/[^a-zA-Z0-9]/g, "_")}.mp4`,
                caption: `📁 *${videoTitle}*\n📊 Quality: ${qualityLabel}\n📦 Size: ${fileSizeInMB.toFixed(1)} MB`
            }, { quoted: message });
        }
    } catch (err) {
        console.error("Video Download Error:", err.message);
        await sock.sendMessage(chatId, {
            text: "❌ වීඩියෝව Download කිරීමට නොහැකි විය."
        }, { quoted: message });
    }

    return true;
}

module.exports = { phCommand, handlePhReply };
