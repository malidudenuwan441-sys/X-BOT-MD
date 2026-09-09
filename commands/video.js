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

// Download using yt-dlp with cookies.txt for long videos
async function downloadViaYtDlp(youtubeUrl) {
    const cookiesPath = path.resolve(__dirname, '../cookies.txt');
    const hasValidCookies = isValidCookieFile(cookiesPath);
    
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const outTemplate = `/tmp/ytdl_${id}.%(ext)s`;

    // Adaptive format selection: up to 720p or 480p with audio, keeping filesize manageable for WhatsApp
    const formatSpec = "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=480]+ba/b[height<=480]/bestvideo+bestaudio/best";
    const cookieArg = hasValidCookies ? `--cookies "${cookiesPath}"` : '';
    const cmd = `/usr/local/bin/yt-dlp ${cookieArg} --js-runtimes node:/usr/local/bin/node --remote-components ejs:github --no-playlist -f "${formatSpec}" --merge-output-format mp4 -o "${outTemplate}" "${youtubeUrl}"`;

    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 600000 }, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(stderr || error.message));
            }
            try {
                const files = fs.readdirSync('/tmp').filter(f => f.startsWith(`ytdl_${id}`));
                if (files.length === 0) {
                    return reject(new Error('Downloaded file was not created by yt-dlp'));
                }
                const localFilePath = path.join('/tmp', files[0]);
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
}

// Helper to download remote stream to local file to verify size and stream cleanly to Baileys
async function downloadRemoteUrlToDisk(url, destPath, maxBytes = 400 * 1024 * 1024) {
    const writer = fs.createWriteStream(destPath);
    const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        timeout: 300000,
        headers: AXIOS_DEFAULTS.headers,
        maxRedirects: 5
    });
    return new Promise((resolve, reject) => {
        let downloaded = 0;
        response.data.on('data', chunk => {
            downloaded += chunk.length;
            if (downloaded > maxBytes) {
                response.data.destroy();
                writer.destroy();
                reject(new Error('File exceeds maximum allowable size (400MB)'));
            }
        });
        response.data.pipe(writer);
        writer.on('finish', () => resolve({ filePath: destPath, sizeBytes: downloaded }));
        writer.on('error', reject);
        response.data.on('error', reject);
    });
}

async function tryRequest(getter, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await getter();
        } catch (err) {
            lastError = err;
            if (attempt < attempts) {
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
    }
    throw lastError;
}

// EliteProTech API - Primary
async function getEliteProTechVideoByUrl(youtubeUrl) {
    const apiUrl = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(youtubeUrl)}&format=mp4`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.downloadURL) {
        return {
            download: res.data.downloadURL,
            title: res.data.title
        };
    }
    throw new Error('EliteProTech ytdown returned no download');
}

async function getYupraVideoByUrl(youtubeUrl) {
    const apiUrl = `https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.data?.download_url) {
        return {
            download: res.data.data.download_url,
            title: res.data.data.title,
            thumbnail: res.data.data.thumbnail
        };
    }
    throw new Error('Yupra returned no download');
}

