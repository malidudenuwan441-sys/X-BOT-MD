// commands/cosplay.js

// Character Name to API URL Mapping
const characterApis = {
    'asuma': 'https://api.shizo.top/cosplay/genshin-impact/asuma?apikey=shizo',
    'ayaka': 'https://api.shizo.top/cosplay/genshin-impact/ayaka-kamisato?apikey=shizo',
    'furina': 'https://api.shizo.top/cosplay/genshin-impact/furina?apikey=shizo',
    'ganyu': 'https://api.shizo.top/cosplay/genshin-impact/ganyu-succubus?apikey=shizo',
    'kurumi': 'https://api.shizo.top/cosplay/genshin-impact/kurumi-tokisaki?apikey=shizo',
    'nahida': 'https://api.shizo.top/cosplay/genshin-impact/nahida?apikey=shizo',
    'yaemiko': 'https://api.shizo.top/cosplay/genshin-impact/yaemiko?apikey=shizo',
    'yume': 'https://api.shizo.top/cosplay/genshin-impact/yumemizuki?apikey=shizo'
};

// 1. Cosplay Menu Command (.cosplay)
async function cosplayMenuCommand(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, { react: { text: '🎭', key: message.key } });

        const menuText = `╔═══════════════════╗
🎭 *COSPLAY CHARACTERS MENU* 🎭
╚═══════════════════╝

Available Character Commands:

 ➤ .asuma    - Asuma Sarutobi
 ➤ .ayaka    - Ayaka Kamisato
 ➤ .furina   - Furina Fontaine
 ➤ .ganyu    - Ganyu Succubus
 ➤ .kurumi   - Kurumi Tokisaki
 ➤ .nahida   - Nahida Kusanali
 ➤ .yaemiko  - YaeMiko Guuji
 ➤ .yume     - Yume Mizuki

👉 Type any command above to get cosplay images!

⚡ *X BOT OFFICIAL* ⚡`;

        await sock.sendMessage(chatId, { text: menuText }, { quoted: message });
    } catch (error) {
        console.error("Cosplay Menu Error:", error);
    }
}

// 2. Character Image Fetcher Function
async function handleCosplayImage(sock, chatId, message, character) {
    try {
        const imageUrl = characterApis[character];
        if (!imageUrl) return false;

        await sock.sendMessage(chatId, { react: { text: '📸', key: message.key } });

        // Direct image response sending
        await sock.sendMessage(chatId, {
            image: { url: imageUrl },
            caption: `🎭 *${character.toUpperCase()} COSPLAY*`
        }, { quoted: message });

        return true;
    } catch (error) {
        console.error(`Error fetching ${character} cosplay:`, error);
        await sock.sendMessage(chatId, { text: '❌ Failed to fetch image. Try again later!' }, { quoted: message });
        return true;
    }
}

module.exports = {
    cosplayMenuCommand,
    handleCosplayImage
};