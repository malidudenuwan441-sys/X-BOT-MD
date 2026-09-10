const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const net = require('net');
const { getYtDlpPath, recoverYoutubeUrl } = require('../lib/ytdlp_helper');

// Ensure temp directory exists in workspace
const workspaceTemp = path.join(process.cwd(), 'temp');
if (!fs.existsSync(workspaceTemp)) {
    try { fs.mkdirSync(workspaceTemp, { recursive: true }); } catch (e) {}
}

// Helper to check if cookies.txt is valid Netscape format
function isValidCookieFile(filePath) {
    if (!fs.existsSync(filePath)) return false;
    try {
        const stats = fs.statSync(filePath);
        if (stats.size < 50) return false;
        const content = fs.readFileSync(filePath, 'utf8', { flag: 'r' });
        return content.includes('youtube.com') && content.includes('\t');
    } catch (e) {
        return false;
    }
}

let ipv6Available = null;
let lastIpv6Check = 0;

async function checkIPv6() {
    if (ipv6Available !== null && Date.now() - lastIpv6Check < 600000) {
        return ipv6Available;
    }
    return new Promise((resolve) => {
        const sock = net.createConnection({ host: '2001:4860:4860::8888', port: 53, timeout: 1500 });
        sock.on('connect', () => {
            sock.destroy();
            ipv6Available = true;
            lastIpv6Check = Date.now();
            resolve(true);
        });
        const onFail = () => {
            sock.destroy();
            ipv6Available = false;
            lastIpv6Check = Date.now();
            resolve(false);
        };
        sock.on('error', onFail);
        sock.on('timeout', onFail);
    });
}

// Download high quality audio using yt-dlp with cookies.txt
async function downloadAudioViaYtDlp(youtubeUrl) {
    const cookiesPath = path.resolve(__dirname, '../cookies.txt');
    const hasValidCookies = isValidCookieFile(cookiesPath);
    console.log(`[SONG] yt-dlp checking cookies at ${cookiesPath}: ${hasValidCookies ? 'VALID' : 'NOT FOUND/EMPTY'}`);

    const useIPv6 = await checkIPv6();
    console.log(`[SONG] yt-dlp network routing: ${useIPv6 ? 'IPv6 ENABLED (-6)' : 'IPv4 (standard)'}`);

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const outTemplate = path.join(workspaceTemp, `ytsong_${id}.%(ext)s`);
    const ytdlpBin = getYtDlpPath();
    const nodeBin = process.execPath || 'node';
    const cookieArg = hasValidCookies ? `--cookies "${cookiesPath}"` : '';

    const executeDownload = (cmd) => {
        return new Promise((resolve, reject) => {
            console.log(`[SONG] Executing: ${cmd}`);
            // Use 50MB maxBuffer and --no-progress to avoid buffer overflow kill
            exec(cmd, { timeout: 600000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) {
                    return reject(new Error(stderr || stdout || error.message));
                }
                try {
                    const files = fs.readdirSync(workspaceTemp).filter(f => f.startsWith(`ytsong_${id}`));
                    if (files.length === 0) {
                        return reject(new Error('Audio file was not created by yt-dlp'));
                    }
                    const localFilePath = path.join(workspaceTemp, files[0]);
                    const stats = fs.statSync(localFilePath);
                    resolve({
                        isLocal: true,
                        filePath: localFilePath,
                        sizeBytes: stats.size
                    });
                } catch (e) {
                    reject(e);
                }
            });
        });
    };

    const ipv6Flag = useIPv6 ? '-6' : '';
    const primaryCmd = `${ytdlpBin} ${ipv6Flag} ${cookieArg} --js-runtimes "node:${nodeBin}" --no-progress --no-playlist -x --audio-format mp3 --audio-quality 128K -o "${outTemplate}" "${youtubeUrl}"`;

    try {
        return await executeDownload(primaryCmd);
    } catch (primaryErr) {
        console.warn('[SONG] Primary yt-dlp attempt failed:', primaryErr.message);
        const fallbackCmd = `${ytdlpBin} ${cookieArg} --no-progress --no-playlist -x --audio-format mp3 --audio-quality 128K -o "${outTemplate}" "${youtubeUrl}"`;
        console.log('[SONG] Retrying yt-dlp with standard fallback configuration...');
        return await executeDownload(fallbackCmd);
    }
}

