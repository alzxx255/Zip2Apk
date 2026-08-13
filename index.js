const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const config = require("./config");

const bot = new TelegramBot(config.TOKEN_BOT, { polling: true });
const sessions = new Map();
const antrianBuild = [];

// === Cek Admin ===
function isAdmin(userId) {
  const id = Number(userId);
  return id === config.OWNER_ID || id === config.ADMIN_ID;
}

// === Cek Wajib Join Channel ===
async function checkJoinChannel(userId) {
  try {
    for (const channel of config.JOIN_CHANNEL_WAJIB) {
      const member = await bot.getChatMember(channel, userId);
      if (!["member", "administrator", "creator"].includes(member.status)) return false;
    }
    return true;
  } catch {
    return true;
  }
}

// === PICIU BUILD DI GITHUB ACTIONS ===
async function triggerGitHubBuild(chatId, userId, zipPath, namaProyek) {
  try {
    const zipContent = fs.readFileSync(zipPath, { encoding: "base64" });

    await axios.post(
      `https://api.github.com/repos/${config.USERNAME_REPO}/${config.REPO_NAME}/dispatches`,
      {
        event_type: "build-apk",
        client_payload: {
          user_id: userId,
          chat_id: chatId,
          project_name: namaProyek,
          zip_base64: zipContent
        }
      },
      {
        headers: {
          "Authorization": `token ${config.TOKEN_GITHUB}`,
          "Accept": "application/vnd.github.v3+json"
        }
      }
    );
    return true;
  } catch (err) {
    console.error("GitHub Error:", err.response?.data || err.message);
    return false;
  }
}

// === /start ===
bot.onText(/\/start/, async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const nama = msg.from.first_name || "Pengguna";
  const username = msg.from.username ? `@${msg.from.username}` : "-";
  const role = isAdmin(userId) ? "Admin/Pemilik" : "Tamu";

  const sudahJoin = await checkJoinChannel(userId);
  if (!sudahJoin) {
    return bot.sendMessage(chatId, `⚠️ Kamu wajib join channel:\n\n${config.JOIN_CHANNEL_WAJIB.join("\n")}`);
  }

  const teks = `👋 HALO, ${nama}!

👤 PROFIL KAMU
├ Nama: ${nama}
├ Username: ${username}
├ ID: ${userId}
└ Role: ${role}

📊 STATISTIK BOT
├ Total Pengguna: ${config.TOTAL_USER}
├ GitHub Actions: ${config.GITHUB_STATUS}
└ Build Engine : ${config.BUILD_ENGINE}

⚙️ FITUR BUILD
├ 📦 ZipToApk  → Kirim ZIP Flutter jadi APK
├ 🌐 WebToApk  → Kirim link website jadi APK
├ 📋 Antrian    → Lihat daftar build
├ 🔄 Status     → Cek proses berjalan
├ 📖 Panduan    → Cara pakai
└ ⚠️ Laporkan Bug`;

  await bot.sendPhoto(chatId, config.START_FOTO, {
    caption: teks,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📦 ZipToApk", callback_data: "zip_to_apk" },
          { text: "🌐 WebToApk", callback_data: "web_to_apk" }
        ],
        [
          { text: "📋 Antrian Build", callback_data: "antrian_build" },
          { text: "🔄 Status Build", callback_data: "status_build" }
        ],
        [
          { text: "📖 Panduan", callback_data: "panduan" },
          { text: "⚠️ Laporkan Bug", callback_data: "lapor_bug" }
        ]
      ]
    }
  });

  try { await bot.sendMessage(config.LOG_CHANNEL, `📥 USER START\n👤 ${nama}\n🆔 ${userId}`); } catch {}
});

