const fs = require('fs');
const path = require('path');

// 1. Main Menu Command (.menu / .help ගැහුවාම එවන Message එක)
async function menuCommand(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, { react: { text: '📜', key: message.key } });

        const menuText = `╔═══════════════════╗
🤖 *X BOT COMMAND MENU* 🤖
╚═══════════════════╝

1️⃣  🌐 General Commands
2️⃣  👮‍♂️ Admin Commands
3️⃣  🔒 Owner Commands
4️⃣  🎨 Image / Sticker Commands
5️⃣  🖼️ Pies Commands
6️⃣  🎮 Game Commands
7️⃣  🤖 AI Commands
8️⃣  🎯 Fun Commands
9️⃣  🔤 Textmaker Commands
1️⃣0️⃣ 📥 Downloader Commands
1️⃣1️⃣ 🧩 MISC Commands
1️⃣2️⃣ 🖼️ Anime Commands
1️⃣3️⃣ 💻 Github Commands

*Example:* Type *1* for General Commands

⚡ *X BOT OFFICIAL* ⚡`;

        const imagePath = path.join(__dirname, '../assets/bot_image.jpg');
        if (fs.existsSync(imagePath)) {
            await sock.sendMessage(chatId, {
                image: fs.readFileSync(imagePath),
                caption: menuText
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, { text: menuText }, { quoted: message });
        }
    } catch (error) {
        console.error("Menu Command Error:", error);
    }
}