async function songCommand(sock, chatId, message, rawText) {
    try {
        const text = rawText ||
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            message.message?.imageMessage?.caption ||
            message.message?.videoMessage?.caption || '';
            
        const query = text.replace(/^\.\w+\s*/i, '').trim();
        if (!query) {
            await sock.sendMessage(chatId, { text: 'Usage: `.song <song name or YouTube link>`' }, { quoted: message });
            return;
        }

        // Recover YouTube metadata and restore genuine case-sensitive video ID if needed
        const ytInfo = await recoverYoutubeUrl(query);
        const videoUrl = ytInfo.url || query;
        const videoTitle = ytInfo.title || query;
        const videoThumbnail = ytInfo.thumbnail;

        // Inform user with thumbnail
        const captionTitle = videoTitle || query;
        if (videoThumbnail) {
            try {
                await sock.sendMessage(chatId, {
                    image: { url: videoThumbnail },
                    caption: `🎵 *${captionTitle}*\n⏳ Downloading audio via yt-dlp...`
                }, { quoted: message });
            } catch (e) {}
        }

        // Pure yt-dlp audio download
        console.log('[SONG] Attempting audio download strictly with yt-dlp for:', videoUrl);
        const ytdlpSong = await downloadAudioViaYtDlp(videoUrl);
        if (!ytdlpSong || !ytdlpSong.filePath) {
            throw new Error('yt-dlp could not produce an audio file.');
        }

        const filePath = ytdlpSong.filePath;
        try {
            const fileSizeMb = Math.round((ytdlpSong.sizeBytes || 0) / (1024 * 1024));
            const safeTitle = (videoTitle || query || 'song').replace(/[^\w\s-]/g, '').trim() || 'song';
            
            if (fileSizeMb > 50) {
                // Send as document for large DJ mixes/podcasts
                await sock.sendMessage(chatId, {
                    document: { url: filePath },
                    mimetype: 'audio/mpeg',
                    fileName: `${safeTitle}.mp3`,
                    caption: `🎵 *${videoTitle || 'Audio'}*\n📦 Size: *${fileSizeMb} MB*\n\n> *_Downloaded by X-Bot_*`
                }, { quoted: message, mediaUploadTimeoutMs: 1800000 });
            } else {
                await sock.sendMessage(chatId, {
                    audio: { url: filePath },
                    mimetype: 'audio/mpeg',
                    fileName: `${safeTitle}.mp3`,
                    contextInfo: {
                        externalAdReply: {
                            title: videoTitle || safeTitle,
                            body: 'X-Bot Music',
                            thumbnailUrl: videoThumbnail,
                            mediaType: 2,
                            mediaUrl: videoUrl,
                            sourceUrl: videoUrl
                        }
                    }
                }, { quoted: message, mediaUploadTimeoutMs: 1800000 });
            }
            console.log(`[SONG] Successfully sent audio (${fileSizeMb} MB) via yt-dlp!`);
        } finally {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        }

    } catch (err) {
        console.error('[SONG] Command Error:', err);
        
        let errorMessage = '❌ Failed to download song.';
        const msg = err?.message || '';
        if (msg.includes('Sign in to confirm you’re not a bot') || msg.includes('bot confirmation')) {
            errorMessage = '⚠️ YouTube requires authentication. Please export cookies.txt from your browser and paste it in the Bot Dashboard.';
        } else if (msg.includes('terminated') || msg.includes('Media upload failed')) {
            errorMessage = '❌ WhatsApp media upload server terminated the connection. File may be too large or network interrupted.';
        } else if (msg.includes('This video is unavailable')) {
            errorMessage = '❌ YouTube reported: This video is unavailable.';
        } else if (msg.includes('blocked') || msg.includes('451')) {
            errorMessage = '❌ Download blocked by YouTube. Content unavailable in region.';
        } else if (msg) {
            errorMessage = '❌ yt-dlp Error: ' + msg.slice(0, 160);
        }
        
        await sock.sendMessage(chatId, { 
            text: errorMessage 
        }, { quoted: message });
    }
}

module.exports = songCommand;
