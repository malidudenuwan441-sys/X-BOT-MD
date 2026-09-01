const axios = require('axios');

module.exports = async function (sock, chatId, message, city) {
    try {
        if (!city || city.trim() === '') {
            return await sock.sendMessage(chatId, { 
                text: '⚠️ *Please provide a city name!*\n\n*Example:* `.weather Colombo`' 
            }, { quoted: message });
        }

        // React Loading Icon
        await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });

        const apiKey = '4902c0f2550f58298ad4146a92b65e10';
        const response = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`);
        const weather = response.data;

        // Dynamic Weather Emojis & Reactions
        const mainState = weather.weather[0].main.toLowerCase();
        let weatherEmoji = '🌤️';
        let reactEmoji = '🌡️';

        if (mainState.includes('rain') || mainState.includes('drizzle')) {
            weatherEmoji = '🌧️';
            reactEmoji = '🌧️';
        } else if (mainState.includes('thunderstorm')) {
            weatherEmoji = '⛈️';
            reactEmoji = '⚡';
        } else if (mainState.includes('clear')) {
            weatherEmoji = '☀️';
            reactEmoji = '☀️';
        } else if (mainState.includes('clouds')) {
            weatherEmoji = '☁️';
            reactEmoji = '☁️';
        } else if (mainState.includes('snow')) {
            weatherEmoji = '❄️';
            reactEmoji = '❄️';
        } else if (mainState.includes('mist') || mainState.includes('fog')) {
            weatherEmoji = '🌫️';
            reactEmoji = '🌫️';
        }

        const weatherText = `
┌───「 ${weatherEmoji} *WEATHER REPORT* 」───
│
├ 📍 *Location:* \`${weather.name}, ${weather.sys.country}\`
├ 🌡️ *Temperature:* \`${weather.main.temp}°C\` (Feels like \`${weather.main.feels_like}°C\`)
├ 🌈 *Condition:* \`${weather.weather[0].description.toUpperCase()}\`
├ 💧 *Humidity:* \`${weather.main.humidity}%\`
├ 💨 *Wind Speed:* \`${weather.wind.speed} m/s\`
├ 🎈 *Pressure:* \`${weather.main.pressure} hPa\`
│
└───「 *X-BOT MD* 」───
        `.trim();

        await sock.sendMessage(chatId, { text: weatherText }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: reactEmoji, key: message.key } });

    } catch (error) {
        console.error('Error fetching weather:', error?.response?.data || error.message);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, { 
            text: '❌ *Could not fetch weather!* Please check the city name and try again.' 
        }, { quoted: message });
    }
};