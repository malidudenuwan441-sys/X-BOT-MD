const yts = require('yt-search');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Memory එකේ active වීඩියෝ ඩවුන්ලෝඩ් Request තබා ගැනීම
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
                         `1️⃣ *480p (Normal)*\n` +
                         `2️⃣ *720p (HD)*\n` +
                         `3️⃣ *1080p (FHD)*`;

        let sentMsg;
        if (videoThumbnail) {
            sentMsg = await sock.sendMessage(chatId, { image: { url: videoThumbnail }, caption: menuText }, { quoted: message });
        } else {
            sentMsg = await sock.sendMessage(chatId, { text: menuText }, { quoted: message });
        }

        // Reply එකක් එනතෙක් Data Map එකේ තබා ගැනීම
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

// Menu එකට එන Reply (1, 2, 3) Process කරන Function එක
async function handleYtVideoReply(sock, chatId, message) {
    try {
        const text = (message.message?.conversation || message.message?.extendedTextMessage?.text || '').trim();
        const quotedMsgId = message.message?.extendedTextMessage?.contextInfo?.stanzaId;

        if (!quotedMsgId || !pendingYtDownloads.has(quotedMsgId)) return false;

        let targetHeight = 480;
        if (text === '1') targetHeight = 480;
        else if (text === '2') targetHeight = 720;
        else if (text === '3') targetHeight = 1080;
        else return false;

        const downloadData = pendingYtDownloads.get(quotedMsgId);
        pendingYtDownloads.delete(quotedMsgId); // Reuse වැලැක්වීමට Delete කිරීම

        await sock.sendMessage(chatId, { react: { text: '⬇️', key: message.key } });
        await sock.sendMessage(chatId, { text: `📥 *Downloading ${targetHeight}p Video...*` }, { quoted: message });

        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const outputPath = path.join(tempDir, `yt_${Date.now()}.mp4`);

        // Deno JS Engine එක සහ Full Cookies Path එක සමඟ yt-dlp Command එක
        const ytDlpCmd = `yt-dlp --js-runtimes deno --cookies /home/opc/X-BOT-MD/cookies.txt --extractor-args "youtube:player_client=android,web" -f "bv*[height<=${targetHeight}][ext=mp4]+ba[ext=m4a]/b[height<=${targetHeight}]" --merge-output-format mp4 -o "${outputPath}" "${downloadData.url}"`;

        exec(ytDlpCmd, { timeout: 300000 }, async (error, stdout, stderr) => {
            if (error) {
                console.error('[yt-dlp error]:', error.message);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
                return await sock.sendMessage(chatId, { text: '❌ yt-dlp හරහා වීඩියෝව Download කිරීමට නොහැකි විය.' }, { quoted: message });
            }

            try {
                const stats = fs.statSync(outputPath);
                const sizeInMB = stats.size / (1024 * 1024);

                if (sizeInMB > 200) {
                    fs.unlinkSync(outputPath);
                    await sock.sendMessage(chatId, { react: { text: '⚠️', key: message.key } });
                    return await sock.sendMessage(chatId, { text: `⚠️ File size එක MB 200 ට වඩා වැඩිය (${sizeInMB.toFixed(1)} MB). WhatsApp හරහා යැවිය නොහැක.` }, { quoted: message });
                }

                await sock.sendMessage(chatId, { react: { text: '📤', key: message.key } });

                if (sizeInMB > 64) {
                    // 64MB ට වැඩි නම් Document එකක් ලෙස යැවීම
                    await sock.sendMessage(chatId, {
                        document: { url: outputPath },
                        mimetype: 'video/mp4',
                        fileName: `${downloadData.title.replace(/[^\w\s-]/g, '')}_${targetHeight}p.mp4`,
                        caption: `🎬 *${downloadData.title}*\n✨ *Quality:* ${targetHeight}p\n\n> *_Downloaded by X-Bot_*`
                    }, { quoted: message });
                } else {
                    // 64MB ට අඩු නම් Direct Video එකක් ලෙස යැවීම
                    await sock.sendMessage(chatId, {
                        video: { url: outputPath },
                        mimetype: 'video/mp4',
                        caption: `🎬 *${downloadData.title}*\n✨ *Quality:* ${targetHeight}p\n\n> *_Downloaded by X-Bot_*`
                    }, { quoted: message });
                }

                await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

            } catch (err) {
                console.error('[Video Send Error]:', err);
            } finally {
                // File එක යවා අවසන් වූ පසු Temp file එක Delete කිරීම
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                }
            }
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
    handleVideoReply: handleYtVideoReply // main.js එකේ Import නම ගැලපීමට
};