// 2. Reply Handler Function (1-13 numbers වලට උත්තර දෙන කොටස)
async function handleMenuReply(sock, chatId, message) {
    try {
        const text = message.message?.conversation || 
                     message.message?.extendedTextMessage?.text || '';
        
        const cleanText = text.trim();

        const subMenus = {
            '1': `╔═══════════════════╗
🌐 *General Commands*:
║ ➤ .help / .menu - Show menu
║ ➤ .ping - Bot response speed
║ ➤ .alive - Bot status
║ ➤ .tts <text> - Text to speech
║ ➤ .owner - Owner details
║ ➤ .joke - Random joke
║ ➤ .quote - Motivational quote
║ ➤ .fact - Random fact
║ ➤ .weather <city> - Weather info
║ ➤ .news - Latest news
║ ➤ .attp <text> - Text to animated sticker
║ ➤ .lyrics <song> - Song lyrics
║ ➤ .8ball <question> - Ask magic 8ball
║ ➤ .groupinfo - Group details
║ ➤ .staff / .admins - List admins
║ ➤ .vv - View once message reveal
║ ➤ .trt <text> <lang> - Translate text
║ ➤ .ss <link> - Website screenshot
║ ➤ .jid - Get chat JID
║ ➤ .url - Image/Video to link
╚═══════════════════╝`,

            '2': `╔═══════════════════╗
👮‍♂️ *Admin Commands*:
║ ➤ .ban @user - Ban member
║ ➤ .promote @user - Make admin
║ ➤ .demote @user - Remove admin
║ ➤ .mute <min> - Mute group
║ ➤ .unmute - Unmute group
║ ➤ .delete / .del - Delete message
║ ➤ .kick @user - Remove member
║ ➤ .warnings @user - Check warnings
║ ➤ .warn @user - Give warning
║ ➤ .antilink - Link protection
║ ➤ .antibadword - Badword filter
║ ➤ .clear - Clear chat
║ ➤ .tag <msg> - Tag message
║ ➤ .tagall - Mention everyone
║ ➤ .tagnotadmin - Mention non-admins
║ ➤ .hidetag <msg> - Hide tag message
║ ➤ .chatbot - Auto AI response
║ ➤ .resetlink - Reset group link
║ ➤ .antitag <on/off> - Anti-tag system
║ ➤ .welcome <on/off> - Welcome msg
║ ➤ .goodbye <on/off> - Goodbye msg
║ ➤ .setgdesc <text> - Change group desc
║ ➤ .setgname <text> - Change group name
║ ➤ .setgpp - Change group icon
╚═══════════════════╝`,

            '3': `╔═══════════════════╗
🔒 *Owner Commands*:
║ ➤ .mode <pub/priv> - Set bot mode
║ ➤ .clearsession - Clear bot session
║ ➤ .antidelete - Anti-delete msgs
║ ➤ .cleartmp - Clear temp files
║ ➤ .update - Update bot code
║ ➤ .settings - View bot settings
║ ➤ .setpp - Change profile picture
║ ➤ .autoreact <on/off> - Auto reaction
║ ➤ .autostatus <on/off> - Auto status view
║ ➤ .autostatus react - Auto status react
║ ➤ .autotyping <on/off> - Show typing
║ ➤ .autoread <on/off> - Auto blue tick
║ ➤ .anticall <on/off> - Block incoming calls
║ ➤ .pmblocker <on/off> - Block inbox msgs
║ ➤ .pmblocker setmsg - PM blocker text
║ ➤ .setmention <msg> - Set mention reply
║ ➤ .mention <on/off> - Mention auto reply
╚═══════════════════╝`,

            '4': `╔═══════════════════╗
🎨 *Image/Sticker Commands*:
║ ➤ .blur <img/reply> - Blur image
║ ➤ .simage <reply> - Sticker to image
║ ➤ .sticker <reply> - Image to sticker
║ ➤ .removebg - Remove background
║ ➤ .remini - Enhance image quality
║ ➤ .crop <reply> - Crop photo
║ ➤ .tgsticker <link> - Telegram sticker
║ ➤ .meme - Random meme
║ ➤ .take <pack> - Change sticker metadata
║ ➤ .emojimix <e1>+<e2> - Mix emojis
║ ➤ .igs <link> - Insta story download
║ ➤ .igsc <link> - Insta story highlight
╚═══════════════════╝`,

            '5': `╔═══════════════════╗
🖼️ *Pies Commands*:
║ ➤ .pies <country> - Country photos
║ ➤ .china - China aesthetic
║ ➤ .indonesia - Indo aesthetic
║ ➤ .japan - Japan aesthetic
║ ➤ .korea - Korea aesthetic
║ ➤ .hijab - Hijab aesthetic
╚═══════════════════╝`,

            '6': `╔═══════════════════╗
🎮 *Game Commands*:
║ ➤ .tictactoe @user - Play TicTacToe
║ ➤ .hangman - Hangman word game
║ ➤ .guess <letter> - Guess letter
║ ➤ .trivia - Trivia question
║ ➤ .answer <ans> - Answer trivia
║ ➤ .truth - Truth question
║ ➤ .dare - Dare challenge
╚═══════════════════╝`,

            '7': `╔═══════════════════╗
🤖 *AI Commands*:
║ ➤ .gpt <q> - ChatGPT answer
║ ➤ .gemini <q> - Gemini AI answer
║ ➤ .imagine <prompt> - AI image gen
║ ➤ .flux <prompt> - Flux AI image
║ ➤ .sora <prompt> - Sora video gen
╚═══════════════════╝`,

            '8': `╔═══════════════════╗
🎯 *Fun Commands*:
║ ➤ .compliment @user - Send compliment
║ ➤ .insult @user - Send roast
║ ➤ .flirt - Flirt lines
║ ➤ .shayari - Romantic quotes
║ ➤ .goodnight - Goodnight wishes
║ ➤ .roseday - Rose day quotes
║ ➤ .character @user - Character test
║ ➤ .wasted @user - Wasted effect
║ ➤ .ship @user - Match compatibility
║ ➤ .simp @user - Simp rate
║ ➤ .stupid @user - Stupid rate
╚═══════════════════╝`,

            '9': `╔═══════════════════╗
🔤 *Textmaker*:
║ ➤ .metallic <text> - Metallic style
║ ➤ .ice <text> - Ice text style
║ ➤ .snow <text> - Snow text style
║ ➤ .impressive <text> - 3D text
║ ➤ .matrix <text> - Matrix text
║ ➤ .light <text> - Light text
║ ➤ .neon <text> - Neon glow text
║ ➤ .devil <text> - Devil style text
║ ➤ .purple <text> - Purple glow text
║ ➤ .thunder <text> - Thunder style
║ ➤ .leaves <text> - Nature leaves style
║ ➤ .1917 <text> - Vintage 1917 style
║ ➤ .arena <text> - Arena style
║ ➤ .hacker <text> - Hacker text style
║ ➤ .sand <text> - Sand text style
║ ➤ .blackpink <text> - Blackpink style
║ ➤ .glitch <text> - Glitch effect
║ ➤ .fire <text> - Fire text style
╚═══════════════════╝`,

            '10': `╔═══════════════════╗
📥 *Downloader*:
║ ➤ .play <song> - Audio downloader
║ ➤ .song <song> - MP3 downloader
║ ➤ .spotify <query> - Spotify track
║ ➤ .instagram <link> - Insta downloader
║ ➤ .facebook <link> - FB downloader
║ ➤ .tiktok <link> - TikTok downloader
║ ➤ .video <song> - Video downloader
║ ➤ .ytmp4 <link> - YouTube MP4
╚═══════════════════╝`,

            '11': `╔═══════════════════╗
🧩 *MISC*:
║ ➤ .heart - Heart card
║ ➤ .horny - Horny card
║ ➤ .circle - Circular image
║ ➤ .lgbt - LGBT overlay
║ ➤ .lolice - Lolice badge
║ ➤ .its-so-stupid - Meme template
║ ➤ .namecard - Name card generator
║ ➤ .oogway - Master Oogway quote
║ ➤ .tweet - Fake tweet maker
║ ➤ .ytcomment - Fake YT comment
║ ➤ .comrade - Comrade overlay
║ ➤ .gay - Gay rate card
║ ➤ .glass - Broken glass effect
║ ➤ .jail - Jail overlay
║ ➤ .passed - Respect card
║ ➤ .triggered - Triggered GIF
╚═══════════════════╝`,

            '12': `╔═══════════════════╗
🖼️ *ANIME*:
║ ➤ .nom - Anime eating reaction
║ ➤ .poke - Poke someone
║ ➤ .cry - Anime crying GIF
║ ➤ .kiss - Kiss reaction
║ ➤ .pat - Head pat reaction
║ ➤ .hug - Hug reaction
║ ➤ .wink - Wink reaction
║ ➤ .facepalm - Facepalm GIF
╚═══════════════════╝`,

            '13': `╔═══════════════════╗
💻 *Github Commands:*
║ ➤ .git - GitHub profile info
║ ➤ .github - Search repository
║ ➤ .sc - Get bot source code
║ ➤ .script - Script information
║ ➤ .repo - GitHub repository link
╚═══════════════════╝`
        };

        if (subMenus[cleanText]) {
            if (cleanText === '3') {
                const isFromMe = message.key.fromMe;
                const senderJid = message.key.participant || message.key.remoteJid || '';
                const botJid = sock.user?.id || '';

                const cleanNum = (jid) => jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
                const senderNum = cleanNum(senderJid);
                const botNum = cleanNum(botJid);

                if (!isFromMe && senderNum !== botNum) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ *Access Denied!*' 
                    }, { quoted: message });
                    return true;
                }
            }

            await sock.sendMessage(chatId, { react: { text: '📜', key: message.key } });

            const imagePath = path.join(__dirname, '../assets/bot_image.jpg');
            const hasImage = fs.existsSync(imagePath);
            const captionText = `${subMenus[cleanText]}\n\n⚡ *X BOT OFFICIAL* ⚡`;

            if (hasImage) {
                await sock.sendMessage(chatId, {
                    image: fs.readFileSync(imagePath),
                    caption: captionText
                }, { quoted: message });
            } else {
                await sock.sendMessage(chatId, { text: captionText }, { quoted: message });
            }
            return true;
        }

        return false;
    } catch (error) {
        console.error("Menu Reply Error:", error);
        return false;
    }
}

module.exports = {
    menuCommand,
    helpCommand: menuCommand,
    handleMenuReply
};