async function getOkatsuVideoByUrl(youtubeUrl) {
    const apiUrl = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    // shape: { status, creator, url, result: { status, title, mp4 } }
    if (res?.data?.result?.mp4) {
        return { download: res.data.result.mp4, title: res.data.result.title };
    }
    throw new Error('Okatsu ytmp4 returned no mp4');
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
                    caption: `*${captionTitle}*\nDownloading...`
                }, { quoted: message });
            }
        } catch (e) { console.error('[VIDEO] thumb error:', e?.message || e); }
        

        // Validate YouTube URL
        let urls = videoUrl.match(/(?:https?:\/\/)?(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|v\/|embed\/|shorts\/|playlist\?list=)?)([a-zA-Z0-9_-]{11})/gi);
        if (!urls) {
            await sock.sendMessage(chatId, { text: 'This is not a valid YouTube link!' }, { quoted: message });
            return;
        }

        const cookiesPath = path.resolve(__dirname, '../cookies.txt');
        const hasCookies = isValidCookieFile(cookiesPath);
        const safeTitle = (videoTitle || searchQuery || 'video').replace(/[^\w\s-]/g, '').trim() || 'video';

        // 1. Try yt-dlp first (always attempt yt-dlp with or without cookies as it supports long videos)
        let localDownloadResult = null;
        try {
            console.log('[VIDEO] Attempting download with yt-dlp...');
            localDownloadResult = await downloadViaYtDlp(videoUrl);
        } catch (ytdlpErr) {
            console.warn('[VIDEO] yt-dlp failed, falling back to web APIs:', ytdlpErr.message);
            localDownloadResult = null;
        }

        if (localDownloadResult && localDownloadResult.filePath) {
            const filePath = localDownloadResult.filePath;
            try {
                const fileSizeMb = Math.round((localDownloadResult.sizeBytes || 0) / (1024 * 1024));
                const captionText = `🎬 *${videoTitle || 'YouTube Video'}*\n` +
                    `📦 Size: *${fileSizeMb} MB*\n` +
                    `\n> *_Downloaded by X-Bot_*`;

                // Stream directly from disk via { url: filePath } without loading into Node RAM!
                if (fileSizeMb > 60) {
                    console.log(`[VIDEO] Video is ${fileSizeMb} MB (>60MB). Sending as WhatsApp Document...`);
                    await sock.sendMessage(chatId, {
                        document: { url: filePath },
                        mimetype: 'video/mp4',
                        fileName: `${safeTitle}.mp4`,
                        caption: captionText
                    }, { quoted: message });
                } else {
                    try {
                        await sock.sendMessage(chatId, {
                            video: { url: filePath },
                            mimetype: 'video/mp4',
                            fileName: `${safeTitle}.mp4`,
                            caption: captionText
                        }, { quoted: message });
                    } catch (sendErr) {
                        console.log('[VIDEO] Direct video send failed, falling back to document:', sendErr.message);
                        await sock.sendMessage(chatId, {
                            document: { url: filePath },
                            mimetype: 'video/mp4',
                            fileName: `${safeTitle}.mp4`,
                            caption: captionText
                        }, { quoted: message });
                    }
                }
                console.log(`[VIDEO] Successfully sent video (${fileSizeMb} MB) via yt-dlp!`);
                return; // Successfully completed!
            } finally {
                try {
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                } catch (cleanErr) {}
            }
        }

        // 2. Fallback to web APIs if yt-dlp was unable to process
        let videoData;
        let downloadSuccess = false;
        
        // List of API methods to try
        const apiMethods = [
            { name: 'EliteProTech', method: () => getEliteProTechVideoByUrl(videoUrl) },
            { name: 'Yupra', method: () => getYupraVideoByUrl(videoUrl) },
            { name: 'Okatsu', method: () => getOkatsuVideoByUrl(videoUrl) }
        ];
        
        // Try each API until we successfully get video data
        for (const apiMethod of apiMethods) {
            try {
                videoData = await apiMethod.method();
                const videoUrl_check = videoData.download || videoData.dl || videoData.url;
                
                if (!videoUrl_check) {
                    console.log(`${apiMethod.name} returned no download URL, trying next API...`);
                    continue; // Try next API
                }
                
                downloadSuccess = true;
                break; // Success! Exit the loop
            } catch (apiErr) {
                console.log(`${apiMethod.name} API failed:`, apiErr.message);
                continue;
            }
        }
        
        // If all APIs failed, throw error
        if (!downloadSuccess || !videoData) {
            throw new Error('All download sources failed. The content may be unavailable or blocked.');
        }

        const rawDownloadUrl = videoData.download || videoData.dl || videoData.url;
        const fallbackTitle = (videoData.title || videoTitle || safeTitle || 'video').replace(/[^\w\s-]/g, '').trim() || 'video';
        const tempFallbackPath = path.join('/tmp', `webdl_${Date.now()}.mp4`);

        try {
            console.log('[VIDEO] Downloading stream from web API to disk...');
            const dlResult = await downloadRemoteUrlToDisk(rawDownloadUrl, tempFallbackPath);
            const fileSizeMb = Math.round((dlResult.sizeBytes || 0) / (1024 * 1024));

            const captionText = `🎬 *${videoData.title || videoTitle || 'Video'}*\n` +
                (fileSizeMb > 0 ? `📦 Size: *${fileSizeMb} MB*\n` : '') +
                `\n> *_Downloaded by X-Bot_*`;

            // Stream directly from disk to WhatsApp
            if (fileSizeMb > 60) {
                await sock.sendMessage(chatId, {
                    document: { url: tempFallbackPath },
                    mimetype: 'video/mp4',
                    fileName: `${fallbackTitle}.mp4`,
                    caption: captionText
                }, { quoted: message });
            } else {
                try {
                    await sock.sendMessage(chatId, {
                        video: { url: tempFallbackPath },
                        mimetype: 'video/mp4',
                        fileName: `${fallbackTitle}.mp4`,
                        caption: captionText
                    }, { quoted: message });
                } catch (sendVideoErr) {
                    console.log('[VIDEO] Direct video send failed, falling back to document:', sendVideoErr.message);
                    await sock.sendMessage(chatId, {
                        document: { url: tempFallbackPath },
                        mimetype: 'video/mp4',
                        fileName: `${fallbackTitle}.mp4`,
                        caption: captionText
                    }, { quoted: message });
                }
            }
        } finally {
            try {
                if (fs.existsSync(tempFallbackPath)) fs.unlinkSync(tempFallbackPath);
            } catch (cleanErr) {}
        }


    } catch (error) {
        console.error('[VIDEO] Command Error:', error?.message || error);
        
        // Provide more specific error messages
        let errorMessage = '❌ Failed to download video.';
        if (error.message && error.message.includes('blocked')) {
            errorMessage = '❌ Download blocked. The content may be unavailable in your region or due to legal restrictions.';
        } else if (error.response?.status === 451 || error.status === 451) {
            errorMessage = '❌ Content unavailable (451). This may be due to legal restrictions or regional blocking.';
        } else if (error.message && error.message.includes('All download sources failed')) {
            errorMessage = '❌ All download sources failed. The content may be unavailable or blocked.';
        } else if (error.message) {
            errorMessage = '❌ Download failed: ' + error.message;
        }
        
        await sock.sendMessage(chatId, { 
            text: errorMessage 
        }, { quoted: message });
    }
}

module.exports = videoCommand; 