/**
 * src/notifier.js
 * Termux bildirim yöneticisi.
 */

const { execSync } = require('child_process');

const NOTIFICATION_ID = "indirme_durumu";

/**
 * @param {number} current
 * @param {number} total
 * @param {'progress'|'success'} status
 */
function sendTermuxNotification(current, total, status) {
    try {
        if (status === "success") {
            execSync(
                `termux-notification -i "${NOTIFICATION_ID}" ` +
                `-t "İşlem Başarılı" ` +
                `-c "Tüm dosyalar (${total}/${total}) cihazına kaydedildi." ` +
                `--icon "check_circle" --led-color "00FF00"`
            );
            return;
        }

        const filled = Math.round((current / total) * 10);
        const bar    = '#'.repeat(filled) + '.'.repeat(10 - filled);

        execSync(
            `termux-notification -i "${NOTIFICATION_ID}" ` +
            `-t "Bölümler Çevriliyor" ` +
            `-c "[${bar}] ${current}/${total} tamamlandı" ` +
            `--icon "sync" --priority high`
        );
    } catch {
        console.error("⚠️ Termux bildirimi gönderilemedi.");
    }
}

module.exports = { sendTermuxNotification };

