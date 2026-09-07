const axios = require('axios');

global.phSessions = global.phSessions || {};

// Cloudflare / IP Block මඟහැරීමට Rotational Public APIs
async function fetchPornhubData(url) {
    const apiEndpoints = [
        `https://api.lolhuman.xyz/api/pornhub?apikey=GaysKey&url=${encodeURIComponent(url)}`,
        `https://ragadot.my.id/api/downloader/pornhub?url=${encodeURIComponent(url)}`,
        `https://api.guruapi.tech/v2/pornhub?url=${encodeURIComponent(url)}`
    ];

    for (const endpoint of apiEndpoints) {
        try {
            const res = await axios.get(endpoint, {
                timeout: 12000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            // Standardize format across different API responses
            if (res.data) {
                if (res.data.result && Array.isArray(res.data.result.media)) {
                    return {
                        title: res.data.result.title || 'Pornhub Video',
                        videos: res.data.result.media.map(m => ({ quality: m.quality, url: m.url }))
                    };
                } else if (res.data.result && Array.isArray(res.data.result.mediaDefinitions)) {
                    return {
                        title: res.data.result.title || 'Pornhub Video',
                        videos: res.data.result.mediaDefinitions.filter(m => m.videoUrl).map(m => ({ quality: `${m.quality}p`, url: m.videoUrl }))
                    };
                } else if (res.data.result && res.data.result.downloads) {
                    return {
                        title: res.data.result.title || 'Pornhub Video',
                        videos: res.data.result.downloads.map(m => ({ quality: m.quality || 'HD', url: m.url || m.link }))
                    };
                }
            }
        } catch (e) {
            continue; // ඊළඟ API Endpoint එකට මාරු වීම
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
                text: "⚠️ කරුණාකර වලංගු Pornhub Link එකක් ලබාදෙන්න.\n\n*උදාහරණ:* `.ph https://www.pornhub.com/view_video.php?viewkey=xxx`"
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            text: "🔄 Qualities සපයා ගනිමින් පවතී, කරුණාකර මොහොතක් රැඳී සිටින්න..."
        }, { quoted: message });

        const data = await fetchPornhubData(videoUrl);

        if (!data || !data.videos || data.videos.length === 0) {
            return await sock.sendMessage(chatId, {
                text: "❌ වීඩියෝ Qualities ලබා ගැනීමට නොහැකි විය. කරුණාකර වෙනත් Link එකක් උත්සාහ කරන්න."
            }, { quoted: message });
        }

        const videoTitle = data.title;
        const mp4Videos = data.videos.filter(v => v.url);

        // Session Memory එකේ Save කිරීම
        global.phSessions[chatId] = {
            title: videoTitle,
            videos: mp4Videos,
            timestamp: Date.now()
        };

        // Quality Menu එක සැකසීම
        let menuText = `🎬 *${videoTitle}*\n\n`;
        menuText += `කරුණාකර ඔබට අවශ්‍ය Quality එකෙහි අංකය Reply කරන්න:\n\n`;

        mp4Videos.forEach((v, index) => {
            menuText += `*${index + 1}.* ${v.quality} Quality\n`;
        });

        menuText += `\n📌 *උදාහරණ:* 720p සඳහා අදාළ අංකය Reply කරන්න.`;

        await sock.sendMessage(chatId, { text: menuText }, { quoted: message });

    } catch (error) {
        console.error("API Fetch Error:", error.message);
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
    const downloadUrl = selectedVideo.url;
    const videoTitle = session.title;
    const qualityLabel = selectedVideo.quality;

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
