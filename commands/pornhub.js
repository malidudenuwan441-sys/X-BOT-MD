const axios = require('axios');

// User ගේ session සහ download links තාවකාලිකව තබා ගැනීමට Memory Store එකක්
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
            text: "🔄 Downix.org මගින් Qualities සපයා ගනිමින් පවතී..."
        }, { quoted: message });

        // Downix Backend API එකට Request යැවීම
        const apiResponse = await axios.post('https://ph-api.com/extract', {
            url: videoUrl
        }, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Origin': 'https://downix.org',
                'Referer': 'https://downix.org/'
            }
        });

        const data = apiResponse.data;

        if (!data || !data.videos || data.videos.length === 0) {
            return await sock.sendMessage(chatId, {
                text: "❌ වීඩියෝ ලින්ක් ලබා ගැනීමට නොහැකි විය. Link එක නැවත පරීක්ෂා කරන්න."
            }, { quoted: message });
        }

        const videoTitle = data.title || 'Pornhub Video';
        const videos = data.videos;

        // User සඳහා Session එකක් Save කිරීම
        global.phSessions[chatId] = {
            title: videoTitle,
            videos: videos,
            timestamp: Date.now()
        };

        // Quality Menu එක සැකසීම
        let menuText = `🎬 *${videoTitle}*\n\n`;
        menuText += `කරුණාකර ඔබට අවශ්‍ය Quality එකෙහි අංකය Reply කරන්න:\n\n`;

        videos.forEach((v, index) => {
            menuText += `*${index + 1}.* ${v.quality || 'HD'} Quality\n`;
        });

        menuText += `\n📌 *උදාහරණ:* 480p අවශ්‍ය නම් *2* ලෙස Reply කරන්න.`;

        await sock.sendMessage(chatId, { text: menuText }, { quoted: message });

    } catch (error) {
        console.error("Downix Scraping Error:", error.message);
        await sock.sendMessage(chatId, {
            text: "⚠️ Downix.org වෙතින් දත්ත ලබා ගැනීමේදී දෝෂයක් සිදු විය!"
        }, { quoted: message });
    }
}

// User Reply එක Handle කරන Function එක
async function handlePhReply(sock, chatId, message, userText) {
    const session = global.phSessions[chatId];
    if (!session) return false;

    // විනාඩි 5කට වඩා පැරණි Sessions ඉවත් කිරීම
    if (Date.now() - session.timestamp > 5 * 60 * 1000) {
        delete global.phSessions[chatId];
        return false;
    }

    const selectedIndex = parseInt(userText.trim()) - 1;

    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= session.videos.length) {
        return false;
    }

    const selectedVideo = session.videos[selectedIndex];
    const downloadUrl = selectedVideo.url || selectedVideo.link;
    const videoTitle = session.title;

    // Menu එක පාවිච්චි කළ පසු Session එක Clear කිරීම
    delete global.phSessions[chatId];

    await sock.sendMessage(chatId, {
        text: `⏳ *${selectedVideo.quality}* වීඩියෝව Download වෙමින් පවතී, කරුණාකර රැඳී සිටින්න...`
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
                caption: `🎬 *${videoTitle}*\n📊 Quality: ${selectedVideo.quality}\n📦 Size: ${fileSizeInMB.toFixed(1)} MB`
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, {
                document: videoBuffer,
                mimetype: 'video/mp4',
                fileName: `${videoTitle.replace(/[^a-zA-Z0-9]/g, "_")}.mp4`,
                caption: `📁 *${videoTitle}*\n📊 Quality: ${selectedVideo.quality}\n📦 Size: ${fileSizeInMB.toFixed(1)} MB`
            }, { quoted: message });
        }
    } catch (err) {
        console.error("Video Download Error:", err.message);
        await sock.sendMessage(chatId, {
            text: "❌ වීඩියෝව Download කිරීමට නොහැකි විය. File Size එක WhatsApp සීමාවට වඩා වැඩි විය හැක."
        }, { quoted: message });
    }

    return true;
}

module.exports = { phCommand, handlePhReply };
