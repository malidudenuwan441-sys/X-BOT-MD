const axios = require('axios');

global.phSessions = global.phSessions || {};

async function getPornhubHtml(url) {
    // Cloudflare IP Block එක Bypass කිරීම සඳහා Working Scraper Proxy Gateway
    const proxyUrl = `https://cors-proxy.htmldriven.com/?url=${encodeURIComponent(url)}`;
    
    try {
        const res = await axios.get(proxyUrl, {
            timeout: 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Cookie': 'age_verified=1'
            }
        });
        return res.data;
    } catch (err) {
        // Fallback proxy mechanism
        const fallbackProxy = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`;
        const resFallback = await axios.get(fallbackProxy, { timeout: 20000 });
        return resFallback.data;
    }
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
            text: "🔄 Direct Scraping මගින් Qualities සපයා ගනිමින් පවතී..."
        }, { quoted: message });

        const html = await getPornhubHtml(videoUrl);

        if (!html || typeof html !== 'string') {
            return await sock.sendMessage(chatId, {
                text: "❌ වීඩියෝ පිටුව ලබාගැනීමට නොහැකි විය."
            }, { quoted: message });
        }

        // Title Extraction
        const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
        const videoTitle = titleMatch ? titleMatch[1].replace(' - Pornhub.com', '').trim() : 'Pornhub Video';

        // Extracting mediaDefinitions array from page source
        const mediaMatch = html.match(/mediaDefinitions\s*:\s*(\[.*?\])\s*,/s);

        if (!mediaMatch) {
            return await sock.sendMessage(chatId, {
                text: "❌ වීඩියෝ Qualities සොයාගැනීමට නොහැකි විය. වීඩියෝව ඉවත් කර හෝ Private කර ඇත."
            }, { quoted: message });
        }

        const mediaArray = JSON.parse(mediaMatch[1]);
        const mp4Videos = mediaArray.filter(m => m.format === 'mp4' && m.videoUrl && m.quality);

        if (mp4Videos.length === 0) {
            return await sock.sendMessage(chatId, {
                text: "❌ direct MP4 ලින්ක් සොයාගැනීමට නොහැකි විය."
            }, { quoted: message });
        }

        // Quality අනුව Sort කිරීම (1080p, 720p, 480p, 240p)
        mp4Videos.sort((a, b) => parseInt(b.quality) - parseInt(a.quality));

        // Unique Qualities පමණක් ලබාගැනීම
        const uniqueVideos = [];
        const seenQualities = new Set();

        for (const v of mp4Videos) {
            const q = `${v.quality}`;
            if (!seenQualities.has(q)) {
                seenQualities.add(q);
                uniqueVideos.push(v);
            }
        }

        // Memory Session එකෙහි Save කිරීම
        global.phSessions[chatId] = {
            title: videoTitle,
            videos: uniqueVideos,
            timestamp: Date.now()
        };

        // User Interactive Menu එක සැකසීම
        let menuText = `🎬 *${videoTitle}*\n\n`;
        menuText += `කරුණාකර ඔබට අවශ්‍ය Quality එකෙහි අංකය Reply කරන්න:\n\n`;

        uniqueVideos.forEach((v, index) => {
            menuText += `*${index + 1}.* ${v.quality}p Quality\n`;
        });

        menuText += `\n📌 *උදාහරණ:* 720p සඳහා අදාළ අංකය Reply කරන්න.`;

        await sock.sendMessage(chatId, { text: menuText }, { quoted: message });

    } catch (error) {
        console.error("Scrape Error:", error.message);
        await sock.sendMessage(chatId, {
            text: "⚠️ වීඩියෝ දත්ත Scrape කිරීමේදී දෝෂයක් සිදු විය!"
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
