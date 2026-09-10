const axios = require('axios');
const yts = require('yt-search');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const AXIOS_DEFAULTS = {
    timeout: 60000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
    }
};

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

const net = require('net');

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

// Download using yt-dlp with cookies.txt for long videos
async function downloadViaYtDlp(youtubeUrl) {
    const cookiesPath = path.resolve(__dirname, '../cookies.txt');
    const hasValidCookies = isValidCookieFile(cookiesPath);
    console.log(`[VIDEO] yt-dlp checking cookies at ${cookiesPath}: ${hasValidCookies ? 'VALID' : 'NOT FOUND/EMPTY'}`);

    const useIPv6 = await checkIPv6();
    console.log(`[VIDEO] yt-dlp network routing: ${useIPv6 ? 'IPv6 ENABLED (-6)' : 'IPv4 (standard)'}`);
    
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const outTemplate = path.join(workspaceTemp, `ytdl_${id}.%(ext)s`);
    const ytdlpBin = fs.existsSync('/usr/local/bin/yt-dlp') ? '/usr/local/bin/yt-dlp' : 'yt-dlp';
    const nodeBin = process.execPath || 'node';

    // Adaptive format selection: prefer 480p/360p for long videos/movies to keep file size reasonable for WhatsApp
    const formatSpec = "bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=480][ext=mp4]/bv*[height<=720]+ba/b[height<=720]/bestvideo+bestaudio/best";
    const cookieArg = hasValidCookies ? `--cookies "${cookiesPath}"` : '';

    const executeDownload = (cmd) => {
        return new Promise((resolve, reject) => {
            console.log(`[VIDEO] Executing: ${cmd}`);
            exec(cmd, { timeout: 900000 }, (error, stdout, stderr) => {
                if (error) {
                    return reject(new Error(stderr || stdout || error.message));
                }
                try {
                    const files = fs.readdirSync(workspaceTemp).filter(f => f.startsWith(`ytdl_${id}`));
                    if (files.length === 0) {
                        return reject(new Error('Downloaded file was not created by yt-dlp'));
                    }
                    const localFilePath = path.join(workspaceTemp, files[0]);
                    const stats = fs.statSync(localFilePath);
                    resolve({
                        isLocal: true,
                        filePath: localFilePath,
                        sizeBytes: stats.size,
                        title: 'YouTube Video'
                    });
                } catch (e) {
                    reject(e);
                }
            });
        });
    };

    // Primary command: with IPv6 and runtime options
    const ipv6Flag = useIPv6 ? '-6' : '';
    const primaryCmd = `${ytdlpBin} ${ipv6Flag} ${cookieArg} --js-runtimes "node:${nodeBin}" --no-playlist -f "${formatSpec}" --merge-output-format mp4 -o "${outTemplate}" "${youtubeUrl}"`;

    try {
        return await executeDownload(primaryCmd);
    } catch (primaryErr) {
        console.warn('[VIDEO] Primary yt-dlp attempt failed:', primaryErr.message);
        
        // Fallback command: standard IPv4 without extra flags
        const fallbackCmd = `${ytdlpBin} ${cookieArg} --no-playlist -f "${formatSpec}" --merge-output-format mp4 -o "${outTemplate}" "${youtubeUrl}"`;
        console.log('[VIDEO] Retrying yt-dlp with standard fallback configuration...');
        return await executeDownload(fallbackCmd);
    }
}

