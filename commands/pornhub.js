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
                text: "⚠️ කරුණාකර වලංගු Pornhub Link එකක් ලබාදෙන්න.\n\n*උදාහරණ:* `.ph https://www.pornhub.com/view_video.php?viewkey=65047122dba4d`"
            }, { quoted: message });
        }

        // URL එකෙන් viewkey එක පමණක් වෙන් කර ගැනීම
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

        // Pornhub Direct Phkey Media Scraper Gateway (Bypass 522 & Cloudflare Block)
        const embedUrl = `https://www.pornhub.com/embed/${viewKey}`;

        const res = await axios.get(embedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                'Cookie': 'age_verified=1; adheres_to_fc=1'
            },
            timeout: 15000
        });

        const html = res.data;

        // Title Extraction
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        let videoTitle = titleMatch ? titleMatch[1].replace(' - Pornhub.com', '').replace(' - Embed Player', '').trim() : 'Pornhub Video';

        // Flashvars/Player variables Regex Extraction
        const flashvarsMatch = html.match(/var\040flashvars_[\d]+\040=\040(\x7b[\s\S]*?\x7d);/) || html.match(/mediaDefinitions\s*:\s*(\[.*?\])\s*,/s);

        let mp4Videos = [];

        if (flashvarsMatch) {
            let mediaData = [];
            try {
                mediaData = JSON.parse(flashvarsMatch[1]);
            } catch (e) {
                // Flashvars Regex Manual Extraction Fallback
                const qualityRegex = /"quality":"?(\d+)"?,"videoUrl":"([^"]+)"/g;
                let match;
                while ((match = qualityRegex.exec(html)) !== null) {
                    mp4Videos.push({
                        quality: match[1],
                        videoUrl: match[2].replace(/\\/g, '')
                    });
                }
            }

            if (Array.isArray(mediaData)) {
                mp4Videos = mediaData.filter(m => m.format === 'mp4' && m.videoUrl && m.quality);
            } else if (mediaData.mediaDefinitions) {
                mp4Videos = mediaData.mediaDefinitions.filter(m => m.format === 'mp4' && m.videoUrl && m.quality);
            }
        }

        if (mp4Videos.length === 0) {
            return await sock.sendMessage(chatId, {
                text: "❌ වීඩියෝ Qualities සොයාගැනීමට නොහැකි විය. Server Firewall එක මගින් Block කර ඇත."
            }, { quoted: message });
        }

        // Quality අනුව High to Low Sort කිරීම
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

        // Session Save කිරීම
        global.phSessions[chatId] = {
            title: videoTitle,
            videos: uniqueVideos,
            timestamp: Date.now()
        };

        // Reply Menu
        let menuText = `🎬 *${videoTitle}*\n\n`;
        menuText += `කරුණාකර ඔබට අවශ්‍ය Quality එකෙහි අංකය Reply කරන්න:\n\n`;

        uniqueVideos.forEach((v, index) => {
            menuText += `*${index + 1}.* ${v.quality}p Quality\n`;
        });

        menuText += `\n📌 *උදාහරණ:* 720p සඳහා අදාළ අංකය Reply කරන්න.`;

        await sock.sendMessage(chatId, { text: menuText }, { quoted: message });

    } catch (error) {
        console.error("Embed Scrape Error:", error.message);
        await sock.sendMessage(chatId, {
            text: "⚠️ Cloudflare Connection Time-out (522) දෝෂයක් සිදු විය. කරුණාකර තව මොහොතකින් උත්සාහ කරන්න."
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
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15' 
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
