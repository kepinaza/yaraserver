const { axiosInstance } = require('./axios');
const db = require('./db');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const formData = new FormData();

async function sendMessage(messageObj, messageText) {
    return axiosInstance.get("sendMessage", {
        chat_id: messageObj.chat.id,
        text: messageText,
    });
}

async function handleMessage(messageObj) {
    const messageText = messageObj.text || "";

    if (!messageText.startsWith("/")) return;

    const parts = messageText.split(" ");
    const command = parts[0].substring(1).toLowerCase();

    if (command === "vip" && parts.length === 4) {
        const orderId = parts[1];
        const inputUsername = parts[2].replace("@", "");
        const days = parseInt(parts[3]);

        if (isNaN(days)) {
            return sendMessage(messageObj, "Format salah. Contoh: /vip 12345 username 3");
        }

        try {
            const telegramId = messageObj.from.id;
            const username = messageObj.from.username;

            const [exists] = await db.query(
                "SELECT * FROM vip_members WHERE username = ? OR order_id = ?",
                [username, orderId]
            );

            if (exists.length > 0) {
                return sendMessage(messageObj, "❌ Username atau ID pesanan sudah ada di daftar VIP.");
            }

            await logAction({
              type: "ADD",
              username,
              telegram_id: telegramId,
              order_id: orderId,
              message: `Menambahkan VIP selama ${days} hari`
            });

            await db.query(`
                INSERT INTO vip_members (order_id, telegram_id, username, join_date, expire_days)
                VALUES (?, ?, ?, NOW(), ?)
            `, [orderId, telegramId, username, days]);

            return sendMessage(messageObj, `✅ @${username} berhasil ditambahkan ke daftar VIP selama ${days} hari.`);
        } catch (err) {
            console.error(err);
            return sendMessage(messageObj, "❌ Gagal menambahkan user. Cek input atau database.");
        }
    }

    if (command === "listvip") {
        const [rows] = await db.query(`
            SELECT order_id, username, vip_date, expire_days
            FROM vip_members
            WHERE status = 1
        `);
        
        if (rows.length === 0) {
            return sendMessage(messageObj, "Belum ada VIP aktif.");
        }
    
        let message = "📋 *Daftar VIP Aktif:*\n\n";
        const now = new Date();
    
        rows.forEach((row, i) => {
            const vipDate = new Date(row.vip_date);
            const expireDate = new Date(vipDate.getTime() + row.expire_days * 24 * 60 * 60 * 1000);
            const remainingMs = expireDate - now;
            const remainingDays = Math.max(0, Math.floor(remainingMs / (1000 * 60 * 60 * 24)));
        
            message += `${i + 1}. @${row.username} (Order: ${row.order_id}) - Sisa ${remainingDays} hari\n`;
        });
    
        return axiosInstance.post("sendMessage", {
            chat_id: messageObj.chat.id,
            text: message,
            parse_mode: "Markdown"
        });
    }

    if (command === "delvip" && parts.length === 2) {
        const orderId = parts[1];
        
        if (isNaN(orderId)) {
            return sendMessage(messageObj, "Format: /delvip {order_id}");
        }
    
        const [vip] = await db.query(`SELECT * FROM vip_members WHERE order_id = ?`, [orderId]);
        if (!vip) {
            return sendMessage(messageObj, `VIP dengan order ID ${orderId} tidak ditemukan.`);
        }
    
        await db.query(`DELETE FROM vip_members WHERE order_id = ?`, [orderId]);
    
        await logAction({
            type: "DELETE",
            username: vip.username,
            telegram_id: vip.telegram_id,
            order_id: vip.order_id,
            message: "VIP dihapus manual oleh admin via Telegram"
        });
        
        return sendMessage(messageObj, `VIP ${vip.username} berhasil dihapus.`);
    } 
    
    if (command === "id") {
        const code = (text) => `<code>${text}</code>`;
        const telegramId = messageObj.from.id;
    
        return axiosInstance.post("sendMessage", {
            chat_id: messageObj.chat.id,
            text: `🆔 Telegram ID kamu adalah: ${code(telegramId)}`,
            parse_mode: "HTML"
        });
    }

    if (command === "order" && parts.length === 3) {
        const orderId = parts[1];
        const inputUserId = parseInt(parts[2]);

        if (isNaN(inputUserId)) {
            return sendMessage(messageObj, "Format salah. Contoh: /order id_transaksi id_user(/user)");
        }

        try {
            const [rows] = await db.query(`SELECT * FROM payments WHERE transaction_id = ? AND verified = 0`, [orderId]);
            if (rows.length === 0) {
                return sendMessage(messageObj, `❌ Transaksi tidak ditemukan atau sudah diverifikasi. Hubungi /admin`);
            }

            const order = rows[0];

            // Check if donation is sufficient
            if (order.amount_raw < 10000) {
                return sendMessage(messageObj, `❌ Jumlah Transaksi tidak mencukupi. Minimal Transaksi Rp100.000. Hubungi /admin bila terjadi kesalahan`)
            }

            // Create invite link
            const expiration = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12 hours from now

            const inviteRes = await axiosInstance.post("createChatInviteLink", {
                chat_id: process.env.GROUP_ID, // Set this in your env
                name: `Order-${orderId}`,
                expiration_date: expiration,
                member_limit: 1,
                creates_join_request: false
            });

            const inviteLink = inviteRes.data.result.invite_link;

            // Add to VIP members (30 days)
            const [existing] = await db.query(
                "SELECT * FROM vip_members WHERE telegram_id = ? OR username = ?",
                [inputUserId, order.donator_name]
            );

            if (existing.length > 0) {
                // ✅ Update existing
                await db.query(`
                    UPDATE vip_members 
                    SET order_id = ?, expire_days = 30, vip_date = NOW(), status = 1 
                    WHERE telegram_id = ? OR username = ?
                `, [orderId, inputUserId, order.donator_name]);
            } else {
                // ✅ Insert new
                await db.query(`
                    INSERT INTO vip_members 
                    (order_id, telegram_id, username, join_date, vip_date, expire_days, status)
                    VALUES (?, ?, ?, NOW(), NOW(), 30, 1)
                `, [orderId, inputUserId, order.donator_name]);
            }

            // Mark as verified
            await db.query(`UPDATE payments SET verified = 1 WHERE transaction_id = ?`, [orderId]);

            await logAction({
                type: "VIP_ORDER",
                username: order.donator_name,
                telegram_id: inputUserId,
                order_id: orderId,
                message: `VIP ditambahkan oleh ${order.donator_name} via /order dengan invite link berlaku 12 jam.`
            });

            return sendMessage(messageObj, `✅ Transaksi diverifikasi!\n\n⚠Link Berlaku Selama 12 Jam semenjak Transaksi diverifikasi.\nBerikut link undangan grup:\n${inviteLink}`);
        } catch (err) {
            console.error(err);
            return sendMessage(messageObj, "❌ Gagal memproses order. Cek input atau database.");
        }
    }

    return sendMessage(messageObj, "❓ Perintah tidak dikenali.");
}

