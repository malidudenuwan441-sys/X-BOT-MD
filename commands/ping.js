const os = require('os');
const fs = require('fs');

async function pingCommand(sock, chatId, message) {
    try {
        const start = Date.now();

        // React Loading Icon
        await sock.sendMessage(chatId, { react: { text: '⚡', key: message.key } });

        const end = Date.now();
        const latency = end - start;

        // Calculate Uptime
        const uptimeSeconds = process.uptime();
        const days = Math.floor(uptimeSeconds / (3600 * 24));
        const hours = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = Math.floor(uptimeSeconds % 60);
        const uptimeString = `${days > 0 ? `${days}d ` : ''}${hours}h ${minutes}m ${seconds}s`;

        // Calculate Memory Usage
        const totalMemMB = (os.totalmem() / 1024 / 1024).toFixed(0);
        const usedMemMB = ((os.totalmem() - os.freemem()) / 1024 / 1024).toFixed(0);
        const ramPercent = ((usedMemMB / totalMemMB) * 100).toFixed(1);

        // Calculate Disk Usage (Process Directory)
        let diskInfo = 'N/A';
        try {
            const stats = fs.statSync(process.cwd());
            // Fetch root disk stats if available
            const statfs = fs.statfsSync ? fs.statfsSync('/') : null;
            if (statfs) {
                const totalDisk = ((statfs.blocks * statfs.bsize) / (1024 * 1024 * 1024)).toFixed(1);
                const freeDisk = ((statfs.bfree * statfs.bsize) / (1024 * 1024 * 1024)).toFixed(1);
                const usedDisk = (totalDisk - freeDisk).toFixed(1);
                diskInfo = `${usedDisk} GB / ${totalDisk} GB`;
            }
        } catch (e) {
            diskInfo = 'Active';
        }

        const responseText = `
┌───「 🤖 *BOT SYSTEM STATUS* 」───
│
├ ⚡ *Speed:* \`${latency} ms\`
├ ⏳ *Uptime:* \`${uptimeString}\`
│
├ 🧠 *RAM Usage:* \`${usedMemMB} MB / ${totalMemMB} MB (${ramPercent}%)\`
├ 💽 *Disk Usage:* \`${diskInfo}\`
├ 💻 *Platform:* \`${os.platform()} (${os.arch()})\`
│
└───「 *X-BOT MD* 」───
        `.trim();

        await sock.sendMessage(chatId, { text: responseText }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (error) {
        console.error('Ping Command Error:', error.message);
    }
}

module.exports = pingCommand;