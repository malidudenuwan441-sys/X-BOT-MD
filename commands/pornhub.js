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
            text: "🔄 Cloudflare Bypass කරමින් Qualities සොයමින් පවතී..."
        }, { quoted: message });

        // Native Linux curl command එක මගින් HTML Extract කරගැනීම (Cloudflare Block එක bypass වේ)
        const curlCommand = `curl -s -L -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -b "age_verified=1" "${videoUrl}"`;
        
        const { stdout: html } = await execPromise(curlCommand);

        if (!html || html.length < 1000) {
            return await sock.sendMessage(chatId, {
                text: "❌ වීඩියෝ පිටුව ලබාගැනීමට නොහැකි විය. Link එක නැවත පරීක්ෂා කරන්න."
            }, { quoted: message });
        }

        // Title Extraction
        const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
        let videoTitle = titleMatch ? titleMatch[1].replace(' - Pornhub.com', '').trim() : 'Pornhub Video';

        // Direct Player Javascript Array Extraction
        const mediaMatch = html.match(/mediaDefinitions\s*:\s*(\[.*?\])\s*,/s);

        if (!mediaMatch) {
            return await sock.sendMessage(chatId, {
                text: "❌ වීඩියෝ Qualities සොයාගැනීමට නොහැකි විය. වීඩියෝව Private හෝ ඉවත් කර ඇත."
            }, { quoted: message });
        }

        const mediaArray = JSON.parse(mediaMatch[1]);
        const mp4Videos = mediaArray.filter(m => m.format === 'mp4' && m.videoUrl && m.quality);

        if (mp4Videos.length === 0) {
            return await sock.sendMessage(chatId, {
                text: "❌ direct MP4 ලින්ක් සොයාගැනීමට නොහැකි විය."
            }, { quoted: message });
        }

        // Quality අනුව High to Low Sort කිරීම
        mp4Videos.sort((a, b) => {
            const qA = parseInt(a.quality) || 0;
            const qB = parseInt(b.quality) || 0;
            return qB - qA;
        });

        // Unique Qualities පමණක් තබා ගැනීම
        const uniqueVideos = [];
        const seenQualities = new Set();

        for (const item of mp4Videos) {
            const qStr = `${item.quality}`;
            if (!seenQualities.has(qStr)) {
                seenQualities.add(qStr);
                uniqueVideos.push(item);
            }
        }

        // Memory Session Save
        global.phSessions[chatId] = {
            title: videoTitle,
            videos: uniqueVideos,
            timestamp: Date.now()
        };

        // Menu Message
        let menuText = `🎬 *${videoTitle}*\n\n`;
        menuText += `කරුණාකර ඔබට අවශ්‍ය Quality එකෙහි අංකය Reply කරන්න:\n\n`;

        uniqueVideos.forEach((v, index) => {
            menuText += `*${index + 1}.* ${v.quality}p Quality\n`;
        });

        menuText += `\n📌 *උදාහරණ:* 720p සඳහා අදාළ අංකය Reply කරන්න.`;

        await sock.sendMessage(chatId, { text: menuText }, { quoted: message });

    } catch (error) {
        console.error("Curl Scrape Error:", error.message);
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
