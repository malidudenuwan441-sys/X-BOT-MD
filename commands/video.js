const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const fs = require('fs');
const path = require('path');

const pendingYtDownloads = new Map();

// Custom Agent Settings for Bypass
const agent = ytdl.createAgent([
    {
        name: 'PO_TOKEN',
        value: '' 
    }
]);

async function videoCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const searchQuery = text.split(' ').slice(1).join(' ').trim();

        if (!searchQuery) {
            await sock.sendMessage(chatId, { text: '❌ කරුණාකර වීඩියෝ නමක් හෝ YouTube Link එකක් ලබාදෙන්න!' }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        let videoUrl = searchQuery;
        let videoTitle = '';
        let videoThumbnail = '';

        if (!searchQuery.startsWith('http://') && !searchQuery.startsWith('https://')) {
            const { videos } = await yts(searchQuery);
            if (!videos || videos.length === 0) {
                await sock.sendMessage(chatId, { text: '❌ වීඩියෝව සොයාගැනීමට නොහැකි විය!' }, { quoted: message });
                return;
            }
            videoUrl = videos[0].url;
            videoTitle = videos[0].title;
            videoThumbnail = videos[0].thumbnail;
        }

        const menuText = `🎬 *YOUTUBE VIDEO DOWNLOADER*\n\n` +
                         `📌 *Title:* ${videoTitle || 'YouTube Video'}\n\n` +
                         `Quality එක තෝරා ගැනීමට අංකයකින් Reply කරන්න:\n` +
                         `1️⃣ *360p / 480p*\n` +
                         `2️⃣ *720p (HD)*`;

        const sentMsg = await sock.sendMessage(chatId, { 
            image: { url: videoThumbnail || `https://i.ytimg.com/vi/default.jpg` }, 
            caption: menuText 
        }, { quoted: message });

        pendingYtDownloads.set(sentMsg.key.id, {
            url: videoUrl,
            title: videoTitle,
            timestamp: Date.now()
        });

        await sock.sendMessage(chatId, { react: { text: '📲', key: message.key } });

    } catch (error) {
        console.error('[VIDEO] Command Error:', error?.message || error);
        await sock.sendMessage(chatId, { text: '❌ වීඩියෝ තොරතුරු ලබාගැනීමට නොහැකි විය.' }, { quoted: message });
    }
}

async function handleYtVideoReply(sock, chatId, message) {
    try {
        const text = (message.message?.conversation || message.message?.extendedTextMessage?.text || '').trim();
        const quotedMsgId = message.message?.extendedTextMessage?.contextInfo?.stanzaId;

        if (!quotedMsgId || !pendingYtDownloads.has(quotedMsgId)) return false;

        let quality = '360';
        if (text === '1') quality = '18'; // 360p mp4 format code
        else if (text === '2') quality = '22'; // 720p mp4 format code
        else return false;

        const downloadData = pendingYtDownloads.get(quotedMsgId);
        pendingYtDownloads.delete(quotedMsgId);

        await sock.sendMessage(chatId, { react: { text: '⬇️', key: message.key } });

        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const outputPath = path.join(tempDir, `yt_${Date.now()}.mp4`);

        // Download via ytdl with iOS client options
        const stream = ytdl(downloadData.url, {
            quality: quality,
            client: 'ios',
            agent: agent
        }).pipe(fs.createWriteStream(outputPath));

        stream.on('finish', async () => {
            await sock.sendMessage(chatId, { react: { text: '📤', key: message.key } });

            await sock.sendMessage(chatId, {
                video: { url: outputPath },
                mimetype: 'video/mp4',
                caption: `🎬 *${downloadData.title}*\n\n> *_Downloaded by X-Bot_*`
            }, { quoted: message });

            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        });

        stream.on('error', async (err) => {
            console.error('[Stream Error]:', err);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            await sock.sendMessage(chatId, { text: '❌ Download කිරීම අසාර්ථක විය.' }, { quoted: message });
        });

        return true;

    } catch (error) {
        console.error('YT Reply Error:', error.message);
        return false;
    }
}

module.exports = { 
    videoCommand, 
    handleYtVideoReply,
    handleVideoReply: handleYtVideoReply
};
