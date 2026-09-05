const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const fs = require('fs');
const path = require('path');

const pendingYtDownloads = new Map();

async function videoCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const searchQuery = text.split(' ').slice(1).join(' ').trim();

        if (!searchQuery) {
            await sock.sendMessage(chatId, { text: '❌ කරුණාකර වීඩියෝ නමක් හෝ YouTube Link එකක් ලබාදෙන්න!\n\n*Example:* `.video Faded`' }, { quoted: message });
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

        const ytId = (videoUrl.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) || [])[1];
        if (!ytId) {
            await sock.sendMessage(chatId, { text: '❌ වලංගු නොවන YouTube Link එකකි!' }, { quoted: message });
            return;
        }

        if (!videoTitle) {
            const searchRes = await yts({ videoId: ytId });
            videoTitle = searchRes.title || 'YouTube Video';
            videoThumbnail = searchRes.thumbnail || `https://i.ytimg.com/vi/${ytId}/sddefault.jpg`;
        }

        const menuText = `🎬 *YOUTUBE VIDEO DOWNLOADER*\n\n` +
                         `📌 *Title:* ${videoTitle}\n\n` +
                         `Quality එක තෝරා ගැනීමට අංකයකින් Reply කරන්න:\n` +
                         `1️⃣ *360p / 480p (Normal)*\n` +
                         `2️⃣ *720p (HD)*\n` +
                         `3️⃣ *Highest Quality*`;

        let sentMsg;
        if (videoThumbnail) {
            sentMsg = await sock.sendMessage(chatId, { image: { url: videoThumbnail }, caption: menuText }, { quoted: message });
        } else {
            sentMsg = await sock.sendMessage(chatId, { text: menuText }, { quoted: message });
        }

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

        let filterQuality = 'lowestvideo';
        if (text === '1') filterQuality = 'lowestvideo';
        else if (text === '2') filterQuality = 'highestvideo';
        else if (text === '3') filterQuality = 'highest';
        else return false;

        const downloadData = pendingYtDownloads.get(quotedMsgId);
        pendingYtDownloads.delete(quotedMsgId);

        await sock.sendMessage(chatId, { react: { text: '⬇️', key: message.key } });
        await sock.sendMessage(chatId, { text: `📥 *Downloading Video...*` }, { quoted: message });

        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const outputPath = path.join(tempDir, `yt_${Date.now()}.mp4`);

        // Stream via ytdl-core (Bypasses system restrictions)
        const videoStream = ytdl(downloadData.url, {
            quality: filterQuality,
            filter: format => format.container === 'mp4'
        });

        const fileStream = fs.createWriteStream(outputPath);
        videoStream.pipe(fileStream);

        fileStream.on('finish', async () => {
            try {
                const stats = fs.statSync(outputPath);
                const sizeInMB = stats.size / (1024 * 1024);

                if (sizeInMB > 200) {
                    fs.unlinkSync(outputPath);
                    await sock.sendMessage(chatId, { react: { text: '⚠️', key: message.key } });
                    return await sock.sendMessage(chatId, { text: `⚠️ File size එක MB 200 ට වඩා වැඩිය (${sizeInMB.toFixed(1)} MB).` }, { quoted: message });
                }

                await sock.sendMessage(chatId, { react: { text: '📤', key: message.key } });

                if (sizeInMB > 64) {
                    await sock.sendMessage(chatId, {
                        document: { url: outputPath },
                        mimetype: 'video/mp4',
                        fileName: `${downloadData.title.replace(/[^\w\s-]/g, '')}.mp4`,
                        caption: `🎬 *${downloadData.title}*\n\n> *_Downloaded by X-Bot_*`
                    }, { quoted: message });
                } else {
                    await sock.sendMessage(chatId, {
                        video: { url: outputPath },
                        mimetype: 'video/mp4',
                        caption: `🎬 *${downloadData.title}*\n\n> *_Downloaded by X-Bot_*`
                    }, { quoted: message });
                }

                await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

            } catch (err) {
                console.error('[Video Send Error]:', err);
            } finally {
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            }
        });

        videoStream.on('error', async (err) => {
            console.error('[ytdl Error]:', err);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            await sock.sendMessage(chatId, { text: '❌ වීඩියෝව Download කිරීමට නොහැකි විය.' }, { quoted: message });
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
