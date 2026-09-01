const axios = require('axios');

async function newsCommand(sock, chatId, message) {
    try {
        // Command එක ආපු ගමන් 📰 Reaction එකක් දීම
        await sock.sendMessage(chatId, {
            react: { text: '📰', key: message.key }
        });

        // Working URL: https://esena-news-api-v3.vercel.app/
        const res = await axios.get('https://esena-news-api-v3.vercel.app/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            },
            timeout: 10000
        });
        
        // Data Structure: res.data.news_data.data
        const newsArray = res.data?.news_data?.data || [];

        if (!Array.isArray(newsArray) || newsArray.length === 0) {
            // Error එකක් ආවොත් React එක ❌ වෙනස් කිරීම
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, { text: '❌ නවතම පුවත් සොයාගැනීමට නොහැකි විය.' }, { quoted: message });
        }

        // මුල් පුවත් 5 ලබාගැනීම
        const topNews = newsArray.slice(0, 5);

        let txt = `📰 *X-BOT LATEST NEWS*\n\n`;

        topNews.forEach((news, index) => {
            const title = news.titleSi || news.titleEn || 'මාතෘකාවක් නොමැත';

            // contentSi ඇතුළෙන් Text Data පමණක් Extract කරගැනීම
            let description = '';
            if (Array.isArray(news.contentSi)) {
                description = news.contentSi
                    .filter(item => item.type === 'text' && item.data)
                    .map(item => item.data)
                    .join(' ');
            } else if (typeof news.contentSi === 'string') {
                description = news.contentSi;
            } else {
                description = 'විස්තරයක් නොමැත.';
            }

            // Message එක දිග වැඩි නොවීමට characters 200ට Trim කිරීම
            if (description.length > 200) {
                description = description.substring(0, 200) + '...';
            }

            const time = news.published || '';
            const link = news.share_url || '';

            txt += `*${index + 1}. ${title.trim()}*\n`;
            txt += `📝 ${description.trim()}\n`;
            if (time) txt += `🕒 ${time}\n`;
            if (link) txt += `🔗 ${link}\n`;
            txt += `\n───────────────────\n\n`;
        });

        txt += `⚡ *X-BOT NEWS SERVICE*`;

        // News ටික Send කරලා Success React එකක් (✅) දීම
        await sock.sendMessage(chatId, { text: txt }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (error) {
        console.error('News Command Error:', error.message);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, { text: '❌ පුවත් ලබාගැනීමේදී දෝෂයක් සිදු විය.' }, { quoted: message });
    }
}

module.exports = { newsCommand };