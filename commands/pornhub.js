const axios = require('axios');

global.phSessions = global.phSessions || {};

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
            text: "🔄 IP Block එක Bypass කරමින් Qualities සපයා ගනිමින් පවතී..."
        }, { quoted: message });

        // Cloudflare IP Bypass Gateway (No Key Required Public Endpoint)
        const response = await axios.get(`https://api.vreden.web.id/api/pornhubdl?url=${encodeURIComponent(videoUrl)}`, {
            timeout: 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });

        const resData = response.data;

        if (!resData || !resData.result || !resData.result.media) {
            return await sock.sendMessage(chatId, {
                text: "❌ වීඩියෝ Qualities සොයාගැනීමට නොහැකි විය. Link එක නැවත පරීක්ෂා කරන්න."
            }, { quoted: message });
        }

        const videoTitle = resData.result.title || 'Pornhub Video';
        const mediaList = resData.result.media || [];

        // Direct MP4 Formats පමණක් වෙන්කර ගැනීම
        const mp4Videos = mediaList.filter(m => m.url && m.quality);

        if (mp4Videos.length === 0) {
            return await sock.sendMessage(chatId, {
                text: "❌ direct MP4 ලින්ක් සොයාගැනීමට නොහැකි විය."
            }, { quoted: message });
        }

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
            text: "⚠️ වීඩියෝ දත්ත ලබා ගැනීමේදී දෝෂයක් සිදු විය! (Server Gateway Error)"
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
