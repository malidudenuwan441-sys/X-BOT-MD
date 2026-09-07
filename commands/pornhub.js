const axios = require('axios');

global.phSessions = global.phSessions || {};

async function fetchPageWithBypass(url) {
    // Cloudflare TLS Block එක bypass කිරීමට Proxies & Mirror Scraper gateways
    const proxies = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?${encodeURIComponent(url)}`
    ];

    for (const proxyUrl of proxies) {
        try {
            const res = await axios.get(proxyUrl, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            if (res.data && res.data.includes('mediaDefinitions')) {
                return res.data;
            }
        } catch (e) {
            continue;
        }
    }
    
    // Proxy හරහා නොහැකි වුවහොත් Direct Request එකක් යැවීම
    const directRes = await axios.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Cookie': 'age_verified=1'
        }
    });
    return directRes.data;
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
                text: "⚠️ කරුණාකර වලංගු Pornhub Link එකක් ලබාදෙන්න.\n\n*උදාහරණ:* `.ph https://www.pornhub.com/view_video.php?viewkey=xxx`"
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            text: "🔄 Cloudflare Bypass කරමින් දත්ත සපයා ගනිමින් පවතී..."
        }, { quoted: message });

        const html = await fetchPageWithBypass(videoUrl);

        // Title Extract කරගැනීම
        const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
        const videoTitle = titleMatch ? titleMatch[1].replace(' - Pornhub.com', '').trim() : 'Pornhub Video';

        // mediaDefinitions Array එක 추출 කරගැනීම
        const mediaMatch = html.match(/mediaDefinitions\s*:\s*(\[.*?\])\s*,/s);

        if (!mediaMatch) {
            return await sock.sendMessage(chatId, {
                text: "❌ වීඩියෝ Qualities සොයාගැනීමට නොහැකි විය. Server IP එක Block වී ඇත."
            }, { quoted: message });
        }

        const mediaArray = JSON.parse(mediaMatch[1]);
        const mp4Videos = mediaArray.filter(m => m.format === 'mp4' && m.videoUrl);

        if (mp4Videos.length === 0) {
            return await sock.sendMessage(chatId, {
                text: "❌ direct MP4 ලින්ක් සොයාගැනීමට නොහැකි විය."
            }, { quoted: message });
        }

        mp4Videos.sort((a, b) => parseInt(b.quality) - parseInt(a.quality));

        global.phSessions[chatId] = {
            title: videoTitle,
            videos: mp4Videos,
            timestamp: Date.now()
        };

        // Interactive Quality Menu එක සැකසීම
        let menuText = `🎬 *${videoTitle}*\n\n`;
        menuText += `කරුණාකර ඔබට අවශ්‍ය Quality එකෙහි අංකය Reply කරන්න:\n\n`;

        mp4Videos.forEach((v, index) => {
            menuText += `*${index + 1}.* ${v.quality}p Quality\n`;
        });

        menuText += `\n📌 *උදාහරණ:* 720p සඳහා අදාළ අංකය Reply කරන්න.`;

        await sock.sendMessage(chatId, { text: menuText }, { quoted: message });

    } catch (error) {
        console.error("Bypass Scrape Error:", error.message);
        await sock.sendMessage(chatId, {
            text: "⚠️ Oracle Cloud IP Block එකක් නිසා වීඩියෝ දත්ත ලබා ගැනීමට නොහැකි විය!"
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
            headers: { 'User-Agent': 'Mozilla/5.0' }
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