// Ambil info user dari channel (misalnya digunakan untuk /vip)
async function getUserInfoByUsername(username) {
    const res = await axiosInstance.get("getChatMember", {
        chat_id: process.env.GROUP_ID,
        user_id: `@${username}`
    });

    if (res.data.ok) return res.data.result.user;
    return null;
}

async function handleMemberUpdate(update) {
    const user = update.chat_member?.new_chat_member?.user;
    if (!user || !user.username) return;

    await logAction({
      type: "UPDATE",
      username: newUsername,
      telegram_id,
      order_id,
      message: `Username diperbarui dari @${oldUsername} ke @${newUsername}`
    });
    
    await db.query(`
        UPDATE vip_members SET username = ?
        WHERE telegram_id = ?
    `, [user.username, user.id]);
}

async function logAction({ type, username, telegram_id, order_id, message }) {
    await db.query(`
        INSERT INTO vip_logs (type, username, telegram_id, order_id, message)
        VALUES (?, ?, ?, ?, ?)
    `, [type, username, telegram_id, order_id, message]);
}

async function checkExpiredVIPs() {
    try {
        const [rows] = await db.query("SELECT * FROM vip_members WHERE status = 1");
        const now = new Date();

        for (const member of rows) {
            const vipDate = new Date(member.vip_date);
            const expireDate = new Date(vipDate.getTime() + member.expire_days * 24 * 60 * 60 * 1000);

            if (now >= expireDate) {
                try {
                    await axiosInstance.post("kickChatMember", {
                        chat_id: process.env.GROUP_ID,
                        user_id: member.telegram_id
                    });

                    await db.query(`
                        UPDATE vip_members 
                        SET status = 0, expire_days = 0 
                        WHERE id = ?
                    `, [member.id]);

                    await logAction({
                        type: "KICK",
                        username: member.username,
                        telegram_id: member.telegram_id,
                        order_id: member.order_id,
                        message: "VIP expired, user kicked & status set to inactive."
                    });

                    console.log(`✅ Kicked & marked inactive: @${member.username}`);
                } catch (kickErr) {
                    console.error(`❌ Gagal kick @${member.username}:`, kickErr.message);
                }
            }
        }
    } catch (err) {
        console.error("❌ Error checkExpiredVIPs:", err.message);
    }
}

async function sendReminders() {
    try {
        const [members] = await db.query(`
            SELECT * FROM vip_members 
            WHERE status = 1 AND reminded = 0
        `);

        const now = new Date();

        for (const member of members) {
            const vipDate = new Date(member.vip_date);
            const expireDate = new Date(vipDate.getTime() + member.expire_days * 24 * 60 * 60 * 1000);

            const remainingMs = expireDate - now;
            const remainingDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));

            if (remainingDays === 7) {
                // Send Telegram message
                await axiosInstance.post("sendMessage", {
                    chat_id: member.telegram_id,
                    text: `⚠️ Halo @${member.username}, VIP kamu akan berakhir dalam 7 hari.\nSilakan lakukan pembayaran untuk memperpanjang keanggotaan.`
                });

                // Mark as reminded
                await db.query("UPDATE vip_members SET reminded = 1 WHERE id = ?", [member.id]);

                console.log(`🔔 Reminder sent to @${member.username}`);
            }
        }
    } catch (err) {
        console.error("❌ Error in sendReminders:", err.message);
    }
}


