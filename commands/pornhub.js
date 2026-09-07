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
            text: "🔄 Downix.org මගින් Qualities ලබා ගනිමින් පවතී..."
        }, { quoted: message });

        // Browser Headers එකතු කර Downix API එකට POST Request එක යැවීම
        const apiResponse = await axios.post('https://ph-api.com/extract', 
            { url: videoUrl },
            {
                headers: {
                    'accept': '*/*',
                    'accept-language': 'en-US,en;q=0.9,si;q=0.8',
                    'content-type': 'application/json',
                    'origin': 'https://downix.org',
                    'referer': 'https://downix.org/',
                    'sec-ch-ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'cross-site',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
                }
            }
        );

        const data = apiResponse.data;

        // Formats/Videos Array එක සෙවීම
        const videos = data.videos || data.media || data.formats || [];

        if (!data || videos.length === 0) {
            return await sock.sendMessage(chatId, {
                text: "❌ වීඩියෝ Qualities සොයාගැනීමට නොහැකි විය. Link එක පරීක්ෂා කරන්න."
            }, { quoted: message });
        }

        const videoTitle = data.title || 'Pornhub Video';

        // Memory එකේ Data තබා ගැනීම
        global.phSessions[chatId] = {
            title: videoTitle,
            videos: videos,
            timestamp: Date.now()
        };

        // User සඳහා Interactive Menu එක සැකසීම
        let menuText = `🎬 *${videoTitle}*\n\n`;
        menuText += `කරුණාකර ඔබට අවශ්‍ය Quality එකෙහි අංකය Reply කරන්න:\n\n`;

        videos.forEach((v, index) => {
            const qualityName = v.quality || v.resolution || `${v.height}p` || 'HD';
            const sizeText = v.size ? ` (${v.size})` : '';
            menuText += `*${index + 1}.* ${qualityName}${sizeText}\n`;
        });

        menuText += `\n📌 *උදාහරණ:* 480p අවශ්‍ය නම් *2* ලෙස Reply කරන්න.`;

        await sock.sendMessage(chatId, { text: menuText }, { quoted: message });

    } catch (error) {
        console.error("Downix Extract Error:", error.response?.data || error.message);
        await sock.sendMessage(chatId, {
            text: "⚠️ Downix.org වෙතින් දත්ත ලබා ගැනීමේදී දෝෂයක් සිදු විය! (Status: " + (error.response?.status || '500') + ")"
        }, { quoted: message });
    }
}

async function handlePhReply(sock, chatId, message, userText) {
    const session = global.phSessions[chatId];
    if (!session) return false;

    // විනාඩි 5ක් ඉක්මගිය Sessions ඉවත් කිරීම
    if (Date.now() - session.timestamp > 5 * 60 * 1000) {
        delete global.phSessions[chatId];
        return false;
    }

    const selectedIndex = parseInt(userText.trim()) - 1;

    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= session.videos.length) {
        return false;
    }

    const selectedVideo = session.videos[selectedIndex];
    const downloadUrl = selectedVideo.url || selectedVideo.link || selectedVideo.download_url;
    const videoTitle = session.title;
    const qualityLabel = selectedVideo.quality || selectedVideo.resolution || 'HD';

    delete global.phSessions[chatId];

    await sock.sendMessage(chatId, {
        text: `⏳ *${qualityLabel}* වීඩියෝව Download වෙමින් පවතී, කරුණාකර රැඳී සිටින්න...`
    }, { quoted: message });

    try {
        const videoStream = await axios.get(downloadUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
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
