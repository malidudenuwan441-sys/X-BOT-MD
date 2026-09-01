const fs = require('fs');
const path = require('path');

async function aliveCommand(sock, chatId, message) {
    try {
        // Extract sender's WhatsApp name
        const pushName = message.pushName || message.key.author?.split('@')[0] || "User";

        // React Hand Wave Emoji
        await sock.sendMessage(chatId, { react: { text: '👋', key: message.key } });

        const caption = 
`👋 *Hello, ${pushName}!*

🤖 *X-Bot is Active & Running!*

⚙️ *Status:* Online & Operational 🟢
⚡ *Speed:* Super Fast & Response-Ready
🎯 *Prefix:* [ . ]
🎮 *Mode:* Public Mode

✨ *Features Available:*
• Group Management & Antilink
• Media, Song & Video Downloader
• Smart AI Chatbot & Image Tools

 Type *.menu* to get the list of available commands!`;

        // Image Path from assets
        const imagePath = path.join(__dirname, '../assets/bot_image.jpg');

        await sock.sendMessage(chatId, {
            image: fs.readFileSync(imagePath),
            caption: caption
        }, { quoted: message });

    } catch (error) {
        console.error('Alive Command Error:', error.message);
    }
}

module.exports = aliveCommand;