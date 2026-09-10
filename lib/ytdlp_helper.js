const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const yts = require('yt-search');

const BIN_DIR = path.join(process.cwd(), 'bin');
const LOCAL_YTDLP = path.join(BIN_DIR, 'yt-dlp');

function getYtDlpPath() {
    if (fs.existsSync(LOCAL_YTDLP)) {
        try {
            fs.accessSync(LOCAL_YTDLP, fs.constants.X_OK);
            return LOCAL_YTDLP;
        } catch (e) {
            try { fs.chmodSync(LOCAL_YTDLP, 0o755); return LOCAL_YTDLP; } catch (_) {}
        }
    }
    if (fs.existsSync('/usr/local/bin/yt-dlp')) {
        return '/usr/local/bin/yt-dlp';
    }
    return 'yt-dlp';
}

function ensureYtDlp() {
    if (fs.existsSync(LOCAL_YTDLP)) {
        return LOCAL_YTDLP;
    }
    try {
        if (!fs.existsSync(BIN_DIR)) {
            fs.mkdirSync(BIN_DIR, { recursive: true });
        }
        console.log('[YT-DLP] Downloading standalone binary to ./bin/yt-dlp...');
        execSync('curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ' + LOCAL_YTDLP, { timeout: 60000 });
        fs.chmodSync(LOCAL_YTDLP, 0o755);
        console.log('[YT-DLP] Standalone binary installed successfully at:', LOCAL_YTDLP);
        return LOCAL_YTDLP;
    } catch (err) {
        console.warn('[YT-DLP] Auto-download failed, falling back to system binary:', err.message);
        return getYtDlpPath();
    }
}

/**
 * YouTube video IDs are 11-character case-sensitive Base64url strings.
 * If user or chat lowercased the ID (e.g. rjpr2mdg4hs instead of RjpR2Mdg4hs),
 * YouTube returns "Video unavailable".
 * This helper queries yt-search to restore the genuine case-sensitive ID.
 */
async function recoverYoutubeUrl(inputUrlOrQuery) {
    if (!inputUrlOrQuery) return { url: '', title: '', thumbnail: '' };
    
    const trimmed = inputUrlOrQuery.trim();
    const ytMatch = trimmed.match(/(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|v\/|embed\/|shorts\/)?)([a-zA-Z0-9_-]{11})/i);
    
    if (ytMatch && ytMatch[1]) {
        const rawId = ytMatch[1];
        try {
            // First check if direct videoId works
            const direct = await yts({ videoId: rawId }).catch(() => null);
            if (direct && direct.title) {
                return {
                    url: direct.url || `https://www.youtube.com/watch?v=${direct.videoId}`,
                    title: direct.title,
                    thumbnail: direct.thumbnail,
                    videoId: direct.videoId,
                    durationSeconds: direct.seconds || direct.duration?.seconds || 0,
                    durationTimestamp: direct.timestamp || direct.duration?.timestamp || ''
                };
            }
            
            // If direct failed (e.g., lowercased ID), search for the rawId as text query
            const searchResults = await yts(rawId).catch(() => null);
            if (searchResults?.videos?.length > 0) {
                const matched = searchResults.videos.find(v => v.videoId.toLowerCase() === rawId.toLowerCase()) || searchResults.videos[0];
                if (matched && matched.videoId.toLowerCase() === rawId.toLowerCase()) {
                    console.log(`[YT-DLP] Case-recovered YouTube ID: ${rawId} -> ${matched.videoId} ("${matched.title}")`);
                    return {
                        url: matched.url || `https://www.youtube.com/watch?v=${matched.videoId}`,
                        title: matched.title,
                        thumbnail: matched.thumbnail,
                        videoId: matched.videoId,
                        durationSeconds: matched.seconds || matched.duration?.seconds || 0,
                        durationTimestamp: matched.timestamp || matched.duration?.timestamp || ''
                    };
                }
            }
        } catch (err) {
            console.warn('[YT-DLP] ID recovery error:', err?.message || err);
        }
        
        return {
            url: trimmed.startsWith('http') ? trimmed : `https://www.youtube.com/watch?v=${rawId}`,
            title: '',
            thumbnail: `https://i.ytimg.com/vi/${rawId}/sddefault.jpg`,
            videoId: rawId,
            durationSeconds: 0,
            durationTimestamp: ''
        };
    }
    
    // Not a direct link, treat as search query
    try {
        const searchResults = await yts(trimmed).catch(() => null);
        if (searchResults?.videos?.length > 0) {
            const first = searchResults.videos[0];
            return {
                url: first.url,
                title: first.title,
                thumbnail: first.thumbnail,
                videoId: first.videoId,
                durationSeconds: first.seconds || first.duration?.seconds || 0,
                durationTimestamp: first.timestamp || first.duration?.timestamp || ''
            };
        }
    } catch (e) {}

    return {
        url: trimmed,
        title: '',
        thumbnail: '',
        durationSeconds: 0,
        durationTimestamp: ''
    };
}

module.exports = {
    getYtDlpPath,
    ensureYtDlp,
    recoverYoutubeUrl
};
