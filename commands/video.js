const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const net = require('net');
const { getYtDlpPath, recoverYoutubeUrl } = require('../lib/ytdlp_helper');

// Ensure workspace temp directory exists
const workspaceTemp = path.join(process.cwd(), 'temp');
if (!fs.existsSync(workspaceTemp)) {
    try { fs.mkdirSync(workspaceTemp, { recursive: true }); } catch (e) {}
}

// Netscape cookies validation
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

// IPv6 connectivity check
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

// Extract video metadata using ffprobe
function getVideoMeta(filePath) {
    try {
        const out = execSync(
            `ffprobe -v error -show_entries format=duration,size -show_streams -select_streams v:0 -show_entries stream=codec_name,pix_fmt,width,height -of json "${filePath}"`,
            { timeout: 10000 }
        );
        const data = JSON.parse(out.toString());
        const duration = parseFloat(data.format?.duration || 0);
        const size = parseInt(data.format?.size || fs.statSync(filePath).size, 10);
        const vStream = data.streams?.[0] || {};
        return {
            duration,
            sizeBytes: size,
            sizeMb: size / (1024 * 1024),
            codec: vStream.codec_name || '',
            pixFmt: vStream.pix_fmt || '',
            width: vStream.width || 0,
            height: vStream.height || 0
        };
    } catch (e) {
        let size = 0;
        try { size = fs.statSync(filePath).size; } catch (_) {}
        return {
            duration: 0,
            sizeBytes: size,
            sizeMb: size / (1024 * 1024),
            codec: '',
            pixFmt: '',
            width: 0,
            height: 0
        };
    }
}

/**
 * Normalizes and compresses video specifically for WhatsApp compatibility.
 * Requirements for WhatsApp Web MMS:
 *  - Format: MP4 (H.264 / AVC + AAC)
 *  - Pixel format: yuv420p (Crucial: other formats trigger 400 Bad Request)
 *  - MP4 Flags: +faststart (Crucial: moves moov atom to start of file)
 *  - Max Document Size: 42 MB (to safely stay below WhatsApp CDN rejection limits)
 */
async function prepareWhatsAppVideo(inputPath, targetMaxMb = 42) {
    const meta = getVideoMeta(inputPath);
    console.log(`[VIDEO] Input probe: ${Math.round(meta.sizeMb)} MB, duration: ${Math.round(meta.duration)}s, codec: ${meta.codec}, pix_fmt: ${meta.pixFmt}`);

    // If already optimal H.264/AAC with yuv420p and under target size, just ensure faststart
    if (meta.sizeMb <= targetMaxMb && meta.codec === 'h264' && meta.pixFmt === 'yuv420p') {
        const faststartPath = inputPath.replace(/\.mp4$/, '_fs.mp4');
        return new Promise((resolve) => {
            exec(`ffmpeg -y -i "${inputPath}" -c copy -movflags +faststart "${faststartPath}"`, { timeout: 60000 }, (err) => {
                if (err || !fs.existsSync(faststartPath)) {
                    resolve(inputPath);
                } else {
                    try { fs.unlinkSync(inputPath); } catch (_) {}
                    resolve(faststartPath);
                }
            });
        });
    }

    // Full transcode required to guarantee WhatsApp acceptance
    const outputPath = inputPath.replace(/\.mp4$/, '_wa.mp4');
    console.log(`[VIDEO] Transcoding video to WhatsApp-compliant H.264/AAC with faststart...`);

    let ffmpegCmd;
    if (meta.duration > 0) {
        // Compute optimal video bitrate to strictly stay under targetMaxMb
        const targetBits = targetMaxMb * 8 * 1024 * 1024 * 0.92; // 8% headroom
        const audioBitrateBps = 96000;
        const totalAudioBits = audioBitrateBps * meta.duration;
        const availableVideoBits = targetBits - totalAudioBits;
        const rawVideoBitrateBps = Math.max(180000, Math.floor(availableVideoBits / meta.duration));
        const videoBitrateKbps = Math.min(850, Math.floor(rawVideoBitrateBps / 1000));
        const maxRateKbps = Math.floor(videoBitrateKbps * 1.25);
        const bufSizeKbps = videoBitrateKbps * 2;

        ffmpegCmd = `ffmpeg -y -i "${inputPath}" -vf "scale='min(640,iw)':-2" -c:v libx264 -b:v ${videoBitrateKbps}k -maxrate ${maxRateKbps}k -bufsize ${bufSizeKbps}k -pix_fmt yuv420p -profile:v baseline -level 3.0 -preset fast -c:a aac -b:a 96k -ar 44100 -movflags +faststart "${outputPath}"`;
    } else {
        // Fallback when duration is not determined
        ffmpegCmd = `ffmpeg -y -i "${inputPath}" -vf "scale='min(640,iw)':-2" -c:v libx264 -crf 28 -pix_fmt yuv420p -profile:v baseline -level 3.0 -preset fast -c:a aac -b:a 96k -ar 44100 -movflags +faststart "${outputPath}"`;
    }

    return new Promise((resolve) => {
        exec(ffmpegCmd, { timeout: 360000 }, (err) => {
            if (err || !fs.existsSync(outputPath)) {
                console.warn('[VIDEO] Transcoding failed or timed out:', err?.message || 'unknown error');
                resolve(inputPath);
            } else {
                const finalStats = fs.statSync(outputPath);
                console.log(`[VIDEO] Video successfully transcoded to ${Math.round(finalStats.size / (1024 * 1024))} MB`);
                try { fs.unlinkSync(inputPath); } catch (_) {}
                resolve(outputPath);
            }
        });
    });
}

