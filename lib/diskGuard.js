const OWNER_NUMBER = "94719531525";

function setupDiskGuard() {
    process.on('uncaughtException', async (err) => {
        if (err.code === 'ENOSPC' || err.message?.includes('ENOSPC')) {
            console.error('🚨 DISK FULL ERROR DETECTED (ENOSPC)');

            if (global.sock && global.lastActiveChatId) {
                try {
                    await global.sock.sendMessage(global.lastActiveChatId, {
                        text: `⚠️ *Bot එකේ Disk Space පිරී පවතින බැවින් Download එක අවලංගු විය!*\n\nකරුණාකර Bot Owner සම්බන්ධ කරගන්න:\n📞 *Owner:* wa.me/${OWNER_NUMBER}`
                    });
                } catch (sendErr) {
                    console.error('Failed to send ENOSPC alert message:', sendErr);
                }
            }
        } else {
            console.error('Uncaught Exception:', err);
        }
    });

    process.on('unhandledRejection', async (reason) => {
        const err = reason || {};
        if (err.code === 'ENOSPC' || err.message?.includes('ENOSPC')) {
            console.error('🚨 DISK FULL REJECTION DETECTED (ENOSPC)');

            if (global.sock && global.lastActiveChatId) {
                try {
                    await global.sock.sendMessage(global.lastActiveChatId, {
                        text: `⚠️ *Bot එකේ Disk Space පිරී පවතින බැවින් Download එක අවලංගු විය!*\n\nකරුණාකර Bot Owner සම්බන්ධ කරගන්න:\n📞 *Owner:* wa.me/${OWNER_NUMBER}`
                    });
                } catch (sendErr) {
                    console.error('Failed to send ENOSPC alert message:', sendErr);
                }
            }
        } else {
            console.error('Unhandled Rejection:', reason);
        }
    });
}

module.exports = { setupDiskGuard };