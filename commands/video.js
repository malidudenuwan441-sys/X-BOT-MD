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

// Download using yt-dlp with cookies.txt for long videos
async function downloadViaYtDlp(youtubeUrl) {
    const cookiesPath = path.resolve(__dirname, '../cookies.txt');
    if (!fs.existsSync(cookiesPath)) {
        throw new Error('No cookies.txt found');
    }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const outTemplate = `/tmp/ytdl_${id}.%(ext)s`;

    // Download best video up to 720p or standard mp4 with audio
    const cmd = `/usr/local/bin/yt-dlp --cookies "${cookiesPath}" --js-runtimes node:/usr/local/bin/node --remote-components ejs:github --no-playlist -f "b[ext=mp4][filesize<400M]/best[filesize<400M]/w" --merge-output-format mp4 -o "${outTemplate}" "${youtubeUrl}"`;

    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 300000 }, (error, stdout, stderr) => {
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
        const hasCookies = fs.existsSync(cookiesPath);
        const safeTitle = (videoTitle || searchQuery || 'video').replace(/[^\w\s-]/g, '').trim() || 'video';

        // 1. Try yt-dlp first if cookies.txt is provided (supports long videos, 1080p/720p, no duration limits!)
        if (hasCookies) {
            let localDownloadResult = null;
            try {
                console.log('[VIDEO] cookies.txt detected. Attempting high-quality download with yt-dlp...');
                localDownloadResult = await downloadViaYtDlp(videoUrl);
            } catch (ytdlpErr) {
                console.warn('[VIDEO] yt-dlp with cookies failed, falling back to web APIs:', ytdlpErr.message);
                localDownloadResult = null;
            }

            if (localDownloadResult && localDownloadResult.filePath) {
                const filePath = localDownloadResult.filePath;
                try {
                    const fileSizeMb = Math.round((localDownloadResult.sizeBytes || 0) / (1024 * 1024));
                    const captionText = `🎬 *${videoTitle || 'YouTube Video'}*\n` +
                        `📦 Size: *${fileSizeMb} MB* (High Quality via yt-dlp)\n` +
                        `\n> *_Downloaded by X-Bot_*`;

                    const fileBuffer = fs.readFileSync(filePath);

                    if (fileSizeMb > 60) {
                        await sock.sendMessage(chatId, {
                            document: fileBuffer,
                            mimetype: 'video/mp4',
                            fileName: `${safeTitle}.mp4`,
                            caption: captionText
                        }, { quoted: message });
                    } else {
                        try {
                            await sock.sendMessage(chatId, {
                                video: fileBuffer,
                                mimetype: 'video/mp4',
                                fileName: `${safeTitle}.mp4`,
                                caption: captionText
                            }, { quoted: message });
                        } catch (sendErr) {
                            await sock.sendMessage(chatId, {
                                document: fileBuffer,
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
        }

        // 2. Fallback to web APIs if cookies not present or failed
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
                // API call failed, try next API
                console.log(`${apiMethod.name} API failed:`, apiErr.message);
                continue;
            }
        }
        
        // If all APIs failed, throw error
        if (!downloadSuccess || !videoData) {
            throw new Error('All download sources failed. The content may be unavailable or blocked in your region.');
        }

        const rawDownloadUrl = videoData.download || videoData.dl || videoData.url;
        const fallbackTitle = (videoData.title || videoTitle || safeTitle || 'video').replace(/[^\w\s-]/g, '').trim() || 'video';

        // Check file size to decide whether to send as inline Video or Document (WhatsApp allows up to 2GB as Document, but only ~60MB as direct Video)
        let fileSizeMb = 0;
        try {
            const headRes = await axios.head(rawDownloadUrl, { timeout: 10000, maxRedirects: 5 });
            const contentLength = parseInt(headRes.headers['content-length'] || '0', 10);
            if (contentLength > 0) {
                fileSizeMb = Math.round(contentLength / (1024 * 1024));
            }
        } catch (e) {
            // Ignore head check error
        }

        const captionText = `🎬 *${videoData.title || videoTitle || 'Video'}*\n` +
            (fileSizeMb > 0 ? `📦 Size: *${fileSizeMb} MB*\n` : '') +
            `\n> *_Downloaded by X-Bot_*`;

        // If video size exceeds 60MB, send as document to prevent WhatsApp media upload failure
        if (fileSizeMb > 60) {
            await sock.sendMessage(chatId, {
                document: { url: rawDownloadUrl },
                mimetype: 'video/mp4',
                fileName: `${fallbackTitle}.mp4`,
                caption: captionText
            }, { quoted: message });
        } else {
            try {
                await sock.sendMessage(chatId, {
                    video: { url: rawDownloadUrl },
                    mimetype: 'video/mp4',
                    fileName: `${fallbackTitle}.mp4`,
                    caption: captionText
                }, { quoted: message });
            } catch (sendVideoErr) {
                // If direct video fails due to size or format, fallback immediately to document
                console.log('[VIDEO] Direct video send failed, falling back to document:', sendVideoErr.message);
                await sock.sendMessage(chatId, {
                    document: { url: rawDownloadUrl },
                    mimetype: 'video/mp4',
                    fileName: `${fallbackTitle}.mp4`,
                    caption: captionText
                }, { quoted: message });
            }
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