// === TOMBOL ===
bot.on("callback_query", async query => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  await bot.answerCallbackQuery(query.id);

  if (data === "zip_to_apk") {
    sessions.set(userId, { step: "kirim_zip" });
    return bot.sendMessage(chatId, "📦 <b>ZipToApk</b>\n\nKirim file ZIP proyek Flutter kamu sekarang 👇", { parse_mode: "HTML" });
  }

  if (data === "web_to_apk") {
    sessions.set(userId, { step: "kirim_url" });
    return bot.sendMessage(chatId, "🌐 <b>WebToApk</b>\n\nKirim alamat URL website 👇", { parse_mode: "HTML" });
  }

  if (data === "antrian_build") {
    if (antrianBuild.length === 0) {
      return bot.sendMessage(chatId, "📋 <b>Antrian Build</b>\n\n✅ Antrian kosong, silakan mulai build baru.", { parse_mode: "HTML" });
    }
    let daftar = "📋 <b>Daftar Antrian:</b>\n\n";
    antrianBuild.forEach((item, i) => {
      daftar += `${i+1}. ${item.nama}\n   Status: ${item.status}\n`;
    });
    return bot.sendMessage(chatId, daftar, { parse_mode: "HTML" });
  }

  if (data === "status_build") {
    return bot.sendMessage(chatId, "🔄 <b>Status Build</b>\n\n✅ Build Engine: Siap\n⏳ Tidak ada proses berjalan\n🔗 GitHub: Terhubung", { parse_mode: "HTML" });
  }

  if (data === "panduan") {
    return bot.sendMessage(chatId, "📖 <b>Panduan Penggunaan</b>\n\n1. 📦 ZipToApk → Kirim file ZIP proyek Flutter\n2. Tunggu proses build di GitHub (~3-5 menit)\n3. APK selesai → Dikirim otomatis ke Telegram\n\n⚠️ WebToApk → Segera hadir!", { parse_mode: "HTML" });
  }

  if (data === "lapor_bug") {
    sessions.set(userId, { step: "lapor_bug" });
    return bot.sendMessage(chatId, "⚠️ <b>Laporkan Bug</b>\n\nTulis masalah yang kamu temukan di bawah 👇", { parse_mode: "HTML" });
  }
});

// === TERIMA FILE ZIP & PROSES ===
bot.on("message", async msg => {
  if (!msg.from || !msg.chat) return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const session = sessions.get(userId);
  if (!session || msg.text?.startsWith("/")) return;

  try {
    // === Terima ZIP ===
    if (session.step === "kirim_zip") {
      if (!msg.document || !/\.zip$/i.test(msg.document.file_name || "")) {
        return bot.sendMessage(chatId, "❌ Harap kirim file dengan format .zip!");
      }

      const namaProyek = msg.document.file_name.replace(".zip", "");
      const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "build-"));
      const zipPath = path.join(workDir, "proyek.zip");

      await bot.downloadFile(msg.document.file_id, workDir).then(async file => {
        await fs.copyFile(file, zipPath);
      });

      antrianBuild.push({ nama: namaProyek, status: "🔄 Sedang diproses", userId });
      await bot.sendMessage(chatId, `✅ ZIP diterima!\n📦 Proyek: ${namaProyek}\n🔄 Mengirim ke GitHub untuk di-build...\n⏳ Estimasi: 3-5 menit`);

      const berhasil = await triggerGitHubBuild(chatId, userId, zipPath, namaProyek);
      
      if (berhasil) {
        await bot.sendMessage(chatId, "✅ Build dimulai di GitHub Actions!\n⏳ Tunggu sebentar, APK akan dikirim selesai.");
      } else {
        await bot.sendMessage(chatId, "❌ Gagal terhubung ke GitHub!\nCek TOKEN_GITHUB, USERNAME_REPO, dan REPO_NAME di config.js");
      }

      sessions.delete(userId);
      await fs.remove(workDir).catch(() => {});
      return;
    }

    // === Terima Laporan Bug ===
    if (session.step === "lapor_bug" && msg.text) {
      const laporan = msg.text.trim();
      try {
        await bot.sendMessage(config.LOG_CHANNEL, `⚠️ LAPORAN BUG\n\n👤 Dari: ${msg.from.first_name}\n🆔 ID: ${userId}\n\n📝 Isi:\n${laporan}`);
        await bot.sendMessage(chatId, "✅ Laporan terkirim! Terima kasih atas laporannya.");
      } catch {
        await bot.sendMessage(chatId, "⚠️ Laporan gagal dikirim.");
      }
      sessions.delete(userId);
      return;
    }

    // === WebToApk (belum siap) ===
    if (session.step === "kirim_url") {
      return bot.sendMessage(chatId, "🌐 WebToApk\n⚠️ Fitur sedang dalam pengembangan. Gunakan ZipToApk dulu ya!");
    }

  } catch (err) {
    console.error("Error:", err);
    await bot.sendMessage(chatId, `❌ Terjadi error: ${err.message}`);
    sessions.delete(userId);
  }
});

// === Error Polling ===
bot.on("polling_error", (err) => console.log(err));

console.log("✅ Bot Telegram Aktif! Siap menerima file ZIP untuk di-build!");