async function videoCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        const searchQuery = text.split(' ').slice(1).join(' ').trim();
        
        if (!searchQuery) {
            await sock.sendMessage(chatId, { text: 'What video do you want to download?' }, { quoted: message });
            return;
        }

        // Determine if input is a YouTube link
        let videoUrl = '';
        let videoTitle = '';
        let videoThumbnail = '';
        if (searchQuery.startsWith('http://') || searchQuery.startsWith('https://')) {
            videoUrl = searchQuery;
        } else {
            // Search YouTube for the video
            const { videos } = await yts(searchQuery);
            if (!videos || videos.length === 0) {
                await sock.sendMessage(chatId, { text: 'No videos found!' }, { quoted: message });
                return;
            }
            videoUrl = videos[0].url;
            videoTitle = videos[0].title;
            videoThumbnail = videos[0].thumbnail;
        }

        // Send thumbnail immediately
        try {
            const ytId = (videoUrl.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) || [])[1];
            const thumb = videoThumbnail || (ytId ? `https://i.ytimg.com/vi/${ytId}/sddefault.jpg` : undefined);
            const captionTitle = videoTitle || searchQuery;
            if (thumb) {
                await sock.sendMessage(chatId, {
                    image: { url: thumb },
                    caption: `*${captionTitle}*\nDownloading via yt-dlp...`
                }, { quoted: message });
            }
        } catch (e) { console.error('[VIDEO] thumb error:', e?.message || e); }

        // Validate YouTube URL
        let urls = videoUrl.match(/(?:https?:\/\/)?(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|v\/|embed\/|shorts\/|playlist\?list=)?)([a-zA-Z0-9_-]{11})/gi);
        if (!urls) {
            await sock.sendMessage(chatId, { text: 'This is not a valid YouTube link!' }, { quoted: message });
            return;
        }

        const safeTitle = (videoTitle || searchQuery || 'video').replace(/[^\w\s-]/g, '').trim() || 'video';

        // Pure yt-dlp execution
        console.log('[VIDEO] Attempting download strictly with yt-dlp...');
        const localDownloadResult = await downloadViaYtDlp(videoUrl);

        if (!localDownloadResult || !localDownloadResult.filePath) {
            throw new Error('yt-dlp could not produce a downloadable file.');
        }

        const filePath = localDownloadResult.filePath;
        try {
            const fileSizeMb = Math.round((localDownloadResult.sizeBytes || 0) / (1024 * 1024));
            const captionText = `🎬 *${videoTitle || 'YouTube Video'}*\n` +
                `📦 Size: *${fileSizeMb} MB*\n` +
                `\n> *_Downloaded by X-Bot_*`;

            // Stream directly from disk via { url: filePath }
            // Videos > 40MB must be sent as document to prevent WhatsApp server payload rejection
            if (fileSizeMb > 40) {
                console.log(`[VIDEO] Video is ${fileSizeMb} MB (>40MB). Sending as WhatsApp Document...`);
                await sock.sendMessage(chatId, {
                    document: { url: filePath },
                    mimetype: 'video/mp4',
                    fileName: `${safeTitle}.mp4`,
                    caption: captionText
                }, { quoted: message, mediaUploadTimeoutMs: 1800000 });
            } else {
                try {
                    await sock.sendMessage(chatId, {
                        video: { url: filePath },
                        mimetype: 'video/mp4',
                        fileName: `${safeTitle}.mp4`,
                        caption: captionText
                    }, { quoted: message, mediaUploadTimeoutMs: 1800000 });
                } catch (sendErr) {
                    console.log('[VIDEO] Direct video send failed, sending as document:', sendErr.message);
                    await sock.sendMessage(chatId, {
                        document: { url: filePath },
                        mimetype: 'video/mp4',
                        fileName: `${safeTitle}.mp4`,
                        caption: captionText
                    }, { quoted: message, mediaUploadTimeoutMs: 1800000 });
                }
            }
            console.log(`[VIDEO] Successfully sent video (${fileSizeMb} MB) via yt-dlp!`);
        } finally {
            try {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            } catch (cleanErr) {}
        }

    } catch (error) {
        console.error('[VIDEO] Command Error:', error?.message || error);
        
        let errorMessage = '❌ Failed to download video.';
        const msg = error.message || '';
        if (msg.includes('Sign in to confirm you’re not a bot') || msg.includes('bot confirmation')) {
            errorMessage = '⚠️ YouTube requires authentication. Please upload cookies.txt via the Bot Dashboard or export cookies from a dummy account.';
        } else if (msg.includes('blocked') || msg.includes('451')) {
            errorMessage = '❌ Download blocked by YouTube. Content unavailable in region.';
        } else if (msg.includes('Media upload failed')) {
            errorMessage = '❌ WhatsApp media upload server failed to receive the file. Please retry.';
        } else if (msg) {
            // Include first 150 chars of yt-dlp message for clarity
            errorMessage = '❌ yt-dlp Error: ' + msg.slice(0, 150);
        }
        
        await sock.sendMessage(chatId, { 
            text: errorMessage 
        }, { quoted: message });
    }
}

module.exports = videoCommand; 