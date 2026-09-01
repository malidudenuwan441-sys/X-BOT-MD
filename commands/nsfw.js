const axios = require('axios');

// Supported NSFW types (Excluding cosplay)
const nsfwTypes = [
    'hass', 'hmidriff', 'pgif', '4k', 'hentai', 'holo', 'hneko', 'neko',
    'hkitsune', 'kemonomimi', 'anal', 'hanal', 'gonewild', 'kanna', 'ass',
    'pussy', 'thigh', 'hthigh', 'gah', 'coffee', 'food', 'paizuri',
    'tentacle', 'boobs', 'hboobs', 'yaoi', 'swimsuit', 'pantsu', 'nakadashi'
];

async function nsfwMenuCommand(sock, chatId, message) {
    let menuText = `🔞 *NSFW COMMAND MENU* 🔞\n\n` +
                   `Select an option using command:\n\n`;

    nsfwTypes.forEach(type => {
        menuText += `👉 \`.${type}\`\n`;
    });

    await sock.sendMessage(chatId, { text: menuText.trim() }, { quoted: message });
}

async function handleNsfwImage(sock, chatId, message, type) {
    try {
        await sock.sendMessage(chatId, { react: { text: '🔞', key: message.key } });

        const response = await axios.get(`https://nekobot.xyz/api/image?type=${type}`);
        const imageUrl = response.data?.message;

        if (!imageUrl) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, { text: '❌ Failed to fetch image.' }, { quoted: message });
        }

        // Send as Image only
        await sock.sendMessage(chatId, {
            image: { url: imageUrl },
            caption: `🔞 *Type:* \`.${type}\``
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (error) {
        console.error('NSFW Command Error:', error.message);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, { text: '❌ Error fetching image.' }, { quoted: message });
    }
}

module.exports = { nsfwMenuCommand, handleNsfwImage, nsfwTypes };