const { exec } = require('child_process');
const util = require('util');
const axios = require('axios');
const execPromise = util.promisify(exec);

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
            text: "🔄 Qualities සොයමින් පවතී, කරුණාකර මොහොතක් රැඳී සිටින්න..."
        }, { quoted: message });

        // yt-dlp මගින් Video JSON Data Extraction
        const { stdout } = await execPromise(`yt-dlp -j "${videoUrl}"`);
        const videoData = JSON.parse(stdout);

        const videoTitle = videoData.title || "Pornhub Video";
        const formats = videoData.formats || [];

        // Direct HTTP/HTTPS MP4 Formats ලබාගැනීම
        const mp4Videos = formats.filter(f => f.ext === 'mp4' && f.url && f.height);

        if (mp4Videos.length === 0) {
            return await sock.sendMessage(chatId, {
                text: "❌ වීඩියෝ Qualities ලබා ගැනීමට නොහැකි විය."
            }, { quoted: message });
        }

        // Quality අනුව Sort කිරීම (උසස්ම Quality එක උඩට)
        mp4Videos.sort((a, b) => b.height - a.height);

        // Unique Qualities පමණක් වෙන් කර ගැනීම (Duplicate Heights ඉවත් කිරීම)
        const uniqueVideos = [];
        const seenHeights = new Set();

        for (const video of mp4Videos) {
            if (!seenHeights.has(video.height)) {
                seenHeights.add(video.height);
                uniqueVideos.push(video);
            }
        }

        // Session එකෙහි Save කිරීම
        global.phSessions[chatId] = {
            title: videoTitle,
            videos: uniqueVideos,
            timestamp: Date.now()
        };

        // Interactive Quality Menu එක සැකසීම
        let menuText = `🎬 *${videoTitle}*\n\n`;
        menuText += `කරුණාකර ඔබට අවශ්‍ය Quality එකෙහි අංකය Reply කරන්න:\n\n`;

        uniqueVideos.forEach((v, index) => {
            menuText += `*${index + 1}.* ${v.height}p Quality\n`;
        });

        menuText += `\n📌 *උදාහරණ:* 720p සඳහා අදාළ අංකය Reply කරන්න.`;

        await sock.sendMessage(chatId, { text: menuText }, { quoted: message });

    } catch (error) {
        console.error("yt-dlp Error:", error.message);
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
    const qualityLabel = `${selectedVideo.height}p`;

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
