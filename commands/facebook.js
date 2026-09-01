const axios = require('axios');

// Store active pending downloads in memory
const pendingFbDownloads = new Map();

async function facebookCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation || 
                     message.message?.extendedTextMessage?.text || '';
        
        const args = text.split(' ').slice(1);
        const url = args[0];

        if (!url || (!url.includes('facebook.com') && !url.includes('fb.watch') && !url.includes('fb.gg'))) {
            return await sock.sendMessage(chatId, { 
                text: '❌ කරුණාකර නිවැරදි Facebook වීඩියෝ ලින්ක් එකක් ලබාදෙන්න!\n\n*Example:* `.fb https://www.facebook.com/share/r/...` ' 
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        const options = {
            method: 'POST',
            url: 'https://free-facebook-downloader.p.rapidapi.com/external-api/facebook-video-downloader',
            params: { url: url },
            headers: {
                'x-rapidapi-key': 'ef27e1399emshde8f76820e0e93dp17eb23jsn318851b7aee0',
                'x-rapidapi-host': 'free-facebook-downloader.p.rapidapi.com'
            }
        };

        const response = await axios.request(options);
        const resData = response.data;

        const hdUrl = resData?.links?.['Download High Quality'];
        const sdUrl = resData?.links?.['Download Low Quality'];

        if (!hdUrl && !sdUrl) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, { text: '❌ වීඩියෝ එක සොයාගැනීමට නොහැකි විය. Private හෝ වලංගු නොවන ලින්ක් එකක් විය හැක.' }, { quoted: message });
        }

        const menuText = `🎬 *FACEBOOK VIDEO DOWNLOADER*\n\n` +
                         `📌 *Title:* ${resData.title || 'Facebook Video'}\n\n` +
                         `Reply to this message with option number:\n` +
                         `1️⃣ *SD Quality (Low Quality)*\n` +
                         `2️⃣ *HD Quality (High Quality)*`;

        const sentMsg = await sock.sendMessage(chatId, { text: menuText }, { quoted: message });

        // Save data associated with the message key ID
        pendingFbDownloads.set(sentMsg.key.id, {
            sd: sdUrl,
            hd: hdUrl,
            title: resData.title || 'Facebook Video',
            timestamp: Date.now()
        });

        await sock.sendMessage(chatId, { react: { text: '📲', key: message.key } });

    } catch (error) {
        console.error('Facebook RapidAPI Error:', error?.response?.data || error.message);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, { text: '❌ RapidAPI එකෙන් වීඩියෝ එක ලබාගැනීමේදී දෝෂයක් සිදු විය.' }, { quoted: message });
    }
}

// Function to handle quoted menu replies (1 or 2)
async function handleFbReply(sock, chatId, message) {
    try {
        const text = (message.message?.conversation || message.message?.extendedTextMessage?.text || '').trim();
        const quotedMsgId = message.message?.extendedTextMessage?.contextInfo?.stanzaId;

        if (!quotedMsgId || !pendingFbDownloads.has(quotedMsgId)) return false;

        const downloadData = pendingFbDownloads.get(quotedMsgId);

        let videoUrl = null;
        let qualityName = '';

        if (text === '1') {
            videoUrl = downloadData.sd || downloadData.hd;
            qualityName = 'SD Quality';
        } else if (text === '2') {
            videoUrl = downloadData.hd || downloadData.sd;
            qualityName = 'HD Quality';
        } else {
            return false;
        }

        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

        // Check Video File Size Before Uploading
        const headRes = await axios.head(videoUrl);
        const contentLength = headRes.headers['content-length'];
        
        if (contentLength) {
            const sizeInMB = (parseInt(contentLength) / (1024 * 1024)).toFixed(2);
            if (parseFloat(sizeInMB) > 200) {
                await sock.sendMessage(chatId, { react: { text: '⚠️', key: message.key } });
                pendingFbDownloads.delete(quotedMsgId);
                return await sock.sendMessage(chatId, { 
                    text: `⚠️ *FILE SIZE LIMIT EXCEEDED!*\n\n` +
                          `📦 *File Size:* \`${sizeInMB} MB\`\n` +
                          `⛔ *Limit:* \`200 MB\`\n\n` +
                          `මෙම වීඩියෝවේ ප්‍රමාණය MB 200 ට වඩා වැඩි බැවින් WhatsApp හරහා යැවිය නොහැක.` 
                }, { quoted: message });
            }
        }

        await sock.sendMessage(chatId, {
            video: { url: videoUrl },
            caption: `🎬 *${downloadData.title}*\n✨ *Quality:* ${qualityName}`
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        return true;

    } catch (error) {
        console.error('FB Reply Error:', error.message);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, { text: '❌ වීඩියෝ එක ඩවුන්ලෝඩ් කර යැවීමට නොහැකි විය.' }, { quoted: message });
        return true;
    }
}

module.exports = { facebookCommand, handleFbReply };