// Download video stream using yt-dlp
async function downloadViaYtDlp(youtubeUrl) {
    const cookiesPath = path.resolve(__dirname, '../cookies.txt');
    const hasValidCookies = isValidCookieFile(cookiesPath);
    console.log(`[VIDEO] yt-dlp checking cookies at ${cookiesPath}: ${hasValidCookies ? 'VALID' : 'NOT FOUND/EMPTY'}`);

    const useIPv6 = await checkIPv6();
    console.log(`[VIDEO] yt-dlp network routing: ${useIPv6 ? 'IPv6 ENABLED (-6)' : 'IPv4 (standard)'}`);

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const outTemplate = path.join(workspaceTemp, `ytdl_${id}.%(ext)s`);
    const ytdlpBin = getYtDlpPath();
    const nodeBin = process.execPath || 'node';

    // Prefer native MP4 (H.264/AAC) if available to minimize transcoding time
    const formatSpec = "bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=480][ext=mp4]/bv*[height<=480]+ba/b[height<=480]/bv*[height<=360]+ba/b[height<=360]/best";
    const cookieArg = hasValidCookies ? `--cookies "${cookiesPath}"` : '';

    const executeDownload = (cmd) => {
        return new Promise((resolve, reject) => {
            console.log(`[VIDEO] Executing: ${cmd}`);
            exec(cmd, { timeout: 900000, maxBuffer: 50 * 1024 * 1024 }, async (error, stdout, stderr) => {
                if (error) {
                    return reject(new Error(stderr || stdout || error.message));
                }
                try {
                    const files = fs.readdirSync(workspaceTemp).filter(f => f.startsWith(`ytdl_${id}`));
                    if (files.length === 0) {
                        return reject(new Error('Downloaded file was not created by yt-dlp'));
                    }
                    let localFilePath = path.join(workspaceTemp, files[0]);

                    // Normalize and transcode for WhatsApp specifications
                    localFilePath = await prepareWhatsAppVideo(localFilePath, 42);

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
    const primaryCmd = `${ytdlpBin} ${ipv6Flag} ${cookieArg} --js-runtimes "node:${nodeBin}" --no-progress --max-filesize 70M --no-playlist -f "${formatSpec}" --merge-output-format mp4 -o "${outTemplate}" "${youtubeUrl}"`;

    try {
        return await executeDownload(primaryCmd);
    } catch (primaryErr) {
        console.warn('[VIDEO] Primary yt-dlp attempt failed:', primaryErr.message);
        const fallbackCmd = `${ytdlpBin} ${cookieArg} --no-progress --max-filesize 70M --no-playlist -f "${formatSpec}" --merge-output-format mp4 -o "${outTemplate}" "${youtubeUrl}"`;
        console.log('[VIDEO] Retrying yt-dlp with standard fallback configuration...');
        return await executeDownload(fallbackCmd);
    }
}

async function videoCommand(sock, chatId, message, rawText) {
    try {
        const text = rawText ||
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            message.message?.imageMessage?.caption ||
            message.message?.videoMessage?.caption || '';

        const searchQuery = text.replace(/^\.\w+\s*/i, '').trim();

        if (!searchQuery) {
            await sock.sendMessage(chatId, {
                text: 'What video do you want to download?\nExample: `.video Alan Walker Faded` or `.video <YouTube Link>`'
            }, { quoted: message });
            return;
        }

        // Recover YouTube metadata and restore genuine case-sensitive video ID if needed
        const ytInfo = await recoverYoutubeUrl(searchQuery);
        const videoUrl = ytInfo.url || searchQuery;
        const videoTitle = ytInfo.title || '';
        const videoThumbnail = ytInfo.thumbnail || '';

        // Validate YouTube URL
        const isYtUrl = /(?:https?:\/\/)?(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/)/i.test(videoUrl);
        if (!isYtUrl) {
            await sock.sendMessage(chatId, { text: '❌ No valid YouTube video found for: ' + searchQuery }, { quoted: message });
            return;
        }

        // Check if duration exceeds WhatsApp limits (over 30 minutes, e.g. full movies)
        if (ytInfo.durationSeconds && ytInfo.durationSeconds > 1800) {
            const mins = Math.floor(ytInfo.durationSeconds / 60);
            const timeStr = ytInfo.durationTimestamp || `${mins} mins`;
            console.log(`[VIDEO] Video exceeds duration limit: ${ytInfo.durationSeconds}s (${timeStr})`);
            await sock.sendMessage(chatId, {
                text: `⚠️ *මෙම වීඩියෝව WhatsApp සීමාවට වඩා දිගු වේ! / Video is too long for WhatsApp!*\n\n` +
                      `🎬 *Title:* ${videoTitle}\n` +
                      `⏱️ *Duration:* ${timeStr} _(WhatsApp උපරිම සීමාව: විනාඩි 30 / 45 MB)_\n\n` +
                      `💡 *Note:* පැය 1-2ක චිත්‍රපට (Full Movies) හෝ දිගු වීඩියෝ WhatsApp හරහා යැවීමට නොහැක.\n` +
                      `මෙම වීඩියෝවේ Audio (mp3) එක ලබා ගැනීමට පහත command එක භාවිතා කරන්න:\n\n` +
                      `👉 *.song ${videoUrl}*`
            }, { quoted: message });
            return;
        }

        // Send preview banner
        try {
            const ytId = ytInfo.videoId || (videoUrl.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/i) || [])[1];
            const thumb = videoThumbnail || (ytId ? `https://i.ytimg.com/vi/${ytId}/sddefault.jpg` : undefined);
            const captionTitle = videoTitle || searchQuery;
            const durStr = ytInfo.durationTimestamp ? `\n⏱️ Duration: *${ytInfo.durationTimestamp}*` : '';
            if (thumb) {
                await sock.sendMessage(chatId, {
                    image: { url: thumb },
                    caption: `🎬 *${captionTitle}*${durStr}\n⏳ Downloading & preparing video...`
                }, { quoted: message });
            }
        } catch (e) {
            console.error('[VIDEO] thumb preview error:', e?.message || e);
        }

        const safeTitle = (videoTitle || searchQuery || 'video').replace(/[^\w\s-]/g, '').trim() || 'video';

        // Execute yt-dlp download & transcode
        console.log('[VIDEO] Attempting download strictly with yt-dlp for:', videoUrl);
        const localDownloadResult = await downloadViaYtDlp(videoUrl);

        if (!localDownloadResult || !localDownloadResult.filePath) {
            throw new Error('yt-dlp could not produce a downloadable file.');
        }

        const filePath = localDownloadResult.filePath;
        try {
            const probe = getVideoMeta(filePath);
            const fileSizeMb = Math.round(probe.sizeMb * 10) / 10;
            const durationFormatted = ytInfo.durationTimestamp || (probe.duration ? `${Math.round(probe.duration)}s` : '');

            // Secondary check: if probe shows duration > 1800s
            if (probe.duration > 1800) {
                await sock.sendMessage(chatId, {
                    text: `⚠️ *මෙම වීඩියෝව WhatsApp සීමාවට වඩා දිගු වේ! / Video exceeds WhatsApp limits!*\nDuration: ${Math.floor(probe.duration / 60)} mins (Max 30 mins). Use *.song* for audio.`
                }, { quoted: message });
                return;
            }

            const captionText = `🎬 *${videoTitle || 'YouTube Video'}*\n` +
                `📦 Size: *${fileSizeMb} MB*` + (durationFormatted ? ` | ⏱️ Duration: *${durationFormatted}*` : '') + `\n\n` +
                `> *_Downloaded by X-Bot_*`;

            // WhatsApp upload logic:
            // <= 16MB: can be sent as direct playable video
            // 16MB - 45MB: sent as WhatsApp Document
            if (fileSizeMb <= 16) {
                console.log(`[VIDEO] Sending as playable video (${fileSizeMb} MB <= 16MB)...`);
                try {
                    await sock.sendMessage(chatId, {
                        video: { url: filePath },
                        mimetype: 'video/mp4',
                        fileName: `${safeTitle}.mp4`,
                        caption: captionText
                    }, { quoted: message, mediaUploadTimeoutMs: 600000 });
                } catch (sendErr) {
                    console.log('[VIDEO] Playable video send failed, sending as document:', sendErr.message);
                    await sock.sendMessage(chatId, {
                        document: { url: filePath },
                        mimetype: 'video/mp4',
                        fileName: `${safeTitle}.mp4`,
                        caption: captionText
                    }, { quoted: message, mediaUploadTimeoutMs: 600000 });
                }
            } else {
                console.log(`[VIDEO] Sending as document (${fileSizeMb} MB > 16MB)...`);
                await sock.sendMessage(chatId, {
                    document: { url: filePath },
                    mimetype: 'video/mp4',
                    fileName: `${safeTitle}.mp4`,
                    caption: captionText
                }, { quoted: message, mediaUploadTimeoutMs: 600000 });
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
        const msg = error?.message || '';
        if (msg.includes('Sign in to confirm you’re not a bot') || msg.includes('bot confirmation')) {
            errorMessage = '⚠️ YouTube requires authentication. Please export cookies.txt from your browser and paste it in the Bot Dashboard.';
        } else if (msg.includes('terminated') || msg.includes('Media upload failed') || msg.includes('413')) {
            errorMessage = '❌ WhatsApp media upload server rejected the file. The video is likely too large for WhatsApp delivery (limit 45MB). Try downloading audio using *.song* instead.';
        } else if (msg.includes('This video is unavailable')) {
            errorMessage = '❌ YouTube reported: This video is unavailable (check if the link is correct or removed).';
        } else if (msg.includes('blocked') || msg.includes('451')) {
            errorMessage = '❌ Download blocked by YouTube. Content unavailable in region.';
        } else if (msg) {
            errorMessage = '❌ Error: ' + msg.slice(0, 160);
        }

        await sock.sendMessage(chatId, {
            text: errorMessage
        }, { quoted: message });
    }
}

module.exports = videoCommand;
