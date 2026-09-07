const axios = require('axios');

async function phCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation ||
                     message.message?.extendedTextMessage?.text ||
                     message.message?.imageMessage?.caption ||
                     message.message?.videoMessage?.caption || "";

        // Link එකෙන් පිටත ඇති Command කොටස ඉවත් කිරීම (.ph <link>)
        const videoUrl = text.slice(3).trim();

        if (!videoUrl) {
            return await sock.sendMessage(chatId, {
                text: "⚠️ කරුණාකර වලංගු Link එකක් ලබාදෙන්න.\n\nඋදාහරණ: `.ph <Pornhub Link>`"
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            text: "🔄 වීඩියෝව Process වෙමින් පවතී, කරුණාකර රැඳී සිටින්න..."
        }, { quoted: message });

        // Downix Backend API එකට Request එකක් යැවීම
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
                text: "❌ වීඩියෝව සොයාගැනීමට නොහැකි විය. Link එක නිවැරදිදැයි පරීක්ෂා කරන්න."
            }, { quoted: message });
        }

        // 720p හෝ 480p හෝ ඇති හොඳම Quality එක තෝරාගැනීම
        const videos = data.videos;
        let selectedVideo = videos.find(v => v.quality === '720p' || v.quality === '720') 
                          || videos.find(v => v.quality === '480p' || v.quality === '480') 
                          || videos[0];

        const downloadUrl = selectedVideo.url || selectedVideo.link;
        const videoTitle = data.title || 'Video';

        // Direct Video Buffer එක ලබා ගැනීම
        const videoStream = await axios.get(downloadUrl, { 
            responseType: 'arraybuffer',
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const videoBuffer = Buffer.from(videoStream.data);
        const fileSizeInMB = videoBuffer.length / (1024 * 1024);

        // File Size එක අනුව Video හෝ Document ලෙස Send කිරීම
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

    } catch (error) {
        console.error("Pornhub Command Error:", error.message);
        await sock.sendMessage(chatId, {
            text: "⚠️ වීඩියෝව Download කිරීමේදී දෝෂයක් සිදු විය!"
        }, { quoted: message });
    }
}

module.exports = phCommand;