async function checkVideoSchedules() {
  try {
        const [videos] = await db.query(
          `SELECT * FROM videos WHERE sent = FALSE AND scheduled_date <= NOW()`
    );

    for (const video of videos) {
      const videoPath = path.resolve("public", video.path);

            // Ensure file exists
      if (!fs.existsSync(videoPath)) {
        console.error(`❌ File not found: ${videoPath}`);
        continue;
      }

      formData.append("chat_id", process.env.GROUP_ID); // Replace with your channel
      formData.append("caption", `🎬 ${video.title}\n🆔 ${video.code}`);
      formData.append("video", fs.createReadStream(videoPath));

      try {
        await axiosInstance.post("sendVideo", formData, {
          headers: formData.getHeaders()
        });

        await db.query("UPDATE videos SET sent = TRUE WHERE id = ?", [video.id]);

        await logAction({
            type: "UPLOAD",
            username: "System",
            telegram_id: "System",
            order_id: "System",
            message: `Video ${video.title} berhasil diupload`
        })

        console.log(`✅ Sent video: ${video.title}`);
      } catch (err) {
        console.error(`❌ Failed to send ${video.title}:`, err.message);
      }
    }
  } catch (err) {
    console.error("❌ Error checking videos:", err.message);
    console.log(err);
  }
}

async function uploadNow(id) {
    try {
        const [rows] = await db.query("SELECT * FROM videos WHERE id = ?", [id]);
        if (rows.length === 0) throw new Error("Video not found"); 
    
        const video = rows[0];
        const videoPath = path.resolve("public", video.path);
    
        const formData = new FormData();
        formData.append("chat_id", process.env.GROUP_ID);
        formData.append("caption", `🎬 ${video.title}\n🆔 ${video.code}`);
        formData.append("video", fs.createReadStream(videoPath)); 
    
        await axiosInstance.post("sendVideo", formData, {
          headers: formData.getHeaders(),
        }); 
    
        // Optionally update sent status only if it's still false
        if (!video.sent) {
          await db.query("UPDATE videos SET sent = TRUE WHERE id = ?", [id]);
        }

        await logAction({
            type: "UPLOAD",
            username: "System",
            telegram_id: "System",
            order_id: "System",
            message: `Video ${video.title} berhasil diupload`
        })

        console.log(`✅ Sent video: ${video.title}`);
    } catch (err) {
        console.error(err);
        return sendMessage(messageObj, "❌ Gagal upload video manual: ", err);
    }
}

async function newVideoLog() {
    try {
        const [rows] = await db.query("SELECT * FROM videos WHERE sent = FALSE");

        for (const video of rows) {
            await logAction({
                type: "NEW_VIDEO",
                username: "System",
                telegram_id: "System",
                order_id: "System",
                message: `Video ${video.title} telah ditambahkan`
            });
        }
    } catch (err) {
        console.error("❌ Error newVideoLog:", err.message);
    }
}

async function saweriaMMS(data) {
    try {
        const { id, donator_name, donator_email, amount_raw, message, created_at } = data;
        console.log(data);

        if (!id || !donator_name || !donator_email || !amount_raw || !created_at) {
          throw new Error('Invalid payload');
        }

        const query = `
          INSERT INTO payments 
          (transaction_id, donator_name, donator_email, amount_raw, message, verified, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        
        await db.execute(query, [
          id,
          donator_name,
          donator_email,
          amount_raw,
          message || '',
          0,
          created_at
        ]);

        const formattedAmount = Number(amount_raw).toLocaleString('id-ID');
        const text = `🎉 *New Donation Received!*\nℹ ID: *${id}*\n⌚ Created At: **${created_at}\n👤 Name: *${donator_name}*\n📧 Email: *${donator_email}*\n💸 Amount: *Rp ${formattedAmount}*\n💬 Message: _${message || '-'}_`;

        await axiosInstance.post("sendMessage", {
          chat_id: process.env.ADMIN_ID,
          text,
          parse_mode: 'Markdown',
        });

        await logAction({
            type: "PAYMENT",
            username: `${donator_name}`,
            telegram_id: `${donator_email}`,
            order_id: `${id}`,
            message: `Donasi Masuk dari ${donator_name} sebesar Rp ${formattedAmount}`
        })

        console.log("✅ Donation sent to Telegram");
    } catch (err) {
        console.error("❌ Error in saweriaMMS:", err.message);
        throw err; // Propagate error to caller
    }
}

module.exports = { 
    handleMessage, 
    handleMemberUpdate, 
    checkExpiredVIPs, 
    logAction, 
    checkVideoSchedules,
    uploadNow, 
    newVideoLog, 
    saweriaMMS, 
    sendReminders };
