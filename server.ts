import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Client, GatewayIntentBits, PermissionFlagsBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, Role, Events, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, GuildMember, ButtonBuilder, ButtonStyle, ComponentType } from "discord.js";
import cors from "cors";
import { initializeApp } from "firebase/app";
import { getFirestore, initializeFirestore, doc, getDoc, setDoc, updateDoc, getDocFromServer, collection, query, where, getDocs, deleteDoc, addDoc, limit, increment } from "firebase/firestore";
import { readFileSync, existsSync } from "fs";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

let firebaseConfig = {};
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (existsSync(configPath)) {
    firebaseConfig = JSON.parse(readFileSync(configPath, "utf8"));
  }
} catch (err) {
  console.error("⚠️ Failed to read firebase-applet-config.json:", err);
}

const app = express();
const PORT = 3000;

// Firebase Initialization
let firebaseApp: any;
let db: any;

try {
  if (Object.keys(firebaseConfig).length > 0) {
    firebaseApp = initializeApp(firebaseConfig);
    // Use initializeFirestore with force long polling to prevent RST_STREAM / connectivity issues on Node.js/Cloud Run
    db = initializeFirestore(firebaseApp, {
      experimentalForceLongPolling: true,
    }, (firebaseConfig as any).firestoreDatabaseId);
  }
} catch (err) {
  console.error("⚠️ Firebase initialization failed:", err);
}

async function testConnection() {
  if (!db) {
    console.warn("⚠️ Firestore database not initialized. Skipping connection test.");
    return;
  }
  try {
    const testDoc = doc(db, "guilds", "connection-test");
    await getDocFromServer(testDoc);
    console.log("✅ Firestore connection verified.");
  } catch (error: any) {
    if (error.message?.includes("the client is offline")) {
      console.error("❌ Firestore Connection Error: The client is offline.");
    } else {
      console.error("⚠️ Firestore Connection Test Warning:", error.message);
    }
  }
}

// Discord Client Initialization
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
});

const tempCooldowns = new Set<string>();

// Token Exchange Logic
async function startTokenExchange(channel: any, userId: string) {
  const TOKEN_PRICE = 5000; // 5000 credits = 1 token
  
  const embed = new EmbedBuilder()
    .setTitle("🪙 متجر استبدال العملات")
    .setDescription(`مرحباً <@${userId}>!\n\nيرجى اختيار العملية التي تريد القيام بها:\n\n` +
      `1️⃣ **شراء توكنات** (استبدال الكريدت بتوكنات)\n` +
      `2️⃣ **سحب كريدت** (استبدال التوكنات بكريدت - يدوي)\n\n` +
      `اكتب رقم العملية (1 أو 2) للمتابعة.`)
    .setColor("#FFD700")
    .setFooter({ text: "نظام التحويل" });

  await channel.send({ embeds: [embed] });

  const choiceCollector = channel.createMessageCollector({
    filter: (m: any) => m.author.id === userId,
    time: 60000,
    max: 1
  });

  choiceCollector.on("collect", async (m: any) => {
    const choice = m.content.trim();
    
    if (choice === "1") {
      // Automatic Token Purchase
      await channel.send("💰 **عملية شراء توكنات**\nيرجى كتابة **عدد التوكنات** التي تريد شراءها الآن (مثال: `5`).");
      
      const purchaseCollector = channel.createMessageCollector({
        filter: (pm: any) => pm.author.id === userId,
        time: 60000,
        max: 1
      });

      purchaseCollector.on("collect", async (pm: any) => {
        const amount = parseInt(pm.content.replace(/\D/g, ""));
        if (isNaN(amount) || amount <= 0) {
          await channel.send("❌ يرجى إرسال رقم صحيح.");
          return startTokenExchange(channel, userId);
        }

        const guildDoc = await getDoc(doc(db, "guilds", channel.guild.id));
        const guildData = guildDoc.data();
        const paymentAccount = guildData?.exchangeAccount || guildData?.paymentAccount || "";
        const tokenBuyPrice = guildData?.tokenBuyPrice || TOKEN_PRICE;

        const totalPrice = amount * tokenBuyPrice;

        const payEmbed = new EmbedBuilder()
          .setTitle("💳 طلب دفع لتنفيذ التحويل")
          .setDescription(`لشراء **${amount}** توكن، يرجى تحويل **${totalPrice}** كريدت إلى الحساب التالي:\n\n\`c ${paymentAccount} ${totalPrice}\`\n\n⚠️ لديك 3 دقائق لإتمام الدفع.`)
          .setColor("#5865F2");

        await channel.send({ content: `<@${userId}>`, embeds: [payEmbed] });

        // Payment Monitoring
        const paymentCollector = channel.createMessageCollector({
          filter: (ppm: any) => ppm.author.id === "282859044593598464", // Probot
          time: 180000
        });

        paymentCollector.on("collect", async (ppm: any) => {
          const content = ppm.content || "";
          const embed = ppm.embeds[0];
          const fieldsContent = embed?.fields?.map((f: any) => f.name + " " + f.value).join(" ") || "";
          const pContent = (content + " " + (embed?.title || "") + " " + (embed?.description || "") + " " + (embed?.footer?.text || "") + " " + fieldsContent).toLowerCase();

          const isTransfer = pContent.includes("قام بتحويل") || pContent.includes("has transferred") || pContent.includes("حول");
          if (!isTransfer) return;

          const matches = pContent.match(/(\d+)/g) || [];
          const foundAmount = matches.map(Number).find(amt => amt >= totalPrice * 0.94) || 0;
          
          const isUserMentioned = pContent.includes(userId) || pContent.includes(pm.author.id) || pContent.includes(pm.author.username.toLowerCase());
          const targetAccountId = paymentAccount.replace(/\D/g, "");
          const isAccountMentioned = targetAccountId ? pContent.includes(targetAccountId) : pContent.includes(paymentAccount.toLowerCase());

          if (isUserMentioned && isAccountMentioned && foundAmount > 0) {
            paymentCollector.stop("paid");
          }
        });

        paymentCollector.on("end", async (collected: any, reason: string) => {
          if (reason === "paid") {
            const profile = await getUserProfile(userId);
            await updateDoc(doc(db, "users", userId), {
              tokens: (profile.tokens || 0) + amount
            });
            await channel.send(`🎊 تمت العملية بنجاح! تم إضافة **${amount}** توكن إلى رصيدك يا <@${userId}>.`);
            setTimeout(() => channel.delete().catch(() => {}), 15000);
          } else {
            await channel.send("⏳ انتهى الوقت أو فشلت العملية. سيتم إغلاق الغرفة.");
            setTimeout(() => channel.delete().catch(() => {}), 10000);
          }
        });
      });
    } else if (choice === "2") {
      // Manual Credit Withdrawal Request
      await channel.send("📤 **عملية سحب كريدت**\nيرجى كتابة **عدد التوكنات** التي تريد استبدالها بكريدت (مثال: `10`).\nسيتم إرسال طلب للمسؤول للموافقة والتحويل لك يدوياً.");
      
      const withdrawCollector = channel.createMessageCollector({
        filter: (wm: any) => wm.author.id === userId,
        time: 60000,
        max: 1
      });

      withdrawCollector.on("collect", async (wm: any) => {
        const amount = parseInt(wm.content.replace(/\D/g, ""));
        const profile = await getUserProfile(userId);
        
        if (isNaN(amount) || amount <= 0) {
          await channel.send("❌ يرجى إرسال رقم صحيح.");
          return startTokenExchange(channel, userId);
        }

        if (profile.tokens < amount) {
          await channel.send(`❌ رصيدك غير كافٍ. لديك **${profile.tokens}** توكن فقط.`);
          return startTokenExchange(channel, userId);
        }

        const guildDoc = await getDoc(doc(db, "guilds", channel.guild.id));
        const guildData = guildDoc.data();
        const tokenBuyPrice = guildData?.tokenBuyPrice || TOKEN_PRICE;
        const creditsToReceive = amount * tokenBuyPrice * 0.9; // 10% tax/fee or adjusted rate for manual
        
        // Fetch exchange admin from config
        const exchangeAdminId = guildData?.exchangeAdminId;
        
        let mentionString = "";
        if (exchangeAdminId) {
          mentionString = `<@${exchangeAdminId}>`;
        } else {
          // Fallback to notifying all admins if no specific admin is set
          const admins = channel.guild.members.cache.filter((m: any) => m.permissions.has(PermissionFlagsBits.Administrator) && !m.user.bot);
          mentionString = admins.map((m: any) => `<@${m.id}>`).join(" ");
        }

        const requestEmbed = new EmbedBuilder()
          .setTitle("🚩 طلب سحب كريدت جديد")
          .setDescription(`قام المستخدم <@${userId}> بطلب سحب عملات.\n\n` +
            `🔹 **عدد التوكنات للتخصم:** ${amount}\n` +
            `🔸 **الكريدت المتوقع استلامه:** ${creditsToReceive}\n\n` +
            `يرجى التواصل مع العضو وتأكيد العملية ثم خصم التوكنات يدوياً باستخدام \`/remove-tokens\`.`)
          .setColor("#E74C3C")
          .setTimestamp();

        await channel.send({ content: `🔔 تم إرسال طلبك للمسؤول المسؤول: ${mentionString}`, embeds: [requestEmbed] });
        await channel.send("سيتم إغلاق هذه الغرفة الآن، يرجى انتظار تواصل الإدارة معك.");
        setTimeout(() => channel.delete().catch(() => {}), 20000);
      });
    } else {
      await channel.send("❌ اختيار غير صحيح. يرجى البدء من جديد.");
      setTimeout(() => channel.delete().catch(() => {}), 5000);
    }
  });
}

// Global Status Store
let botStatus = {
  loggedIn: false,
  tag: "Not logged in",
  guilds: 0,
  lastError: null as string | null,
  intentsRequested: ["Guilds", "GuildMessages", "MessageContent", "GuildMembers", "GuildPresences"],
};

client.on("debug", info => {
  if (info.includes("Heartbeat") || info.includes("Latency")) return;
  console.log(`[Discord Debug] ${info}`);
});

process.on("unhandledRejection", (error: any) => {
  console.error("❌ Unhandled promise rejection:", error);
  botStatus.lastError = error?.message || "Unknown rejection";
});

process.on("uncaughtException", (error: any) => {
  console.error("❌ Uncaught exception:", error);
  botStatus.lastError = error?.message || "Unknown exception";
});

const DISCORD_TOKEN_RAW = process.env.DISCORD_TOKEN;
let DISCORD_TOKEN = DISCORD_TOKEN_RAW?.trim();
// Clean token from any quotes, spaces, or prefixes aggressively
if (DISCORD_TOKEN) {
  DISCORD_TOKEN = DISCORD_TOKEN.replace(/[\u200B-\u200D\uFEFF]/g, ""); // Remove zero-width spaces
  DISCORD_TOKEN = DISCORD_TOKEN.replace(/^["']|["']$/g, "").trim();
  if (DISCORD_TOKEN.startsWith("Bot ")) DISCORD_TOKEN = DISCORD_TOKEN.substring(4).trim();
  if (DISCORD_TOKEN.startsWith("Token ")) DISCORD_TOKEN = DISCORD_TOKEN.substring(6).trim();
}

const CLIENT_ID = (process.env.VITE_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || process.env.APP_ID)?.trim();

// Command Registration
const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("إعداد الرتب المسموح للمستخدمين إضافتها أو نزعها")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName("roles")
        .setDescription("منشن الرتب أو ضع الأيديات مفصولة بمسافة")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("اختار-رتب")
    .setDescription("اختيار رتبة من الرتب المتاحة في السيرفر"),
  new SlashCommandBuilder()
    .setName("admin-config")
    .setDescription("إعداد سعر الرتب المخصصة وحساب الدفع")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(option => option.setName("price").setDescription("سعر الرتبة بالكريدت").setRequired(true))
    .addIntegerOption(option => option.setName("token-price").setDescription("سعر الرتبة بالتوكنات (التفاعل)").setRequired(true))
    .addStringOption(option => option.setName("account").setDescription("أيدي حساب الاستلام").setRequired(true))
    .addChannelOption(option => option.setName("channel").setDescription("غرفة مراقبة الدفع").setRequired(true)),
  new SlashCommandBuilder()
    .setName("exchange-config")
    .setDescription("إعداد نظام تبادل التوكنات والكريدت")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option => option.setName("payment-account").setDescription("أيدي حساب استلام الكريدت").setRequired(true))
    .addIntegerOption(option => option.setName("token-buy-price").setDescription("سعر شراء التوكن الواحد بالكريدت").setRequired(true))
    .addUserOption(option => option.setName("admin-mention").setDescription("العضو الذي سيتم منشنته عند طلب سحب الكريدت").setRequired(true)),
  new SlashCommandBuilder()
    .setName("xo")
    .setDescription("لعب لعبة إكس-أو (XO) وتحدي الأصدقاء أو البوت")
    .addUserOption(option => option.setName("opponent").setDescription("العضو المراد اللعب ضده (اتركه فارغاً للعب ضد البوت)").setRequired(false)),
  new SlashCommandBuilder()
    .setName("روليت")
    .setDescription("العب لعبة الروليت (الكلاسيكية بالألوان أو الروسية لربح التوكنز)")
    .addIntegerOption(option => option.setName("bet").setDescription("عدد التوكنات التي تريد المراهنة بها (اختياري)").setRequired(false)),
  new SlashCommandBuilder()
    .setName("مافيا")
    .setDescription("بدء سهرة المافيا التفاعلية (3 لـ 8 لاعبين أو مع بوتات القرية)"),
  new SlashCommandBuilder()
    .setName("كاذب")
    .setDescription("بدء سهرة 'من الكاذب؟' التفاعلية الشيقة لشغل العقل بالشك والتحقيق (3 لـ 20 لاعب)"),
  new SlashCommandBuilder()
    .setName("liar")
    .setDescription("Start the interactive 'Who is the Liar?' game (3 to 20 players)"),
  new SlashCommandBuilder()
    .setName("العاب")
    .setDescription("عرض قائمة الألعاب السيرفر المتوفرة وبدء أي منها"),
  new SlashCommandBuilder()
    .setName("games")
    .setDescription("Show the list of available server games and start them"),
  new SlashCommandBuilder()
    .setName("دول-عربية")
    .setDescription("إنشاء وتجهيز رتب جميع الدول العربية بأعلامها وأسمائها تلقائياً في السيرفر")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addBooleanOption(option =>
      option.setName("auto-setup")
        .setDescription("إضافة الرتب تلقائياً لقائمة رتب الأعضاء المسموح بها في /اختار-رتب")
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName("style")
        .setDescription("شكل وتنسيق اسم الرتبة مع العلم")
        .setRequired(false)
        .addChoices(
          { name: "🇸🇦 السعودية (علم + مسافة + الاسم - الافتراضي)", value: "space" },
          { name: "🇸🇦 ٠ السعودية (علم + نقطة فاصلة + الاسم)", value: "dot" },
          { name: "🇸🇦 | السعودية (علم + خط فاصل + الاسم)", value: "pipe" },
          { name: "🇸🇦 - السعودية (علم + شرطة + الاسم)", value: "dash" },
        )
    ),
  new SlashCommandBuilder()
    .setName("arab-roles")
    .setDescription("Create and setup all Arab country roles with flag emojis automatically")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addBooleanOption(option =>
      option.setName("auto-setup")
        .setDescription("Auto-add to allowed roles list in /اختار-رتب")
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName("style")
        .setDescription("Role name style formatting")
        .setRequired(false)
        .addChoices(
          { name: "🇸🇦 Saudi Arabia / السعودية (Flag + Name)", value: "space" },
          { name: "🇸🇦 ٠ السعودية (Flag + Dot + Name)", value: "dot" },
          { name: "🇸🇦 | السعودية (Flag + Pipe + Name)", value: "pipe" },
          { name: "🇸🇦 - السعودية (Flag + Dash + Name)", value: "dash" },
        )
    ),
].map(command => command.toJSON());

async function registerCommands(guildId?: string, clear: boolean = false) {
  if (!DISCORD_TOKEN || !CLIENT_ID) {
    console.error("❌ CLIENT_ID or DISCORD_TOKEN is missing. Cannot register commands.");
    return;
  }
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  try {
    if (guildId) {
      // Clear guild commands if requested, otherwise register
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: clear ? [] : commands });
      if (!clear) console.log(`✅ Registered commands for guild ${guildId}`);
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log(`✅ Registered global commands`);
    }
  } catch (error: any) {
    console.error(`❌ Error ${clear ? "clearing" : "registering"} commands:`, error.message);
  }
}

enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null, // Boit doesn't have a Firebase user ID in this context
      email: null,
      emailVerified: null,
      isAnonymous: null,
    },
    operationType,
    path
  };
  const jsonError = JSON.stringify(errInfo);
  console.error("Firestore Error: ", jsonError);
  throw new Error(jsonError);
}

// Bot Logic Helpers
async function getGuildConfig(guildId: string) {
  const pathForGet = `guilds/${guildId}`;
  try {
    const docRef = doc(db, "guilds", guildId);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data().allowedRoleIds as string[] : [];
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, pathForGet);
    return [];
  }
}

async function setGuildConfig(guildId: string, roleIds: string[]) {
  const pathForWrite = `guilds/${guildId}`;
  try {
    const docRef = doc(db, "guilds", guildId);
    await setDoc(docRef, { allowedRoleIds: roleIds });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, pathForWrite);
  }
}

async function getUserProfile(userId: string) {
  const pathForGet = `users/${userId}`;
  try {
    const docRef = doc(db, "users", userId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        lastActionAt: data.lastActionAt ? new Date(data.lastActionAt).getTime() : 0,
        tokens: data.tokens || 0,
        lastTokenAt: data.lastTokenAt ? new Date(data.lastTokenAt).getTime() : 0,
        lastRoleCreatedAt: data.lastRoleCreatedAt ? new Date(data.lastRoleCreatedAt).getTime() : 0,
        salesCount: data.salesCount || 0
      };
    }
    return { lastActionAt: 0, tokens: 0, lastTokenAt: 0, lastRoleCreatedAt: 0, salesCount: 0 };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, pathForGet);
    return { lastActionAt: 0, tokens: 0, lastTokenAt: 0, lastRoleCreatedAt: 0, salesCount: 0 };
  }
}

async function handleRolePurchase(listing: any, message: any, userId: string, guildId: string) {
  // Verify role still exists and seller still has it
  const role = message.guild!.roles.cache.get(listing.roleId);
  if (!role) {
    // Cleanup dead listing
    await updateDoc(doc(db, "marketplace", listing.listingId), { status: "canceled" });
    return message.reply("❌ هذه الرتبة لم تعد موجودة في السيرفر.");
  }

  const sellerMember = await message.guild!.members.fetch(listing.sellerId).catch(() => null);
  if (!sellerMember || !sellerMember.roles.cache.has(role.id)) {
    await updateDoc(doc(db, "marketplace", listing.listingId), { status: "canceled" });
    return message.reply("❌ البائع لم يعد يمتلك هذه الرتبة.");
  }

  // Proceed to Private Buying Room
  const buyChannel = await message.guild!.channels.create({
    name: `شراء-${role.name}`,
    type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: message.guild!.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      { id: client.user!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ],
  });

  const openMsg = await message.reply(`✅ تم فتح غرفة إتمام الشراء: ${buyChannel} <@${userId}>`);
  setTimeout(() => openMsg.delete().catch(() => {}), 30000);

  const seller = await client.users.fetch(listing.sellerId).catch(() => null);
  const buyEmbed = new EmbedBuilder()
    .setTitle("🛒 إتمام عملية الشراء")
    .setDescription(`مرحباً <@${userId}>، أنت الآن بصدد شراء رتبة **${role.name}** من البائع <@${listing.sellerId}>.\n\n` + 
      `💰 **السعر:** \`${listing.price}\` ${listing.currency === "tokens" ? "توكن" : "كريدت"}\n` +
      `👤 **البائع:** ${seller?.tag}\n` +
      `🏷️ **الرتبة:** <@&${role.id}>`)
    .setColor("#2ECC71");

  await buyChannel.send({ content: `🔔 <@${userId}>`, embeds: [buyEmbed] });

  if (listing.currency === "tokens") {
    const buyerProfile = await getUserProfile(userId);
    const tax = Math.ceil(listing.price * 0.05);
    const totalRequired = listing.price; // Seller gets price - tax

    if (buyerProfile.tokens < totalRequired) {
      await buyChannel.send(`❌ رصيدك من التوكنات غير كافٍ. تحتاج إلى \`${totalRequired}\` توكن.`);
      setTimeout(() => buyChannel.delete().catch(() => {}), 10000);
      return;
    }

    await buyChannel.send(`🏧 هل أنت متأكد من شراء الرتبة بـ \`${totalRequired}\` توكن؟ (اكتب **نعم** للتأكيد)`);
    
    const confirmFilter = (cm: any) => cm.author.id === userId && cm.content === "نعم";
    const confirmCollector = buyChannel.createMessageCollector({ filter: confirmFilter, max: 1, time: 30000 });

    confirmCollector.on("collect", async () => {
      // Deduct from buyer
      const userRef = doc(db, "users", userId);
      await setDoc(userRef, { tokens: buyerProfile.tokens - totalRequired }, { merge: true });
      
      const sellerPrice = listing.price - tax;
      // Add to seller
      const sellerProfile = await getUserProfile(listing.sellerId);
      const sellerRef = doc(db, "users", listing.sellerId);
      await setDoc(sellerRef, { tokens: sellerProfile.tokens + sellerPrice }, { merge: true });

      // Transfer Role
      await sellerMember.roles.remove(role).catch(() => {});
      await message.member?.roles.add(role).catch(() => {});

      await setDoc(doc(db, "custom_roles", role.id), { creatorId: userId }, { merge: true });
      await updateDoc(doc(db, "marketplace", listing.listingId), { status: "sold" });
      await updateSalesCount(listing.sellerId);

      await buyChannel.send(`🎊 مبروك! تمت عملية الشراء بنجاح.\nتم خصم ${totalRequired} توكن منك، وتم تسليم البائع ${sellerPrice} توكن (بعد ضريبة 5%).\nالرتبة الآن ملكك!`);
      setTimeout(() => buyChannel.delete().catch(() => {}), 15000);
    });
  } else {
    // Credit Payment
    const guildData = (await getDoc(doc(db, "guilds", guildId))).data();
    if (!guildData?.paymentChannelId) {
      return buyChannel.send("❌ نظام الدفع بالكريدت غير مفعل في هذا السيرفر.");
    }

    await buyChannel.send(`✨ إتمام الدفع بالكريدت:\n\n🔹 **اذهب إلى:** <#${guildData.paymentChannelId}>\n💰 **حول مبلغ:** \`${listing.price}\`\n👤 **إلى:** <@${listing.sellerId}>\n\nالبوت يراقب العملية... <@${userId}>`);

    const paymentChannel = message.guild!.channels.cache.get(guildData.paymentChannelId);
    if (paymentChannel?.type === ChannelType.GuildText) {
      const paymentCollector = paymentChannel.createMessageCollector({ 
        filter: (pm) => pm.author.bot, 
        time: 600000 
      });

      paymentCollector.on("collect", async (pm) => {
        const embed = pm.embeds[0];
        const fieldsContent = embed?.fields?.map(f => f.name + " " + f.value).join(" ") || "";
        const pContent = (pm.content + " " + (embed?.title || "") + " " + (embed?.description || "") + " " + (embed?.footer?.text || "") + " " + fieldsContent).toLowerCase();
        
        console.log(`[PaymentDebug] Marketplace - From: ${pm.author.tag}, Content matches transfer?`);

        const isTransfer = pContent.includes("قام بتحويل") || 
                          pContent.includes("has transferred") || 
                          pContent.includes("transferred") ||
                          pContent.includes("حول");
        
        if (!isTransfer) return;

        // Probot fix: sometimes mentions are in content/embed with raw IDs or names
        const matches = pContent.match(/(\d+)/g) || [];
        const foundAmount = matches.map(Number).find(amt => amt >= listing.price * 0.94) || 0;
        
        const isUserMentioned = pContent.includes(userId) || 
                               pContent.includes(message.author.id) || 
                               pContent.includes(message.author.username.toLowerCase()) || 
                               pContent.includes(message.member?.displayName.toLowerCase() || "");
        
        const sellerId = listing.sellerId;
        const isSellerMentioned = pContent.includes(sellerId) || 
                                 pContent.includes(sellerMember.user.username.toLowerCase()) || 
                                 pContent.includes(sellerMember.displayName.toLowerCase());

        if (isUserMentioned && isSellerMentioned && foundAmount > 0) {
          console.log(`[PaymentSuccess] Marketplace - Verified payment of ${foundAmount} from ${userId} to ${sellerId}`);
          paymentCollector.stop("paid");
        }
      });

      paymentCollector.on("end", async (collected, reason) => {
        if (reason === "paid") {
          await sellerMember.roles.remove(role).catch(err => console.error("Failed to remove role from seller:", err));
          await message.member?.roles.add(role).catch(async err => {
            console.error("Failed to add role to buyer:", err);
            await buyChannel.send(`❌ فشل في تسليمك الرتبة تلقائياً. تأكد من أن رتبة البوت أعلى من الرتبة المشتراة. يرجى التواصل مع الإدارة.`).catch(() => {});
          });

          await setDoc(doc(db, "custom_roles", role.id), { creatorId: userId }, { merge: true });
          await updateDoc(doc(db, "marketplace", listing.listingId), { status: "sold" });
          await updateSalesCount(listing.sellerId);

          await buyChannel.send(`🎊 تمت العملية بنجاح! الرتبة الآن ملكك يا <@${userId}>.`);
          setTimeout(() => buyChannel.delete().catch(() => {}), 15000);
        } else {
          await buyChannel.send("⏳ فشل الدفع أو انتهى الوقت. سيتم إلغاء العملية.");
          setTimeout(() => buyChannel.delete().catch(() => {}), 5000);
        }
      });
    } else {
      await buyChannel.send("❌ نظام الدفع (غرفة الدفع) غير متوفر.");
    }
  }
}

async function updateSalesCount(userId: string) {
  const profile = await getUserProfile(userId);
  try {
    const docRef = doc(db, "users", userId);
    await setDoc(docRef, { salesCount: profile.salesCount + 1 }, { merge: true });
  } catch (error) {
    console.error("Error updating sales count:", error);
  }
}

interface MarketplaceListing {
  listingId: string;
  roleId: string;
  roleName: string;
  sellerId: string;
  price: number;
  currency: "credit" | "tokens";
  status: "active" | "sold" | "canceled";
  createdAt: string;
}

const BAD_WORDS = ["شتيمة", "كلب", "حمار", "عنصري", "زقة", "غبي", "وسخ"]; 

function getReputationStars(salesCount: number) {
  const stars = Math.min(5, Math.floor(salesCount / 5));
  return "⭐".repeat(stars || 1) + ` ${salesCount} Sales`;
}

async function getActiveListings() {
  const q = query(collection(db, "marketplace"), where("status", "==", "active"), limit(25));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ listingId: d.id, ...d.data() } as MarketplaceListing));
}

async function getUserActiveListingsCount(userId: string) {
  const q = query(collection(db, "marketplace"), 
    where("sellerId", "==", userId), 
    where("status", "==", "active")
  );
  const snap = await getDocs(q);
  return snap.size;
}

async function recordTokensGranted(amount: number = 1) {
  if (!db || amount <= 0) return;
  try {
    const statsRef = doc(db, "stats", "token_economy");
    await setDoc(statsRef, {
      totalGranted: increment(amount),
      lastGrantedAt: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.error("Error recording tokens granted:", err);
  }
}

async function recordTokensSpentOnRole(amount: number) {
  if (!db || amount <= 0) return;
  try {
    const statsRef = doc(db, "stats", "token_economy");
    await setDoc(statsRef, {
      totalSpentOnRoles: increment(amount),
      rolesCreatedWithTokensCount: increment(1),
      lastSpentAt: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.error("Error recording tokens spent on role:", err);
  }
}

async function getTokenEconomyStats() {
  if (!db) {
    return {
      totalGranted: 0,
      totalSpentOnRoles: 0,
      rolesCreatedWithTokensCount: 0,
      circulatingTokens: 0,
      totalUsersWithTokens: 0,
      lastGrantedAt: null,
      lastSpentAt: null
    };
  }
  try {
    const statsDoc = await getDoc(doc(db, "stats", "token_economy")).catch(() => null);
    const statsData = statsDoc?.exists() ? statsDoc.data() : {};
    let totalGranted = Number(statsData.totalGranted || 0);
    let totalSpentOnRoles = Number(statsData.totalSpentOnRoles || 0);
    let rolesCreatedWithTokensCount = Number(statsData.rolesCreatedWithTokensCount || 0);

    // Sum circulating tokens across users in Firestore
    let circulatingTokens = 0;
    let totalUsersWithTokens = 0;
    try {
      const usersSnap = await getDocs(collection(db, "users"));
      usersSnap.forEach(d => {
        const uTokens = Number(d.data().tokens || 0);
        if (uTokens > 0) {
          circulatingTokens += uTokens;
          totalUsersWithTokens++;
        }
      });
      // If totalGranted was never set or is lower than (circulating + spent), baseline it automatically
      if (totalGranted < (circulatingTokens + totalSpentOnRoles)) {
        totalGranted = circulatingTokens + totalSpentOnRoles;
      }
    } catch (e) {
      console.warn("Could not aggregate users tokens:", e);
    }

    return {
      totalGranted,
      totalSpentOnRoles,
      rolesCreatedWithTokensCount,
      circulatingTokens,
      totalUsersWithTokens,
      lastGrantedAt: statsData.lastGrantedAt || null,
      lastSpentAt: statsData.lastSpentAt || null
    };
  } catch (err) {
    console.error("Error in getTokenEconomyStats:", err);
    return {
      totalGranted: 0,
      totalSpentOnRoles: 0,
      rolesCreatedWithTokensCount: 0,
      circulatingTokens: 0,
      totalUsersWithTokens: 0,
      lastGrantedAt: null,
      lastSpentAt: null
    };
  }
}

async function handleActivityTokens(userId: string) {
  const profile = await getUserProfile(userId);
  const now = Date.now();
  
  // 1 minute cooldown between earning tokens to prevent spam
  if (now - profile.lastTokenAt < 60000) return profile.tokens;

  const newTokens = profile.tokens + 1;
  const pathForWrite = `users/${userId}`;
  try {
    const docRef = doc(db, "users", userId);
    await setDoc(docRef, { 
      tokens: newTokens,
      lastTokenAt: new Date().toISOString(),
      lastActionAt: profile.lastActionAt ? new Date(profile.lastActionAt).toISOString() : new Date(0).toISOString(),
      lastRoleCreatedAt: profile.lastRoleCreatedAt ? new Date(profile.lastRoleCreatedAt).toISOString() : new Date(0).toISOString(),
      salesCount: profile.salesCount || 0
    }, { merge: true });

    // Track granted token globally
    await recordTokensGranted(1);

    return newTokens;
  } catch (error) {
    console.error("Error updating tokens:", error);
    return profile.tokens;
  }
}

async function setUserCooldown(userId: string) {
  const pathForWrite = `users/${userId}`;
  try {
    const docRef = doc(db, "users", userId);
    await setDoc(docRef, { lastActionAt: new Date().toISOString() });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, pathForWrite);
  }
}

const PERMISSIONS_LIST = [
  { name: "إرفاق ملفات", flag: PermissionFlagsBits.AttachFiles, icon: "📁", premium: false },
  { name: "معاينة الروابط", flag: PermissionFlagsBits.EmbedLinks, icon: "🔗", premium: false },
  { name: "إيموجي خارجي", flag: PermissionFlagsBits.UseExternalEmojis, icon: "✨", premium: false },
  { name: "بث مباشر (Go Live)", flag: PermissionFlagsBits.Stream, icon: "📺", premium: false },
  { name: "تغيير اللقب", flag: PermissionFlagsBits.ChangeNickname, icon: "🏷️", premium: true },
  { name: "إنشاء مواضيع (Threads)", flag: PermissionFlagsBits.CreatePublicThreads, icon: "🧵", premium: true },
  { name: "صوت أعلى (Priority)", flag: PermissionFlagsBits.PrioritySpeaker, icon: "🎙️", premium: true },
  { name: "ستيكرز خارجية", flag: PermissionFlagsBits.UseExternalStickers, icon: "🎭", premium: true },
  { name: "استخدام صوت النشاط", flag: PermissionFlagsBits.UseVAD, icon: "🎙️", premium: true },
];

const COLOR_MAP: Record<string, string> = {
  "أحمر": "#FF0000",
  "ازرق": "#0000FF",
  "أزرق": "#0000FF",
  "اخضر": "#00FF00",
  "أخضر": "#00FF00",
  "اصفر": "#FFFF00",
  "أصفر": "#FFFF00",
  "اسود": "#000000",
  "أسود": "#000000",
  "ابيض": "#FFFFFF",
  "أبيض": "#FFFFFF",
  "بنفسجي": "#800080",
  "برتقالي": "#FFA500",
  "وردي": "#FFC0CB",
  "بني": "#A52A2A",
  "رصاصي": "#808080",
  "رمادي": "#808080",
  "red": "#FF0000",
  "blue": "#0000FF",
  "green": "#00FF00",
  "yellow": "#FFFF00",
  "black": "#000000",
  "white": "#FFFFFF",
  "purple": "#800080",
  "orange": "#FFA500",
  "pink": "#FFC0CB",
  "brown": "#A52A2A",
  "gray": "#808080",
  "grey": "#808080"
};

async function startRoleCreation(channel: any, userId: string, originalMessage: any, extraPermissions: bigint[] = []) {
  try {
    await channel.send(`✅ تم تأكيد العملية بنجاح يا <@${userId}>! الآن يرجى كتابة **اسم الرتبة** التي تريدها.`);
    
    const filter = (m: any) => m.author.id === userId;
    
    // Step 1: Get Role Name
    const nameResponses = await channel.awaitMessages({ filter, max: 1, time: 60000 });
    if (!nameResponses.size) {
      await channel.send("⏳ انتهى وقت اختيار اسم الرتبة. سيتم إغلاق الغرفة.");
      setTimeout(() => channel.delete().catch(() => {}), 5000);
      return;
    }
    const roleName = nameResponses.first().content;

    // Step 2: Get Role Color
    await channel.send(`رائع! الآن اختر اللون لـ **${roleName}**. يمكنك كتابة:\n- **اسم اللون** (مثل: أحمر، أزرق، بنفسجي...)\n- **كود اللون** (مثل: #ff0000)\n- أو اكتب **تلقائي** للون الافتراضي.`);
    
    const colorResponses = await channel.awaitMessages({ filter, max: 1, time: 60000 });
    let colorValue: string | undefined = undefined;

    if (colorResponses.size) {
      const colorInput = colorResponses.first().content.trim().toLowerCase();
      
      if (colorInput === "تلقائي" || colorInput === "auto") {
        colorValue = undefined;
      } else if (colorInput.startsWith("#")) {
        if (/^#[0-9a-f]{6}$/i.test(colorInput)) {
          colorValue = colorInput;
        } else {
          await channel.send("⚠️ كود اللون غير صحيح. سيتم استخدام اللون الافتراضي.");
        }
      } else if (COLOR_MAP[colorInput]) {
        colorValue = COLOR_MAP[colorInput];
      } else if (/^[0-9a-f]{6}$/i.test(colorInput)) {
        colorValue = `#${colorInput}`;
      } else {
        await channel.send("⚠️ لم أتعرف على هذا اللون. سيتم استخدام اللون الافتراضي.");
      }
    }

    // Step 3: Create the Role
    const newRole = await originalMessage.guild?.roles.create({
      name: roleName,
      color: colorValue as any,
      permissions: extraPermissions,
      reason: `شراء رتبة من ${originalMessage.author.tag}`,
    });
    
    if (newRole) {
      await originalMessage.member?.roles.add(newRole);
      
      // Update cooldown and track ownership
      const userRef = doc(db, "users", userId);
      await setDoc(userRef, { 
        lastRoleCreatedAt: new Date().toISOString()
      }, { merge: true });

      // Track the role in a separate collection for ownership verification
      const roleRef = doc(db, "custom_roles", newRole.id);
      await setDoc(roleRef, {
        roleId: newRole.id,
        creatorId: userId,
        guildId: originalMessage.guild.id,
        createdAt: new Date().toISOString()
      });

      await channel.send(`🎊 تم إنشاء الرتبة <@&${newRole.id}> وإضافتها لك بنجاح يا <@${userId}> مع الصلاحيات المختارة!\nسيتم حذف هذه الغرفة تلقائياً بعد قليل.`);
      setTimeout(() => channel.delete().catch(() => {}), 15000);
    }
  } catch (err) {
    console.error("Role creation flow error:", err);
    await channel.send("❌ حدث خطأ غير متوقع أثناء العملية. يرجى التأكد من صلاحيات البوت والمحاولة لاحقاً.");
    setTimeout(() => channel.delete().catch(() => {}), 10000);
  }
}

// ----------------------------------------------------
// Arab Country Roles Constant & Batch Creation Helper
// ----------------------------------------------------
const ARAB_COUNTRIES = [
  { name: "السعودية", flag: "🇸🇦", color: "#006C35", region: "الخليج العربي" },
  { name: "الإمارات", flag: "🇦🇪", color: "#00732F", region: "الخليج العربي" },
  { name: "الكويت", flag: "🇰🇼", color: "#007A3D", region: "الخليج العربي" },
  { name: "قطر", flag: "🇶🇦", color: "#8D1B3D", region: "الخليج العربي" },
  { name: "البحرين", flag: "🇧🇭", color: "#DA291C", region: "الخليج العربي" },
  { name: "عُمان", flag: "🇴🇲", color: "#DB162F", region: "الخليج العربي" },
  { name: "مصر", flag: "🇪🇬", color: "#C09300", region: "شمال أفريقيا ووادي النيل" },
  { name: "السودان", flag: "🇸🇩", color: "#007229", region: "شمال أفريقيا ووادي النيل" },
  { name: "العراق", flag: "🇮🇶", color: "#007A3D", region: "بلاد الشام والعراق" },
  { name: "الأردن", flag: "🇯🇴", color: "#007A3D", region: "بلاد الشام والعراق" },
  { name: "فلسطين", flag: "🇵🇸", color: "#118B44", region: "بلاد الشام والعراق" },
  { name: "سوريا", flag: "🇸🇾", color: "#CE1126", region: "بلاد الشام والعراق" },
  { name: "لبنان", flag: "🇱🇧", color: "#ED1C24", region: "بلاد الشام والعراق" },
  { name: "اليمن", flag: "🇾🇪", color: "#CE1126", region: "شبه الجزيرة العربية" },
  { name: "الجزائر", flag: "🇩🇿", color: "#006633", region: "المغرب العربي" },
  { name: "المغرب", flag: "🇲🇦", color: "#C1272D", region: "المغرب العربي" },
  { name: "تونس", flag: "🇹🇳", color: "#E70013", region: "المغرب العربي" },
  { name: "ليبيا", flag: "🇱🇾", color: "#239E46", region: "المغرب العربي" },
  { name: "موريتانيا", flag: "🇲🇷", color: "#006233", region: "المغرب العربي" },
  { name: "الصومال", flag: "🇸🇴", color: "#4189DD", region: "القرن الأفريقي" },
  { name: "جيبوتي", flag: "🇩🇯", color: "#6AB2E7", region: "القرن الأفريقي" },
  { name: "جزر القمر", flag: "🇰🇲", color: "#FFC61E", region: "المحيط الهندي" },
];

async function createArabCountryRoles(guild: any, options: { style?: string; autoSetup?: boolean } = {}) {
  const { style = "space", autoSetup = true } = options;
  
  const createdRoles: Array<{ id: string; name: string; color: string }> = [];
  const existingRoles: Array<{ id: string; name: string; color: string }> = [];
  const allCountryRoleIds: string[] = [];

  // Ensure guild roles cache is up to date
  await guild.roles.fetch().catch(() => {});

  for (const country of ARAB_COUNTRIES) {
    let roleName = `${country.flag} ${country.name}`;
    if (style === "dot") roleName = `${country.flag} ٠ ${country.name}`;
    else if (style === "pipe") roleName = `${country.flag} | ${country.name}`;
    else if (style === "dash") roleName = `${country.flag} - ${country.name}`;

    // Check if role already exists with any common variant
    const existing = guild.roles.cache.find((r: any) => 
      r.name === roleName ||
      r.name === `${country.flag} ${country.name}` ||
      r.name === `${country.flag} ٠ ${country.name}` ||
      r.name === `${country.flag} | ${country.name}` ||
      r.name === `${country.flag} - ${country.name}` ||
      r.name === country.name
    );

    if (existing) {
      existingRoles.push({ id: existing.id, name: existing.name, color: existing.hexColor });
      allCountryRoleIds.push(existing.id);
    } else {
      try {
        const newRole = await guild.roles.create({
          name: roleName,
          color: country.color as any,
          reason: "صناعة وتجهيز رتب الدول العربية بأمر البوت التلقائي",
        });
        createdRoles.push({ id: newRole.id, name: newRole.name, color: country.color });
        allCountryRoleIds.push(newRole.id);
      } catch (err) {
        console.error(`Failed to create role for ${country.name}:`, err);
      }
    }
  }

  // Auto-setup in Firestore for /اختار-رتب if requested
  let autoSetupApplied = false;
  if (autoSetup && db && allCountryRoleIds.length > 0) {
    try {
      const currentAllowed = await getGuildConfig(guild.id);
      const merged = Array.from(new Set([...currentAllowed, ...allCountryRoleIds]));
      await setGuildConfig(guild.id, merged);
      autoSetupApplied = true;
    } catch (err) {
      console.error("Failed to auto-update allowedRoleIds in Firestore:", err);
    }
  }

  return {
    totalProcessed: ARAB_COUNTRIES.length,
    createdCount: createdRoles.length,
    existingCount: existingRoles.length,
    createdRoles,
    existingRoles,
    allCountryRoleIds,
    autoSetupApplied
  };
}

// Bot Event Handlers
client.on("guildCreate", guild => {
  registerCommands(guild.id);
});

client.on(Events.ClientReady, () => {
  botStatus.loggedIn = true;
  botStatus.tag = client.user?.tag || "Unknown";
  botStatus.guilds = client.guilds.cache.size;
  botStatus.lastError = null;
  console.log(`🚀 Bot logged in successfully as ${client.user?.tag}`);
  console.log(`📡 Serving ${client.guilds.cache.size} guilds.`);
  
  registerCommands(); // Global registration
  
  // Clear guild commands to fix the "duplicated commands" (/مكرر) issue
  client.guilds.cache.forEach(guild => {
    registerCommands(guild.id, true).catch(() => {});
  });
});

client.on(Events.GuildRoleDelete, async role => {
  const q = query(collection(db, "marketplace"), where("roleId", "==", role.id), where("status", "==", "active"));
  const snap = await getDocs(q);
  snap.forEach(async d => {
    await updateDoc(doc(db, "marketplace", d.id), { status: "canceled" });
    console.log(`Marketplace listing ${d.id} canceled because role ${role.id} was deleted.`);
  });
});

// Update event for v14+ (though 'ready' still works in v14, it's good to be proactive)
// Using .on('ready') above is fine, but let's stick to one consistent handler.

// Helper to check if games are disabled for a guild
async function isGamesDisabledForGuild(guildId?: string | null): Promise<boolean> {
  if (!guildId || !db) return false;
  try {
    const guildSnap = await getDoc(doc(db, "guilds", guildId)).catch(() => null);
    if (guildSnap && guildSnap.exists()) {
      return guildSnap.data()?.gamesEnabled === false;
    }
  } catch (err) {
    console.error("Error checking gamesEnabled:", err);
  }
  return false;
}

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isStringSelectMenu() && (interaction.customId === "select-roles-menu" || interaction.customId === "select-roles-menu-help")) {
    if (interaction.customId === "select-roles-menu-help") {
      const action = interaction.values[0];
      
      if (action === "trigger_select") {
        const allowedRoleIds = await getGuildConfig(interaction.guildId!);
        if (allowedRoleIds.length === 0) {
          return interaction.reply({ content: "⚠️ لم يتم إعداد رتب متاحة في هذا السيرفر بعد.\nيرجى من المسؤول استخدام `/setup`.", ephemeral: true });
        }

        const member = interaction.member as GuildMember;
        const currentAllowedRoles = member.roles.cache.filter(r => allowedRoleIds.includes(r.id));
        const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
        
        const ROLE_LIMIT = 5;
        if (!isAdmin && currentAllowedRoles.size >= ROLE_LIMIT) {
          return interaction.reply({ content: `❌ لقد وصلت للحد الأقصى من الرتب المسموح بها (${ROLE_LIMIT} رتب). يرجى نزع رتبة أولاً.`, ephemeral: true });
        }

        const roles: Role[] = [];
        for (const id of allowedRoleIds) {
          const role = interaction.guild?.roles.cache.get(id);
          if (role) roles.push(role);
        }

        if (roles.length === 0) {
          return interaction.reply({ content: "⚠️ لم أتمكن من العثور على الرتب المحددة في السيرفر.", ephemeral: true });
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId("select-roles-menu")
          .setPlaceholder("اختر الرتبة التي تريدها")
          .addOptions(roles.slice(0, 25).map(r => ({
            label: r.name,
            value: r.id,
            description: `إضافة رتبة ${r.name}`
          })));

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
        return interaction.reply({ content: "الرجاء اختيار رتبة من القائمة أدناه:", components: [row], ephemeral: true });
      } else if (action === "trigger_exchange") {
        const guildId = interaction.guildId!;
        const userId = interaction.user.id;
        
        const cooldownKey = `exchange-cooldown-${userId}`;
        if (tempCooldowns.has(cooldownKey)) {
          return interaction.reply({ content: "⚠️ يرجى الانتظار قليلاً قبل فتح غرفة تحويل جديدة.", ephemeral: true });
        }

        const guildDoc = await getDoc(doc(db, "guilds", guildId));
        const guildConfig = guildDoc.data();
        if (!guildConfig || (!guildConfig.paymentAccount && !guildConfig.exchangeAccount)) {
          return interaction.reply({ content: "⚠️ لم يتم إعداد حساب الدفع في هذا السيرفر بعد. استخدم `/exchange-config`.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const channelName = `exchange-${interaction.user.username}`;
        const channel = await interaction.guild?.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            { id: client.user!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          ],
        });

        if (!channel) return interaction.editReply("❌ فشل إنشاء الغرفة.");

        tempCooldowns.add(cooldownKey);
        setTimeout(() => tempCooldowns.delete(cooldownKey), 300000);

        await interaction.editReply(`✅ تم فتح غرفة التحويل: ${channel}`);
        setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);

        await startTokenExchange(channel, userId);
      }
      return;
    }

    const roleId = interaction.values[0];
    const role = interaction.guild?.roles.cache.get(roleId);
    
    if (!role) {
      return interaction.reply({ content: "❌ الرتبة لم تعد موجودة.", ephemeral: true });
    }

    const member = interaction.member as GuildMember;
    const allowedRoleIds = await getGuildConfig(interaction.guildId!);
    const currentAllowedRoles = member.roles.cache.filter(r => allowedRoleIds.includes(r.id));
    
    const ROLE_LIMIT = 5;
    if (currentAllowedRoles.size >= ROLE_LIMIT) {
      return interaction.reply({ content: `❌ لقد وصلت للحد الأقصى من الرتب المسموح بها (${ROLE_LIMIT} رتب). يرجى نزع رتبة أولاً.`, ephemeral: true });
    }

    if (member.roles.cache.has(roleId)) {
      return interaction.reply({ content: "⚠️ أنت تمتلك هذه الرتبة بالفعل.", ephemeral: true });
    }

    try {
      await member.roles.add(role);
      await interaction.reply({ content: `✅ تم إضافة رتبة **${role.name}** لك بنجاح!`, ephemeral: true });
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: "❌ فشل في إضافة الرتبة. تأكد من صلاحيات البوت.", ephemeral: true });
    }
    return;
  }

  // Route game component interactions (buttons and select menus)
  if (interaction.isButton()) {
    const customId = interaction.customId;
    
    if (customId === "trigger_arab_country_select") {
      const allowedRoleIds = await getGuildConfig(interaction.guildId!);
      if (allowedRoleIds.length === 0) {
        return interaction.reply({ content: "⚠️ لم يتم إعداد رتب متاحة في هذا السيرفر بعد.", ephemeral: true });
      }

      const member = interaction.member as GuildMember;
      const currentAllowedRoles = member.roles.cache.filter(r => allowedRoleIds.includes(r.id));
      const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
      
      const ROLE_LIMIT = 5;
      if (!isAdmin && currentAllowedRoles.size >= ROLE_LIMIT) {
        return interaction.reply({ content: `❌ لقد وصلت للحد الأقصى من الرتب المسموح بها (${ROLE_LIMIT} رتب). يرجى نزع رتبة أولاً.`, ephemeral: true });
      }

      const roles: Role[] = [];
      for (const id of allowedRoleIds) {
        const role = interaction.guild?.roles.cache.get(id);
        if (role) roles.push(role);
      }

      if (roles.length === 0) {
        return interaction.reply({ content: "⚠️ لم أتمكن من العثور على الرتب في السيرفر.", ephemeral: true });
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("select-roles-menu")
        .setPlaceholder("اختر رتبة دولتك أو رتبتك المفضلة من القائمة")
        .addOptions(roles.slice(0, 25).map(r => ({
          label: r.name,
          value: r.id,
          description: `الحصول على رتبة ${r.name}`
        })));

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
      return interaction.reply({ 
        content: `🗺️ مرحباً <@${interaction.user.id}>! يمكنك اختيار رتبة دولتك أو رتبتك المفضلة من القائمة التالية:\nلديك حالياً **${currentAllowedRoles.size}/${ROLE_LIMIT}** رتب.`, 
        components: [row], 
        ephemeral: true 
      });
    }

    if (customId.startsWith("xo_") || customId.startsWith("roul_") || customId.startsWith("mafia_") || customId.startsWith("liar_") || customId.startsWith("gamesconsole_")) {
      if (interaction.guildId) {
        const guildData = (await getDoc(doc(db, "guilds", interaction.guildId)).catch(() => null))?.data() || {};
        if (guildData.gamesEnabled === false) {
          return interaction.reply({ 
            content: "🔒 **تنبيه:** قائمة ونظام الألعاب التفاعلية معطل ومغلق حالياً في هذا السيرفر من قِبل الإدارة.", 
            ephemeral: true 
          });
        }
      }
      await handleGameButtons(interaction);
      return;
    }
  }

  if (interaction.isStringSelectMenu()) {
    const customId = interaction.customId;
    if (customId.startsWith("xo_") || customId.startsWith("roul_") || customId.startsWith("mafia_") || customId.startsWith("liar_") || customId.startsWith("gamesconsole_")) {
      if (interaction.guildId) {
        const guildData = (await getDoc(doc(db, "guilds", interaction.guildId)).catch(() => null))?.data() || {};
        if (guildData.gamesEnabled === false) {
          return interaction.reply({ 
            content: "🔒 **تنبيه:** قائمة ونظام الألعاب التفاعلية معطل ومغلق حالياً في هذا السيرفر من قِبل الإدارة.", 
            ephemeral: true 
          });
        }
      }
      await handleGameSelectMenus(interaction);
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;
  console.log(`Received slash command: ${interaction.commandName}`);

  // Check if games commands are disabled in guild
  if (["xo", "روليت", "مافيا", "liar", "كاذب", "games", "العاب"].includes(interaction.commandName)) {
    if (interaction.guildId) {
      const guildData = (await getDoc(doc(db, "guilds", interaction.guildId)).catch(() => null))?.data() || {};
      if (guildData.gamesEnabled === false) {
        return interaction.reply({ 
          content: "🔒 **تنبيه:** قائمة ونظام الألعاب التفاعلية معطل ومغلق حالياً في هذا السيرفر من قِبل الإدارة.", 
          ephemeral: true 
        });
      }
    }
  }

  try {
    if (interaction.commandName === "setup") {
      const rolesInput = interaction.options.getString("roles", true);
      const roleIds = rolesInput.match(/\d+/g) || [];
      
      if (roleIds.length === 0) {
        return interaction.reply({ content: "⚠️ لم أجد أي رتب صالحة في المدخلات.", ephemeral: true });
      }

      await setGuildConfig(interaction.guildId!, roleIds);
      await interaction.reply({ content: `✅ تم تحديث الرتب المسموح بها: ${roleIds.map(id => `<@&${id}>`).join(", ")}`, ephemeral: true });
    }

    if (interaction.commandName === "exchange-config") {
      const paymentAccount = interaction.options.getString("payment-account", true);
      const buyPrice = interaction.options.getInteger("token-buy-price", true);
      const adminMention = interaction.options.getUser("admin-mention", true);
      
      const guildRef = doc(db, "guilds", interaction.guildId!);
      await setDoc(guildRef, { 
        exchangeAccount: paymentAccount,
        tokenBuyPrice: buyPrice,
        exchangeAdminId: adminMention.id
      }, { merge: true });

      return interaction.reply({ 
        content: `✅ تم ضبط إعدادات التبادل:\n- حساب استلام الكريدت: <@${paymentAccount.replace(/\D/g, "") || paymentAccount}>\n- سعر شراء التوكن: \`${buyPrice}\` كريدت\n- مسؤول التبادل (منشن): <@${adminMention.id}>`, 
        ephemeral: true 
      });
    }

    if (interaction.commandName === "admin-config") {
      const price = interaction.options.getInteger("price", true);
      const tokenPrice = interaction.options.getInteger("token-price", true);
      const account = interaction.options.getString("account", true);
      const channel = interaction.options.getChannel("channel", true);
      
      const guildRef = doc(db, "guilds", interaction.guildId!);
      await setDoc(guildRef, { 
        rolePrice: price, 
        tokenPrice: tokenPrice,
        paymentAccount: account,
        paymentChannelId: channel.id
      }, { merge: true });

      await interaction.reply({ 
        content: `✅ تم ضبط الإعدادات:\n- سعر الرتبة (كريدت): \`${price}\`\n- سعر الرتبة (توكنات): \`${tokenPrice}\`\n- حساب التحويل: <@${account.replace(/\D/g, "") || account}>\n- غرفة الدفع: <#${channel.id}>`, 
        ephemeral: true 
      });
    }
    
    if (interaction.commandName === "اختار-رتب") {
      const allowedRoleIds = await getGuildConfig(interaction.guildId!);
      if (allowedRoleIds.length === 0) {
        return interaction.reply({ content: "⚠️ لم يتم إعداد رتب متاحة في هذا السيرفر بعد.\nيرجى من المسؤول استخدام `/setup`.", ephemeral: true });
      }

      // Check user's current roles from the allowed list
      const member = interaction.member as GuildMember;
      const currentAllowedRoles = member.roles.cache.filter(r => allowedRoleIds.includes(r.id));
      const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
      
      const ROLE_LIMIT = 5;
      if (!isAdmin && currentAllowedRoles.size >= ROLE_LIMIT) {
        return interaction.reply({ content: `❌ لقد وصلت للحد الأقصى من الرتب المسموح بها (${ROLE_LIMIT} رتب). يرجى نزع رتبة أولاً.`, ephemeral: true });
      }

      const roles: Role[] = [];
      for (const id of allowedRoleIds) {
        const role = interaction.guild?.roles.cache.get(id);
        if (role) roles.push(role);
      }

      if (roles.length === 0) {
        return interaction.reply({ content: "⚠️ لم أتمكن من العثور على الرتب المحددة في السيرفر. ربما تم مسحها؟", ephemeral: true });
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("select-roles-menu")
        .setPlaceholder("اختر الرتبة التي تريدها من القائمة")
        .addOptions(roles.slice(0, 25).map(r => ({
          label: r.name,
          value: r.id,
          description: `إضافة رتبة ${r.name}`
        })));

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

      await interaction.reply({ content: `مرحباً <@${interaction.user.id}>! يمكنك اختيار رتبة واحدة من القائمة التالية. لديك حالياً **${currentAllowedRoles.size}/${ROLE_LIMIT}** رتب.`, components: [row], ephemeral: true });
    }

    if (["xo", "روليت", "مافيا", "liar", "كاذب", "games", "العاب"].includes(interaction.commandName)) {
      if (await isGamesDisabledForGuild(interaction.guildId)) {
        return interaction.reply({ 
          content: "🔒 **تنبيه:** قائمة ونظام الألعاب التفاعلية معطل ومغلق حالياً في هذا السيرفر من قِبل الإدارة.", 
          ephemeral: true 
        });
      }
    }

    if (interaction.commandName === "xo") {
      const opponent = interaction.options.getUser("opponent");
      await startXO(interaction, interaction.user.id, opponent ? opponent.id : undefined);
      return;
    }

    if (interaction.commandName === "روليت") {
      const bet = interaction.options.getInteger("bet") || 2;
      await startRoulette(interaction, interaction.user.id, bet);
      return;
    }

    if (interaction.commandName === "مافيا") {
      await startMafiaLobby(interaction, interaction.user.id);
      return;
    }

    if (interaction.commandName === "liar" || interaction.commandName === "كاذب") {
      await startLiarLobby(interaction, interaction.user.id);
      return;
    }

    if (interaction.commandName === "games" || interaction.commandName === "العاب") {
      await showGamesConsole(interaction);
      return;
    }

    if (interaction.commandName === "دول-عربية" || interaction.commandName === "arab-roles") {
      const autoSetup = interaction.options.getBoolean("auto-setup") ?? true;
      const style = interaction.options.getString("style") || "space";
      const member = interaction.member as GuildMember;
      const isAdmin = member.permissions.has(PermissionFlagsBits.ManageRoles) || member.permissions.has(PermissionFlagsBits.Administrator);

      if (!isAdmin) {
        return interaction.reply({ 
          content: "⛔ **عذراً!** هذا الأمر مخصص فقط لإدارة السيرفر (صلاحية إدارة الرتب Manage Roles أو Administrator).", 
          ephemeral: true 
        });
      }

      await interaction.deferReply({ ephemeral: false });

      const guild = interaction.guild;
      if (!guild) {
        return interaction.editReply("❌ تعذر العثور على السيرفر.");
      }

      const botMember = guild.members.me;
      if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.editReply("❌ البوت لا يمتلك صلاحية **إدارة الرتب (Manage Roles)** في هذا السيرفر! يرجى منح البوت الصلاحية ثم إعادة المحاولة.");
      }

      const result = await createArabCountryRoles(guild, { style, autoSetup });

      const embed = new EmbedBuilder()
        .setTitle("🗺️ تم إنشاء وتجهيز رتب الدول العربية بنجاح!")
        .setDescription(`أهلاً بك! قام البوت بمسح وتجهيز رتب **22 دولة عربية** مع الأعلام الرسمية والألوان المعتمدة 🎨.\n\n` +
          `📊 **ملخص العملية:**\n` +
          `✨ **رتب جديدة أُنشئت:** \`${result.createdCount}\` رتبة\n` +
          `♻️ **رتب كانت موجودة مسبقاً:** \`${result.existingCount}\` رتبة\n` +
          `🏛️ **إجمالي الدول:** \`${result.totalProcessed}\` دولة عربية\n` +
          `⚙️ **حالة الربط بنظام الرتب:** ${result.autoSetupApplied ? "✅ تمت إضافتها تلقائياً إلى قائمة `/اختار-رتب` المتاحة للأعضاء!" : "ℹ️ الرتب جاهزة في السيرفر."}\n\n` +
          `💡 **قائمة الدول المجهزة:**\n` +
          `🇸🇦 السعودية • 🇦🇪 الإمارات • 🇰🇼 الكويت • 🇶🇦 قطر • 🇧🇭 البحرين • 🇴🇲 عُمان\n` +
          `🇪🇬 مصر • 🇸🇩 السودان • 🇮🇶 العراق • 🇯🇴 الأردن • 🇵🇸 فلسطين • 🇸🇾 سوريا • 🇱🇧 لبنان • 🇾🇪 اليمن\n` +
          `🇩🇿 الجزائر • 🇲🇦 المغرب • 🇹🇳 تونس • 🇱🇾 ليبيا • 🇲🇷 موريتانيا • 🇸🇴 الصومال • 🇩🇯 جيبوتي • 🇰🇲 جزر القمر`)
        .setColor("#2ECC71")
        .setFooter({ text: "يمكن للأعضاء الآن اختيار رتبة بلدهم عبر أمر /اختار-رتب أو زر اختيار الرتب أدناه" });

      const chooseBtn = new ButtonBuilder()
        .setCustomId("trigger_arab_country_select")
        .setLabel("اختار رتبة دولتك الآن 🗺️")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(chooseBtn);

      await interaction.editReply({ embeds: [embed], components: [row] });
      return;
    }
  } catch (error: any) {
    console.error("❌ Interaction Error:", error);
    const content = "❌ حدث خطأ داخلي أثناء تنفيذ الأمر. قد يكون هناك مشكلة في الاتصال بقاعدة البيانات.";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, ephemeral: true });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  }
});

// Store users in a pending state for role selection
const pendingRoleSelection = new Map<string, string[]>();

// Helper to execute moderation actions
async function handleModerationCommands(message: any, content: string, guildId: string, userId: string) {
  if (!message.guild || !message.member || !db) return false;

  const guildDoc = await getDoc(doc(db, "guilds", guildId)).catch(() => null);
  if (!guildDoc || !guildDoc.exists()) return false;

  const guildData = guildDoc.data();
  const modRoles = guildData.moderationRoles || {};
  const modShortcuts = guildData.moderationShortcuts || {};
  const logChannels = guildData.logChannels || {};

  let matchedAction: string | null = null;
  let matchedShortcutLength = 0;

  // Match shortcut (supporting spaces in shortcuts)
  for (const [action, shortcut] of Object.entries(modShortcuts)) {
    if (shortcut && typeof shortcut === 'string') {
      const cleanShortcut = shortcut.trim();
      if (cleanShortcut.length > 0 && content.startsWith(cleanShortcut)) {
        // Ensure it's a full word match (next char is space or end of string)
        const nextChar = content.charAt(cleanShortcut.length);
        if (nextChar === '' || nextChar === ' ') {
          if (cleanShortcut.length > matchedShortcutLength) {
            matchedAction = action;
            matchedShortcutLength = cleanShortcut.length;
          }
        }
      }
    }
  }

  if (!matchedAction) return false;

  // Check roles - Fetch member explicitly to guarantee roles cache is up to date
  const member = await message.guild.members.fetch(userId).catch(() => null);
  if (!member) return false;

  const allowedRoles = modRoles[matchedAction] || [];
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const hasAllowedRole = allowedRoles.some((rId: string) => member.roles.cache.has(rId));

  if (!isAdmin && !hasAllowedRole) {
    const reply = await message.reply("❌ ليس لديك صلاحية أو رتبة مخصصة لاستخدام أمر الإدارة هذا.");
    setTimeout(() => reply.delete().catch(() => {}), 5000);
    return true; // We handled it
  }

  // Parse remaining arguments
  const args = content.slice(matchedShortcutLength).trim().split(/\s+/);
  const targetUser = message.mentions.users.first();
  const targetId = targetUser ? targetUser.id : (args[0]?.replace(/\D/g, ''));
  
  if (!targetId) {
    const reply = await message.reply("⚠️ يرجى تحديد العضو (عن طريق المنشن أو وضع الـ ID).");
    setTimeout(() => reply.delete().catch(() => {}), 5000);
    return true;
  }

  // Prevent self-action or bot-action
  if (targetId === userId || targetId === client.user?.id) {
    const reply = await message.reply("⚠️ لا يمكنك تطبيق هذا الإجراء على نفسك أو على البوت.");
    setTimeout(() => reply.delete().catch(() => {}), 5000);
    return true;
  }

  try {
    const targetMember = await message.guild.members.fetch(targetId).catch(() => null);
    let reason = args.slice(1).join(" ") || "بدون سبب";

    let actionLabel = "";
    let logColor = "#808080";
    let flavorText = "";

    switch(matchedAction) {
      case "ban":
        await message.guild.members.ban(targetId, { reason: `${message.author.tag}: ${reason}` });
        actionLabel = "حظر (Ban)";
        logColor = "#E74C3C"; // Red
        flavorText = "تم توديع العضو بسلام ومغادرته للسيرفر بناءً على قرار الإدارة. 👋";
        break;
      case "kick":
        if (!targetMember) throw new Error("لم يتم العثور على العضو في السيرفر.");
        await targetMember.kick(`${message.author.tag}: ${reason}`);
        actionLabel = "طرد (Kick)";
        logColor = "#E67E22"; // Orange
        flavorText = "تم إخراج العضو من السيرفر كإجراء تأديبي. 🚪";
        break;
      case "timeout":
        if (!targetMember) throw new Error("لم يتم العثور على العضو في السيرفر.");
        let durationMs = 60 * 60 * 1000; // 1 hour default
        const timeArg = args[1];
        let timeoutReason = reason;
        if (timeArg) {
          const val = parseInt(timeArg);
          if (!isNaN(val)) {
            if (timeArg.endsWith("m")) durationMs = val * 60 * 1000;
            else if (timeArg.endsWith("h")) durationMs = val * 60 * 60 * 1000;
            else if (timeArg.endsWith("d")) durationMs = val * 24 * 60 * 60 * 1000;
            else durationMs = val * 60 * 1000; // default minutes
            timeoutReason = args.slice(2).join(" ") || "بدون سبب";
          }
        }
        await targetMember.timeout(durationMs, `${message.author.tag}: ${timeoutReason}`);
        actionLabel = `إسكات (Timeout) لمدة ${Math.round(durationMs / 60000)} دقيقة`;
        logColor = "#F1C40F"; // Yellow
        reason = timeoutReason; // Set for logging
        flavorText = "تم إعطاء العضو وقتاً مستقطعاً للالتزام بالقوانين. ⏳";
        break;
      case "warn":
        actionLabel = "تحذير (Warn)";
        logColor = "#F39C12";
        flavorText = "تم توجيه إنذار رسمي للعضو، نرجو الالتزام بالقوانين مستقبلاً. 📝";
        if (targetMember) {
          await targetMember.send(`⚠️ لقد تلقيت تحذيراً الإدارة في سيرفر **${message.guild.name}**.\n**السبب:** ${reason}`).catch(() => {});
        }
        break;
      case "unban":
        await message.guild.bans.remove(targetId, `${message.author.tag}: ${reason}`);
        actionLabel = "إزالة حظر (Unban)";
        logColor = "#2ECC71"; // Green
        flavorText = "تم العفو عن العضو وإزالة الحظر عنه، نأمل أن تكون بداية جديدة. 🕊️";
        break;
      case "untimeout":
        if (!targetMember) throw new Error("لم يتم العثور على العضو في السيرفر.");
        await targetMember.timeout(null, `${message.author.tag}: ${reason}`);
        actionLabel = "إزالة إسكات (Untimeout)";
        logColor = "#1ABC9C";
        flavorText = "تم رفع الإسكات عن العضو، نرجو أن يكون قد تعلم الدرس. 🔓";
        break;
      case "unwarn":
        actionLabel = "إزالة تحذير (Unwarn)";
        logColor = "#27AE60";
        flavorText = "تمت مسامحة العضو وسحب التحذير عنه كبادرة حسن نية. 🤝";
        if (targetMember) {
           await targetMember.send(`✅ تم سحب أو إزالة التحذير عنك في سيرفر **${message.guild.name}**.`).catch(() => {});
        }
        break;
    }

    const successEmbed = new EmbedBuilder()
      .setTitle(`✅ تم تنفيذ الإجراء بنجاح`)
      .setColor(logColor as any)
      .setDescription(`**${flavorText}**\n\nتم تنفيذ **${actionLabel}** بحق <@${targetId}>.`)
      .addFields(
        { name: "السبب", value: reason || "بدون سبب" }
      )
      .setTimestamp();
      
    const reply = await message.reply({ embeds: [successEmbed] });

    // Logging
    if (logChannels.modLogs) {
      const logChannel = message.guild.channels.cache.get(logChannels.modLogs);
      if (logChannel && logChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle(`🛡️ سجل إدارة: ${actionLabel}`)
          .setColor(logColor as any)
          .addFields(
            { name: "العضو", value: `<@${targetId}> (${targetId})`, inline: true },
            { name: "المسؤول", value: `<@${userId}>`, inline: true },
            { name: "السبب", value: reason || "غير محدد" }
          )
          .setTimestamp();
        await logChannel.send({ embeds: [embed] });
      }
    }

  } catch (err: any) {
    console.error("Moderation error:", err);
    const reply = await message.reply(`❌ حدث خطأ أثناء التنفيذ: ${err.message}`);
    setTimeout(() => reply.delete().catch(() => {}), 5000);
  }

  return true;
}

client.on(Events.MessageCreate, async message => {
  try {
    // Log message reception for debug
    console.log(`[Msg] ${message.author.tag} (${message.guild?.name}): "${message.content}"`);
    
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    const guildId = message.guild.id;
    const userId = message.author.id;
    const channelId = message.channel.id;

    // Process Moderation Commands FIRST
    const isModCommand = await handleModerationCommands(message, content, guildId, userId);
    if (isModCommand) return; // Stop processing other commands

    // Award activity tokens
    const newTokens = await handleActivityTokens(userId);
    if (newTokens > 0 && newTokens % 100 === 0) {
      // Only notify on major milestones to avoid spam and keep chat clean
      try {
        const milestoneMsg = await message.reply(`🪙 مبارك! رصيدك الآن: **${newTokens}** توكن.`);
        setTimeout(() => milestoneMsg.delete().catch(() => {}), 4000);
      } catch (err) {
        console.log("Could not send token milestone message");
      }
    }

    // Show current moderation shortcuts
    if (content === "امر" || content === "اوامر" || content === "أوامر" || content === "الاوامر" || content === "الأوامر") {
      const guildDoc = await getDoc(doc(db!, "guilds", guildId)).catch(() => null);
      const modShortcuts = guildDoc?.exists() ? (guildDoc.data().moderationShortcuts || {}) : {};
      
      const actionNames: Record<string, string> = {
        ban: "حظر عضو (بان)",
        kick: "طرد عضو من السيرفر",
        timeout: "إسكات عضو (تايم أوت)",
        warn: "تحذير عضو",
        unban: "إزالة الحظر عن عضو",
        untimeout: "إزالة الإسكات عن عضو",
        unwarn: "إزالة التحذير عن عضو"
      };

      let description = "قائمة بأوامر (اختصارات) الإدارة الحالية المسجلة في السيرفر:\n\n";
      const defaults: Record<string, string> = { ban: "حظر", kick: "طرد", timeout: "تايم", warn: "تحذير", unban: "ازالة حظر", untimeout: "ازالة تايم", unwarn: "ازالة تحذير" };

      for (const [key, name] of Object.entries(actionNames)) {
        const shortcut = modShortcuts[key] || defaults[key];
        description += `**${shortcut}** \`~~~\` ${name}\n`;
      }
      
      description += "\n💡 **طريقة الاستخدام:**\n`[الاختصار] [@العضو] [السبب/الوقت]`\nمثال: `" + (modShortcuts["timeout"] || defaults["timeout"]) + " @أحمد 10m بسبب الإزعاج`";

      const helpEmbed = new EmbedBuilder()
        .setTitle("🛡️ أوامر الإدارة")
        .setColor("#3498DB")
        .setDescription(description)
        .setFooter({ text: "يمكن تعديل هذه الاختصارات من لوحة تحكم السيرفر." });

      await message.reply({ embeds: [helpEmbed] });
      return;
    }

    // Fallback setup for administrators via text command if slash commands are laggy
    if (content.startsWith("!setup") && message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      const roleIds = content.match(/\d+/g) || [];
      if (roleIds.length === 0) {
        const errSetup = await message.reply("⚠️ يرجى منشن الرتب أو وضع أيدياتها بعد الأمر: `!setup @role1 @role2`.");
        setTimeout(() => errSetup.delete().catch(() => {}), 10000);
        return;
      }
      await setGuildConfig(guildId, roleIds);
      const successSetup = await message.reply(`✅ تم إعداد الرتب المسموح بها بنجاح: ${roleIds.map(id => `<@&${id}>`).join(", ")}`);
      setTimeout(() => successSetup.delete().catch(() => {}), 15000);
      return;
    }

    // Direct Text Command to Create Arab Countries Roles
    if (
      content === "انشاء رتب الدول" || 
      content === "صنع رتب الدول" || 
      content === "رتب الدول" || 
      content === "رتب الدول العربية" || 
      content === "دول عربية" ||
      content === "!arab-roles" || 
      content === "!countries"
    ) {
      const member = message.member;
      const isAdmin = member?.permissions.has(PermissionFlagsBits.ManageRoles) || member?.permissions.has(PermissionFlagsBits.Administrator);
      if (!isAdmin) {
        const denyMsg = await message.reply("⛔ هذا الأمر مخصص فقط لإدارة السيرفر (صلاحية إدارة الرتب Manage Roles).");
        setTimeout(() => denyMsg.delete().catch(() => {}), 8000);
        return;
      }

      const botMember = message.guild.members.me;
      if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return message.reply("❌ البوت لا يمتلك صلاحية **إدارة الرتب (Manage Roles)** في هذا السيرفر! يرجى منح البوت الصلاحية ثم إعادة المحاولة.");
      }

      const progressMsg = await message.reply("⏳ جاري إنشاء وتجهيز رتب **22 دولة عربية** بأعلامها وألوانها الرسمية...");
      const result = await createArabCountryRoles(message.guild, { autoSetup: true });

      const embed = new EmbedBuilder()
        .setTitle("🗺️ تم إنشاء وتجهيز رتب الدول العربية بنجاح!")
        .setDescription(`تم تجهيز رتب **22 دولة عربية** مع الأعلام الرسمية والألوان المعتمدة 🎨.\n\n` +
          `📊 **ملخص العملية:**\n` +
          `✨ **رتب جديدة أُنشئت:** \`${result.createdCount}\` رتبة\n` +
          `♻️ **رتب كانت موجودة مسبقاً:** \`${result.existingCount}\` رتبة\n` +
          `🏛️ **إجمالي الدول:** \`${result.totalProcessed}\` دولة عربية\n` +
          `⚙️ **حالة الربط:** ${result.autoSetupApplied ? "✅ تمت إضافتها تلقائياً إلى قائمة `/اختار-رتب` المتاحة للأعضاء!" : "ℹ️ الرتب جاهزة في السيرفر."}\n\n` +
          `💡 **قائمة الدول المجهزة:**\n` +
          `🇸🇦 السعودية • 🇦🇪 الإمارات • 🇰🇼 الكويت • 🇶🇦 قطر • 🇧🇭 البحرين • 🇴🇲 عُمان\n` +
          `🇪🇬 مصر • 🇸🇩 السودان • 🇮🇶 العراق • 🇯🇴 الأردن • 🇵🇸 فلسطين • 🇸🇾 سوريا • 🇱🇧 لبنان • 🇾🇪 اليمن\n` +
          `🇩🇿 الجزائر • 🇲🇦 المغرب • 🇹🇳 تونس • 🇱🇾 ليبيا • 🇲🇷 موريتانيا • 🇸🇴 الصومال • 🇩🇯 جيبوتي • 🇰🇲 جزر القمر`)
        .setColor("#2ECC71");

      const chooseBtn = new ButtonBuilder()
        .setCustomId("trigger_arab_country_select")
        .setLabel("اختار رتبة دولتك الآن 🗺️")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(chooseBtn);

      await progressMsg.edit({ content: "", embeds: [embed], components: [row] });
      return;
    }

    // Command to check tokens
    if (content === "رصيدي" || content === "رصيد" || content === "tokens") {
      const profile = await getUserProfile(userId);
      const balanceMsg = await message.reply(`🪙 رصيدك الحالي من توكنات التفاعل هو: **${profile.tokens}** توكن.\nيمكنك كسب المزيد من التفاعل في السيرفر!`);
      setTimeout(() => balanceMsg.delete().catch(() => {}), 15000);
      return;
    }

    // Games: XO (إكس أو) Direct trigger
    if (content.toLowerCase().startsWith("xo") || content.startsWith("اكس او") || content.startsWith("اكس-او") || content.startsWith("إكس أو")) {
      const isGamesOff = await isGamesDisabledForGuild(guildId);
      if (isGamesOff) {
        return; // Stay completely silent when games are disabled
      }
      const parts = content.split(/\s+/);
      const opponentUser = message.mentions.users.first();
      await startXO(message, userId, opponentUser ? opponentUser.id : undefined);
      return;
    }

    // Games: Roulette (روليت) Direct trigger
    if (content.startsWith("روليت") || content.toLowerCase().startsWith("roulette")) {
      const isGamesOff = await isGamesDisabledForGuild(guildId);
      if (isGamesOff) {
        return; // Stay completely silent when games are disabled
      }
      const parts = content.split(/\s+/);
      let betAmount = 2; // default
      for (const part of parts) {
        const val = parseInt(part);
        if (!isNaN(val) && val > 0) {
          betAmount = val;
          break;
        }
      }
      await startRoulette(message, userId, betAmount);
      return;
    }

    // Games: Mafia (مافيا) Direct trigger
    if (content === "مافيا" || content.toLowerCase() === "mafia" || content === "لعبة مافيا") {
      const isGamesOff = await isGamesDisabledForGuild(guildId);
      if (isGamesOff) {
        return; // Stay completely silent when games are disabled
      }
      await startMafiaLobby(message, userId);
      return;
    }

    // Games: Who is the Liar (من الكاذب) Direct trigger
    if (content === "كاذب" || content === "من الكاذب" || content === "من الكاذب؟" || content.toLowerCase() === "liar" || content.toLowerCase() === "undercover") {
      const isGamesOff = await isGamesDisabledForGuild(guildId);
      if (isGamesOff) {
        return; // Stay completely silent when games are disabled
      }
      await startLiarLobby(message, userId);
      return;
    }

    // Games Dashboard Direct trigger
    if (content === "العاب" || content === "الألعاب" || content === "العاب السيرفر" || content.toLowerCase() === "games") {
      const isGamesOff = await isGamesDisabledForGuild(guildId);
      if (isGamesOff) {
        return; // Stay completely silent when games are disabled
      }
      await showGamesConsole(message);
      return;
    }

    // Ping command to test responsiveness
    if (content === "!ping") {
      const pingMsg = await message.reply("🏓 Pong! Bot is active and reading messages.");
      setTimeout(() => pingMsg.delete().catch(() => {}), 10000);
      return;
    }

    // Debug command for admins
    if (content === "!debug" && message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      const hasMsgIntent = client.options.intents.has(GatewayIntentBits.MessageContent);
      const hasMemberIntent = client.options.intents.has(GatewayIntentBits.GuildMembers);
      return message.reply(`🔍 **Bot Debug Info:**\n- Message Content Intent: ${hasMsgIntent ? "✅" : "❌"}\n- Server Members Intent: ${hasMemberIntent ? "✅" : "❌"}\n- Ready: ✅\n- Current User: ${client.user?.tag}`);
    }

    // Role Registration (تسجيل رول) - For Admins
    if (content.startsWith("تسجيل رول") && message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      const targetUser = message.mentions.users.first();
      const targetRole = message.mentions.roles.first();

      if (!targetUser || !targetRole) {
        return message.reply("⚠️ يرجى استخدام الصيغة: `تسجيل رول @user @role` لربط رتبة قديمة بصاحبها.");
      }

      try {
        const roleRef = doc(db, "custom_roles", targetRole.id);
        await setDoc(roleRef, {
          roleId: targetRole.id,
          creatorId: targetUser.id,
          guildId: message.guild.id,
          createdAt: new Date().toISOString()
        });

        return message.reply(`✅ تم تسجيل الرتبة <@&${targetRole.id}> بنجاح كملكية لـ <@${targetUser.id}>. يمكنه الآن عرضها في السوق.`);
      } catch (err: any) {
        console.error("Error registering role:", err);
        return message.reply("❌ حدث خطأ أثناء التسجيل في قاعدة البيانات.");
      }
    }

    // Shortcut for Help (أوامر رول)
    if (content === "اوامر رول" || content === "أوامر رول" || content === "اوامر" || content === "رول") {
      const profile = await getUserProfile(userId);
      const embed = new EmbedBuilder()
        .setTitle("📋 قائمة أوامر الرتب")
        .setDescription(`إليك الأوامر المتاحة حالياً:\n\n` +
          `1️⃣ **إضافة رول**: يظهر لك قائمة رتب تختار منها.\n` +
          `🔹 **أمر جديد**: **/اختار-رتب** (قائمة منسدلة حديثة).\n` +
          `2️⃣ **نزع رول**: لنزع الرتبة الموجودة عندك.\n` +
          `3️⃣ **صنع رول**: لإنشاء رتبة خاصة بك (كريدت أو توكنات).\n` +
          `4️⃣ **بيع رول**: عرض رتبتك الخاصة للبيع في السوق.\n` +
          `5️⃣ **شراء رول**: لشراء رتبة معروضة في السوق.\n` +
          `6️⃣ **سوق**: عرض الرتب المعروضة للبيع.\n` +
          `7️⃣ **تبادل**: شراء توكن بكريدت (تلقائي) أو سحب كريدت.\n` +
          `8️⃣ **رصيدي**: لمعرفة رصيدك من توكنات التفاعل.\n` +
          `9️⃣ **!ping**: فحص استجابة البوت.\n\n` +
          `🪙 رصيدك الحالي: **${profile.tokens}** توكن.`)
        .setColor("#5865F2")
        .setFooter({ text: "نظام إدارة الرتب التلقائي" });
      
      const btn = new StringSelectMenuBuilder()
        .setCustomId("select-roles-menu-help")
        .setPlaceholder("اضغط هنا لاختيار عملية سريعة")
        .addOptions([
          { label: "اختار رتبة", value: "trigger_select", description: "يفتح لك قائمة الرتب المتاحة" },
          { label: "شراء توكنات", value: "trigger_exchange", description: "استبدال الكريدت بتوكنات (5000 = 1)" }
        ]);

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(btn);

      const helpMsg = await message.reply({ embeds: [embed], components: [row] });
      setTimeout(() => helpMsg.delete().catch(() => {}), 30000);
      return;
    }

    // Role Marketplace: Buy (شراء رول)
    if (content.startsWith("شراء رول") || content.startsWith("شراء") || content.startsWith("buy")) {
      const parts = content.split(/\s+/);
      const indexStr = parts.find(p => !isNaN(parseInt(p)) && p !== "رول");
      
      if (!indexStr) {
        return message.reply("⚠️ يرجى كتابة رقم الرتبة التي تريد شراءها من السوق. مثال: `شراء رول 1`\nاستخدم أمر `سوق` لرؤية العروض.");
      }

      const listings = await getActiveListings();
      const index = parseInt(indexStr) - 1;
      const listing = listings[index];

      if (!listing) {
        return message.reply("❌ اختيار غير صحيح. يرجى التأكد من رقم العرض في السوق.");
      }

      if (listing.sellerId === userId) {
        return message.reply("❌ لا يمكنك شراء رتبتك الخاصة!");
      }

      await handleRolePurchase(listing, message, userId, guildId);
      return;
    }

    // Role Marketplace: View Shop (سوق)
    if (content === "سوق" || content === "market" || content === "shop") {
      const listings = await getActiveListings();
      if (listings.length === 0) {
        return message.reply("📟 السوق فارغ حالياً. لا توجد رتب معروضة للبيع.");
      }

      const listingsEmbed = new EmbedBuilder()
        .setTitle("🏪 سوق الرتب - Marketplace")
        .setDescription("إليك الرتب المعروضة للبيع حالياً. اكتب **رقم العرض** للشراء.")
        .setColor("#F1C40F");

      const listText = await Promise.all(listings.map(async (l, i) => {
        const seller = await client.users.fetch(l.sellerId).catch(() => null);
        const profile = await getUserProfile(l.sellerId);
        const reputation = getReputationStars(profile.salesCount);
        const currencyIcon = l.currency === "tokens" ? "🪙" : "💳";
        return `**${i + 1}** - <@&${l.roleId}>\n┗ السعر: \`${l.price}\` ${currencyIcon} | البائع: ${seller?.tag || "Unknown"}\n┗ التقييم: ${reputation}\n`;
      }));

      listingsEmbed.addFields({ name: "الرتب المتاحة", value: listText.join("\n") || "لا يوجد" });
      
      const marketMsg = await message.reply({ embeds: [listingsEmbed] });
      setTimeout(() => marketMsg.delete().catch(() => {}), 60000);

      const marketFilter = (m: any) => m.author.id === userId && !isNaN(parseInt(m.content));
      const marketCollector = message.channel.createMessageCollector({ filter: marketFilter, time: 30000, max: 1 });

      marketCollector.on("collect", async m => {
        const index = parseInt(m.content) - 1;
        const listing = listings[index];

        if (!listing) {
          return m.reply("❌ اختيار غير صحيح.");
        }

        if (listing.sellerId === userId) {
          return m.reply("❌ لا يمكنك شراء رتبتك الخاصة!");
        }

        await handleRolePurchase(listing, m, userId, guildId);
      });
      return;
    }

    // Role Marketplace: Sell (بيع رول)
    if (content.toLowerCase().split(/\s+/).includes("بيع") && content.includes("رول")) {
      const activeListingsCount = await getUserActiveListingsCount(userId);
      if (activeListingsCount >= 2) {
        return message.reply("⚠️ يمكنك عرض **رتبتين فقط** في السوق في وقت واحد لمنع الاحتكار.");
      }

      const promptMsg = await message.reply("الرجاء منشن الرتبة التي تريد عرضها للبيع (يجب أن تكون أنت من صنعها).");
      setTimeout(() => promptMsg.delete().catch(() => {}), 15000);

      const filter = (m: any) => m.author.id === userId && m.mentions.roles.size > 0;
      const collector = message.channel.createMessageCollector({ filter, time: 30000, max: 1 });

      collector.on("collect", async m => {
        const role = m.mentions.roles.first();
        if (!role) return;

        // Verify ownership
        const roleSnap = await getDoc(doc(db, "custom_roles", role.id));
        const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
        
        if (!isAdmin && (!roleSnap.exists() || roleSnap.data().creatorId !== userId)) {
          return m.reply("❌ لا يمكنك بيع هذه الرتبة. يمكنك فقط بيع الرتب التي قمت بصنعها بنفسك عبر البوت.");
        }

        // Check if already listed
        const q = query(collection(db, "marketplace"), where("roleId", "==", role.id), where("status", "==", "active"));
        const existingListing = await getDocs(q);
        if (!existingListing.empty) {
          return m.reply("❌ هذه الرتبة معروضة للبيع بالفعل في السوق.");
        }

        // Create setup channel
        const channel = await message.guild!.channels.create({
          name: `عرض-بيع-${role.name}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: message.guild!.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            { id: client.user!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          ],
        });

        const setupMsg = await m.reply(`✅ تم فتح غرفة خاصة لإكمال بيانات العرض: ${channel}`);
        setTimeout(() => setupMsg.delete().catch(() => {}), 30000);
        
        await channel.send(`مرحباً <@${userId}>! أنت الآن تعرض رتبة **${role.name}** للبيع.\nيرجى كتابة **السعر** متبوعاً بنوع العملة (كريدت أو توكن).\nمثال: \`5000 كريدت\` أو \`20 توكن\`.`);

        const sellFilter = (sm: any) => sm.author.id === userId;
        const sellCollector = channel.createMessageCollector({ filter: sellFilter, max: 1, time: 60000 });

        sellCollector.on("collect", async sm => {
          const sellContent = sm.content.toLowerCase();
          let currency: "credit" | "tokens" = sellContent.includes("توكن") ? "tokens" : "credit";
          const priceMatch = sellContent.match(/\d+/);
          const price = priceMatch ? parseInt(priceMatch[0]) : 0;

          if (price <= 0) {
            await channel.send("❌ السعر غير صالح. يرجى إعادة المحاولة بكتبة سعر صحيح.");
            return;
          }

          // Save listing
          await addDoc(collection(db, "marketplace"), {
            roleId: role.id,
            roleName: role.name,
            sellerId: userId,
            price: price,
            currency: currency,
            status: "active",
            createdAt: new Date().toISOString()
          });

          await channel.send(`✅ تم عرض رتبة **${role.name}** في السوق بنجاح بسعر \`${price}\` ${currency === "tokens" ? "توكن" : "كريدت"}.\nسيتم حذف هذه الغرفة الآن.`);
          setTimeout(() => channel.delete(), 5000);
        });
      });
      return;
    }

    // Token Exchange Trigger (شراء توكن)
    if (content.includes("شراء توكن") || content.includes("تحويل") || content === "تبادل" || content === "صرف") {
      const cooldownKey = `exchange-cooldown-${userId}`;
      if (tempCooldowns.has(cooldownKey)) {
        const cooldownMsg = await message.reply("⚠️ يرجى الانتظار قليلاً قبل محاولة فتح غرفة تحويل جديدة.");
        setTimeout(() => cooldownMsg.delete().catch(() => {}), 10000);
        return;
      }

      const guildDoc = await getDoc(doc(db, "guilds", guildId));
      const guildConfig = guildDoc.data();
      if (!guildConfig || (!guildConfig.paymentAccount && !guildConfig.exchangeAccount)) {
        return message.reply("⚠️ لم يتم إعداد حساب الدفع في هذا السيرفر بعد. استخدم `/exchange-config`.");
      }

      const channelName = `exchange-${message.author.username}`;
      const channel = await message.guild!.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: message.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          { id: client.user!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ],
      });

      if (!channel) return message.reply("❌ فشل إنشاء الغرفة.");

      tempCooldowns.add(cooldownKey);
      setTimeout(() => tempCooldowns.delete(cooldownKey), 300000); // 5 min cooldown

      const openMsg = await message.reply(`✅ تم فتح غرفة التحويل: ${channel}`);
      setTimeout(() => openMsg.delete().catch(() => {}), 15000);

      await startTokenExchange(channel, userId);
      return;
    }

    // Role Creation System (صنع رول)
    if (content.toLowerCase().split(/\s+/).includes("صنع") && content.includes("رول")) {
      // Abuse prevention: Check for creation cooldown
      const profile = await getUserProfile(userId);
      const now = Date.now();
      const roleCooldown = 12 * 60 * 60 * 1000; // 12 hours
      
      const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);

      if (!isAdmin && (now - profile.lastRoleCreatedAt < roleCooldown)) {
        const remaining = Math.ceil((roleCooldown - (now - profile.lastRoleCreatedAt)) / 1000 / 60 / 60);
        const cooldownRoleMsg = await message.reply(`⏳ مهلاً! لقد قمت بصنع رتبة مؤخراً. يرجى الانتظار **${remaining} ساعة** قبل صنع رتبة أخرى لمنع الاحتكار.`);
        setTimeout(() => cooldownRoleMsg.delete().catch(() => {}), 15000);
        return;
      }

      const guildData = (await getDoc(doc(db, "guilds", guildId))).data() || {};
      const rolePrice = guildData.rolePrice || 5000;
      const tokenPrice = guildData.tokenPrice || 10;
      const isFreeRoleEnabled = guildData.freeRoleEnabled !== false;

      // Create Private Channel
      const channel = await message.guild.channels.create({
        name: `طلب-رتبة-${message.author.username}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: message.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: message.author.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          { id: client.user!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ],
      });

      const inviteMsg = await message.reply(`✅ تم فتح غرفة خاصة لك: ${channel}\n🔔 <@${userId}> يرجى التوجه إلى الغرفة الجديدة لاختيار طريقة الدفع أو العرض.`);
      setTimeout(() => inviteMsg.delete().catch(() => {}), 30000);
      
      const embedDescription = isFreeRoleEnabled
        ? `مرحباً <@${userId}>!\nيرجى اختيار طريقة الدفع للرتبة الخاصة:\n\n1️⃣ **الكريدت**: \`${rolePrice}\` كريدت\n2️⃣ **التوكنات**: \`${tokenPrice}\` توكن تفاعل\n🎁 **3️⃣ تجربة مجانية (عرض خاص)**: \`0\` مجاناً بدون أي تكلفة!\n\n> انقر على الأزرار أدناه 🔘 أو اكتب **1** أو **2** أو **3** في هذه الغرفة.`
        : `مرحباً <@${userId}>!\nيرجى اختيار طريقة الدفع للرتبة الخاصة:\n\n1️⃣ **الكريدت**: \`${rolePrice}\` كريدت\n2️⃣ **التوكنات**: \`${tokenPrice}\` توكن تفاعل\n\n> ℹ️ *عرض الرتب المجانية مغلق حالياً من قِبل إدارة السيرفر.*\n> انقر على الأزرار أدناه 🔘 أو اكتب **1** أو **2** في هذه الغرفة.`;

      const selectionEmbed = new EmbedBuilder()
        .setTitle("💳 اختيار طريقة الدفع / العرض الخاص")
        .setDescription(embedDescription)
        .setColor(isFreeRoleEnabled ? "#2ECC71" : "#5865F2");

      const choiceCreditBtn = new ButtonBuilder()
        .setCustomId(`role_choice_credit_${channel.id}`)
        .setLabel("الكريدت 💳")
        .setStyle(ButtonStyle.Primary);

      const choiceTokenBtn = new ButtonBuilder()
        .setCustomId(`role_choice_tokens_${channel.id}`)
        .setLabel("التوكنات 🪙")
        .setStyle(ButtonStyle.Success);

      const choiceFreeBtn = new ButtonBuilder()
        .setCustomId(`role_choice_free_${channel.id}`)
        .setLabel("مجاني (0) 🎁")
        .setStyle(ButtonStyle.Secondary);

      const activeComponents: any[] = [choiceCreditBtn, choiceTokenBtn];
      if (isFreeRoleEnabled) {
        activeComponents.push(choiceFreeBtn);
      }

      const selectionRow = new ActionRowBuilder<any>().addComponents(...activeComponents);

      const selectionMsg = await channel.send({ 
        content: `<@${userId}>`, 
        embeds: [selectionEmbed],
        components: [selectionRow]
      });

      let choiceHandled = false;

      const handleChoice = async (choice: string, interactionToReply?: any) => {
        if (choiceHandled) return;

        if (choice === "3" && !isFreeRoleEnabled) {
          if (interactionToReply) {
            await interactionToReply.reply({ content: "❌ عذراً، عرض صناعة الرتب المجانية مغلق حالياً من قِبل إدارة السيرفر. يرجى اختيار الكريدت أو التوكنات.", ephemeral: true }).catch(() => {});
          } else {
            await channel.send("❌ عذراً، عرض صناعة الرتب المجانية مغلق حالياً من قِبل إدارة السيرفر. يرجى اختيار الدفع بالكريدت (1) أو التوكنات (2).");
          }
          return;
        }

        choiceHandled = true;

        // Stop collectors
        try { selectionCollector.stop("chosen"); } catch(e){}
        try { buttonCollector.stop("chosen"); } catch(e){}

        if (interactionToReply) {
          await interactionToReply.deferUpdate().catch(() => {});
        }

        // Disable buttons on the original message helper to prevent double-clicks
        const disabledCreditBtn = ButtonBuilder.from(choiceCreditBtn).setDisabled(true);
        const disabledTokenBtn = ButtonBuilder.from(choiceTokenBtn).setDisabled(true);
        const disabledComponents: any[] = [disabledCreditBtn, disabledTokenBtn];
        if (isFreeRoleEnabled) {
          const disabledFreeBtn = ButtonBuilder.from(choiceFreeBtn).setDisabled(true);
          disabledComponents.push(disabledFreeBtn);
        }
        const disabledRow = new ActionRowBuilder<any>().addComponents(...disabledComponents);
        await selectionMsg.edit({ components: [disabledRow] }).catch(() => {});

        if (choice === "3") {
          await channel.send("🎉 **تهانينا!** لقد استفدت من العرض المجاني الخاص بهذه الفترة (0 كريدت / 0 توكن).\nجاري فتح إعداد الرتبة فوراً...");
          startRoleCreation(channel, userId, message);
          return;
        }

        if (choice === "2") {
          const profile = await getUserProfile(userId);
          const baseRequired = guildData.tokenPrice || 10;
          
          if (profile.tokens < baseRequired) {
            await channel.send(`❌ رصيدك غير كافٍ. تحتاج إلى \`${baseRequired}\` توكن على الأقل، ورصيدك الحالي هو \`${profile.tokens}\`.`);
            setTimeout(() => channel.delete().catch(() => {}), 5000);
            return;
          }

          // Show Permissions Choice
          const permsEmbed = new EmbedBuilder()
            .setTitle("🌟 اختر صلاحياتك (اختياري)")
            .setDescription(`يمكنك اختيار **صلاحيتين** كحد أقصى:\n\n` + 
              PERMISSIONS_LIST.map((p, i) => `**${i + 1}** - ${p.icon} ${p.name}${p.premium ? " (⭐ +4 توكن)" : " (مجانية)"}`).join("\n") + 
              `\n\n> اطلب أرقام الصلاحيات (مثال: **1,5**) أو اكتب **تخطي** للرتبة بدون صلاحيات خاصة.`)
            .setColor("#A020F0")
            .setFooter({ text: `السعر الأساسي: ${baseRequired} توكن` });
          
          await channel.send({ embeds: [permsEmbed] });
          
          const permsFilter = (m: any) => m.author.id === userId;
          const permsCollector = channel.createMessageCollector({ filter: permsFilter, max: 1, time: 60000 });
          
          permsCollector.on("collect", async (pm: any) => {
            const pContent = pm.content.trim();
            let selectedPerms: bigint[] = [];
            let extraCost = 0;
            
            if (pContent !== "تخطي") {
              const choices = pContent.split(/[,،\s]+/).map(n => parseInt(n) - 1);
              // Max 2 permissions
              choices.slice(0, 2).forEach(idx => {
                const perm = PERMISSIONS_LIST[idx];
                if (perm) {
                  selectedPerms.push(perm.flag);
                  if (perm.premium) extraCost += 4;
                }
              });
            }
            
            const totalCost = baseRequired + extraCost;
            if (profile.tokens >= totalCost) {
              const userRef = doc(db, "users", userId);
              await setDoc(userRef, { tokens: profile.tokens - totalCost }, { merge: true });
              await recordTokensSpentOnRole(totalCost);
              await channel.send(`✅ تم خصم \`${totalCost}\` توكن من رصيدك (${baseRequired} أساسي + ${extraCost} إضافي).`);
              startRoleCreation(channel, userId, message, selectedPerms);
            } else {
              await channel.send(`❌ رصيدك أصبح غير كافٍ للطلب مع الصلاحيات المختارة (المطلوب: \`${totalCost}\`). سيتم حذف الغرفة.`);
              setTimeout(() => channel.delete().catch(() => {}), 5000);
            }
          });
          
          permsCollector.on("end", (collected, reason) => {
             if (reason === "time") {
               channel.send("⏳ انتهى وقت الاختيار. سيتم حذف الروم.");
               setTimeout(() => channel.delete().catch(() => {}), 5000);
             }
          });
          return;
        }

        // Choice 1: Credits
        if (!guildData?.paymentAccount || !guildData?.paymentChannelId) {
          await channel.send("⚠️ نظام الدفع بالكريدت غير مهيأ من قِبل الإدارة حالياً. يمكنك استخدام **العرض المجاني 🎁** أو **التوكنات 🪙**.");
          return;
        }

        let paymentChannel: any = null;
        try {
          paymentChannel = await message.guild.channels.fetch(guildData.paymentChannelId).catch(() => null);
        } catch (e) {}

        if (!paymentChannel || paymentChannel.type !== ChannelType.GuildText) {
          await channel.send("❌ لم أجد غرفة الدفع بالكريدت أو أنها ليست غرفة كتابية. يمكنك استخدام **العرض المجاني 🎁** أو **التوكنات 🪙**.");
          return;
        }

        // Try to get the account info for display
        const targetId = (guildData.paymentAccount || "").replace(/\D/g, "");
        let accountDisplay = targetId ? `<@${targetId}>` : guildData.paymentAccount;
        let avatarUrl = null;
        
        try {
          const targetUser = await client.users.fetch(targetId).catch(() => null);
          if (targetUser) {
            avatarUrl = targetUser.displayAvatarURL();
          }
        } catch (err) {
          console.log("Could not fetch payment account user info");
        }

        const creditEmbed = new EmbedBuilder()
          .setTitle("✨ الدفع بالكريدت")
          .setDescription(`مرحباً <@${userId}>!\n\n🔹 **اذهب إلى القناة:** <#${guildData.paymentChannelId}>\n💰 **حولي مبلغ:** \`${guildData.rolePrice}\`\n👤 **إلى هذا الحساب:** ${accountDisplay}\n\n> **ملاحظة:** البوت يراقب الدفع تلقائياً. بعد التحويل، سيقوم بمنشنتك هنا لتكملة الطلب.`)
          .setColor("#FFD700");

        if (avatarUrl) {
          creditEmbed.setThumbnail(avatarUrl);
        }

        await channel.send({ embeds: [creditEmbed] });

        // Improved payment detection - allow any bot but check content strictly
        const paymentCollector = paymentChannel.createMessageCollector({ 
          filter: (m) => m.author.bot, 
          time: 600000 
        });

        paymentCollector.on("collect", async (m) => {
          const embed = m.embeds[0];
          const fieldsContent = embed?.fields?.map(f => f.name + " " + f.value).join(" ") || "";
          const content = (m.content + " " + (embed?.title || "") + " " + (embed?.description || "") + " " + (embed?.footer?.text || "") + " " + fieldsContent).toLowerCase();
          
          console.log(`[PaymentDebug] RoleCreation - From: ${m.author.tag}, Content matches transfer?`);

          const isTransfer = content.includes("قام بتحويل") || 
                            content.includes("has transferred") || 
                            content.includes("transferred") ||
                            content.includes("حول");
          
          if (!isTransfer) return;

          const matches = content.match(/(\d+)/g) || [];
          const foundAmount = matches.map(Number).find(amt => amt >= guildData.rolePrice * 0.94) || 0;

          const isUserMentioned = content.includes(userId) || 
                                 content.includes(message.author.id) || 
                                 content.includes(message.author.username.toLowerCase()) || 
                                 content.includes(message.member?.displayName.toLowerCase() || "");
          
          const targetAccountId = guildData.paymentAccount.replace(/\D/g, "");
          const isAccountMentioned = targetAccountId 
            ? (content.includes(targetAccountId) || content.includes(guildData.paymentAccount.toLowerCase()))
            : content.includes(guildData.paymentAccount.toLowerCase());

          if (isUserMentioned && isAccountMentioned && foundAmount > 0) {
            console.log(`[PaymentSuccess] RoleCreation - Verified payment of ${foundAmount} from ${userId}`);
            paymentCollector.stop("paid");
          }
        });

        paymentCollector.on("end", async (collected, reason) => {
          if (reason === "paid") {
            startRoleCreation(channel, userId, message);
          } else {
            await channel.send("⏳ انتهى الوقت أو تم إلغاء الطلب. سيتم حذف الروم.");
            setTimeout(() => channel.delete(), 5000);
          }
        });
      };

      const selectionFilter = (m: any) => {
        const txt = m.content.trim().toLowerCase();
        return m.author.id === userId && ["1", "2", "3", "١", "٢", "٣", "مجاني", "مجانا"].includes(txt);
      };

      const selectionCollector = channel.createMessageCollector({ 
        filter: selectionFilter, 
        max: 1, 
        time: 120000 
      });

      selectionCollector.on("collect", async (sm) => {
        const txt = sm.content.trim().toLowerCase();
        let normalizedChoice = "1";
        if (txt === "2" || txt === "٢") normalizedChoice = "2";
        else if (txt === "3" || txt === "٣" || txt === "مجاني" || txt === "مجانا") normalizedChoice = "3";
        await handleChoice(normalizedChoice);
      });

      const buttonFilter = (i: any) => i.user.id === userId;
      const buttonCollector = channel.createMessageComponentCollector({
        filter: buttonFilter,
        componentType: ComponentType.Button,
        max: 1,
        time: 120000
      });

      buttonCollector.on("collect", async (i) => {
        let chosen = "1";
        if (i.customId.endsWith("_tokens_" + channel.id)) chosen = "2";
        else if (i.customId.endsWith("_free_" + channel.id)) chosen = "3";
        await handleChoice(chosen, i);
      });

      selectionCollector.on("end", (collected, reason) => {
        if (reason === "time" && !choiceHandled) {
          channel.send("⏳ انتهى وقت الاختيار. سيتم حذف الروم.");
          setTimeout(() => channel.delete().catch(() => {}), 5000);
        }
      });

      return;
    }
    if (content.toLowerCase().split(/\s+/).includes("نزع") && content.includes("رول")) {
      console.log(`Processing removal request from ${message.author.tag}`);
      const allowedRoles = await getGuildConfig(guildId);
      if (allowedRoles.length === 0) {
        return message.reply("⚠️ لم يتم إعداد أي رتب مسموحة للإزالة. المالك يجب أن يستخدم /setup أو !setup أولاً.");
      }

      const promptMsg = await message.reply("الرجاء منشن الرتبة التي تريد نزعها.");
      setTimeout(() => promptMsg.delete().catch(() => {}), 15000);
      
      const filter = (m: any) => m.author.id === userId && m.mentions.roles.size > 0;
      const collector = message.channel.createMessageCollector({ filter, time: 30000, max: 1 });

      collector.on("collect", async m => {
        const role = m.mentions.roles.first();
        if (!role) return;

        if (!allowedRoles.includes(role.id)) {
          const warnMsg = await m.reply("❌ هذه الرتبة غير مسموح بنزعها من قبل المستخدمين.");
          setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
          return;
        }

        try {
          await message.member?.roles.remove(role);
          const successMsg = await m.reply(`✅ تم نزع رتبة ${role.name} منك بنجاح.`);
          setTimeout(() => successMsg.delete().catch(() => {}), 10000);
        } catch (err: any) {
          console.error(err);
          const errorMsg = await m.reply("❌ حدث خطأ أثناء نزع الرتبة. تأكد من أن رتبة البوت أعلى من الرتبة المراد نزعها.");
          setTimeout(() => errorMsg.delete().catch(() => {}), 10000);
        }
      });
    }

    // Shortcut for Adding Role (إضافة رول)
    if (content.toLowerCase().split(/\s+/).includes("إضافة") && content.includes("رول")) {
      console.log(`Processing add request from ${message.author.id}`);
      // Check Cooldown
      const profile = await getUserProfile(userId);
      const lastAction = profile.lastActionAt;
      const now = Date.now();
      const cooldownPeriod = 5 * 60 * 1000; // 5 minutes

      const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);

      if (!isAdmin && (now - lastAction < cooldownPeriod)) {
        const remaining = Math.ceil((cooldownPeriod - (now - lastAction)) / 1000 / 60);
        const cooldownMsg = await message.reply(`⏳ يجب عليك الانتظار ${remaining} دقائق أخرى قبل إضافة رتبة جديدة.`);
        setTimeout(() => cooldownMsg.delete().catch(() => {}), 10000);
        return;
      }

      const allowedRoleIds = await getGuildConfig(guildId);
      if (allowedRoleIds.length === 0) {
        const adminAlert = await message.reply("⚠️ لم يتم إعداد رتب مسموح بها في هذا السيرفر بعد. المالك يجب أن يستخدم /setup أو !setup.");
        setTimeout(() => adminAlert.delete().catch(() => {}), 10000);
        return;
      }

      // Limit Check
      const member = message.member;
      const currentAllowedRoles = member?.roles.cache.filter(r => allowedRoleIds.includes(r.id));
      const ROLE_LIMIT = 5;

      if (!isAdmin && currentAllowedRoles && currentAllowedRoles.size >= ROLE_LIMIT) {
        return message.reply(`❌ لقد وصلت للحد الأقصى من الرتب المسموح بها (${ROLE_LIMIT} رتب). يرجى نزع رتبة أولاً.`);
      }

      const roles: Role[] = [];
      for (const id of allowedRoleIds) {
        const role = message.guild.roles.cache.get(id);
        if (role) roles.push(role);
      }

      if (roles.length === 0) return message.reply("⚠️ لم أتمكن من العثور على الرتب المحددة في السيرفر.");

      const list = roles.map((r, i) => `${i + 1} - ${r.name}`).join("\n");
      const listPrompt = await message.reply(`الرتب المتوفرة:\n\`\`\`\n${list}\n\`\`\`\nاكتب رقم الرتبة التي تريدها.`);
      setTimeout(() => listPrompt.delete().catch(() => {}), 30000);

      pendingRoleSelection.set(userId, roles.map(r => r.id));

      const filter = (m: any) => m.author.id === userId && !isNaN(parseInt(m.content));
      const collector = message.channel.createMessageCollector({ filter, time: 30000, max: 1 });

      collector.on("collect", async m => {
        const index = parseInt(m.content) - 1;
        const roleIdsFromMap = pendingRoleSelection.get(userId);
        pendingRoleSelection.delete(userId);

        if (roleIdsFromMap && roleIdsFromMap[index]) {
          const roleId = roleIdsFromMap[index];
          const role = message.guild?.roles.cache.get(roleId);
          if (!role) {
            const errRole = await m.reply("❌ الرتبة لم تعد موجودة.");
            setTimeout(() => errRole.delete().catch(() => {}), 5000);
            return;
          }

          try {
            await message.member?.roles.add(role);
            await setUserCooldown(userId);
            const successRole = await m.reply(`✅ تم إضافة رتبة ${role.name} لك بنجاح. استمتع!`);
            setTimeout(() => successRole.delete().catch(() => {}), 15000);
          } catch (err: any) {
            console.error(err);
            const failRole = await m.reply("❌ فشل في إضافة الرتبة. تأكد من أن رتبة البوت (رتبته يجب أن تكون أعلى من الرتبة المراد إضافتها في قائمة الرتب).");
            setTimeout(() => failRole.delete().catch(() => {}), 15000);
          }
        } else {
          const invalidChoice = await m.reply("❌ اختيار غير صحيح.");
          setTimeout(() => invalidChoice.delete().catch(() => {}), 5000);
        }
      });
    }
  } catch (error: any) {
    console.error("❌ Message Handler Error:", error);
    botStatus.lastError = `Handler Error: ${error.message}`;
  }
});

// Start Express Server
async function startServer() {
  try {
    // Standard Middleware
    app.use(cors());
    app.use(express.json());
    
    // Logging middleware
    app.use((req, res, next) => {
      const start = Date.now();
      res.on("finish", () => {
        const duration = Date.now() - start;
        if (req.url.startsWith("/api")) {
          console.log(`[API] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
        }
      });
      next();
    });
    
    // API routes FIRST
    const apiRouter = express.Router();

    apiRouter.use((req, res, next) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Surrogate-Control", "no-store");
      next();
    });

    apiRouter.get("/health", (req, res) => {
      res.json({ status: "ok", time: new Date().toISOString() });
    });

    apiRouter.get("/ping", (req, res) => res.json({ status: "alive", time: Date.now() }));

    apiRouter.get("/bot-status", (req, res) => {
      try {
        res.json(botStatus);
      } catch (err: any) {
        console.error("❌ Error in /api/bot-status:", err);
        res.status(500).json({ error: err.message });
      }
    });

    apiRouter.get("/token-stats", async (req, res) => {
      try {
        const stats = await getTokenEconomyStats();
        res.json({
          success: true,
          stats
        });
      } catch (err: any) {
        console.error("❌ Error in /api/token-stats:", err);
        res.status(500).json({ error: err.message });
      }
    });

    apiRouter.get("/channels", (req, res) => {
      try {
        if (!client || !client.user) {
          return res.status(503).json({ error: "البوت غير متصل حالياً بـ Discord." });
        }
        
        // Cache could be empty, so we fetch/retrieve text channels
        const textChannels = client.channels.cache
          .filter((c: any) => c.type === ChannelType.GuildText)
          .map((c: any) => ({
            id: c.id,
            name: c.name,
            guildId: c.guild?.id,
            guildName: c.guild?.name || "سيرفر غير معروف"
          }));
          
        res.json({ channels: textChannels });
      } catch (err: any) {
        console.error("❌ Error in /api/channels:", err);
        res.status(500).json({ error: err.message });
      }
    });

    apiRouter.post("/send-message", async (req, res) => {
      try {
        const { channelId, message } = req.body;
        if (!channelId || !message) {
          return res.status(400).json({ error: "يرجى تحديد القناة ونص الرسالة." });
        }
        if (!client || !client.user) {
          return res.status(503).json({ error: "البوت غير متصل حالياً بـ Discord." });
        }
        
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText) {
          return res.status(404).json({ error: "القناة غير موجودة أو ليست قناة كتابية." });
        }
        
        await (channel as any).send(message);
        res.json({ success: true, message: "تم إرسال الرسالة بنجاح باسم البوت!" });
      } catch (err: any) {
        console.error("❌ Error in /api/send-message:", err);
        res.status(500).json({ error: err.message });
      }
    });

    apiRouter.get("/guilds", async (req, res) => {
      try {
        if (!client || !client.user) {
          return res.status(503).json({ error: "البوت غير متصل حالياً بـ Discord." });
        }
        
        const guildsList = await Promise.all(
          client.guilds.cache.map(async (g: any) => {
            let configData: any = {};
            if (db) {
              const snap = await getDoc(doc(db, "guilds", g.id)).catch(() => null);
              if (snap && snap.exists()) {
                configData = snap.data();
              }
            }
            return {
              id: g.id,
              name: g.name,
              icon: g.iconURL() || null,
              memberCount: g.memberCount || 0,
              rolePrice: configData.rolePrice ?? 5000,
              tokenPrice: configData.tokenPrice ?? 10,
              paymentAccount: configData.paymentAccount || "",
              paymentChannelId: configData.paymentChannelId || "",
              allowedRoles: configData.allowedRoles || [],
              freeRoleEnabled: configData.freeRoleEnabled !== false,
              gamesEnabled: configData.gamesEnabled !== false,
              moderationRoles: configData.moderationRoles || { ban: [], kick: [], timeout: [], warn: [], unban: [], untimeout: [], unwarn: [] },
              moderationShortcuts: configData.moderationShortcuts || { ban: "حظر", kick: "طرد", timeout: "تايم", warn: "تحذير", unban: "ازالة حظر", untimeout: "ازالة تايم", unwarn: "ازالة تحذير" },
              logChannels: configData.logChannels || { modLogs: "" },
            };
          })
        );
        res.json({ guilds: guildsList });
      } catch (err: any) {
        console.error("❌ Error in /api/guilds:", err);
        res.status(500).json({ error: err.message });
      }
    });

    apiRouter.get("/guilds/:guildId/roles", async (req, res) => {
      try {
        const { guildId } = req.params;
        if (!client || !client.user) {
          return res.status(503).json({ error: "البوت غير متصل حالياً بـ Discord." });
        }
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
          return res.status(404).json({ error: "السيرفر غير موجود أو غير متاح." });
        }
        const roles = guild.roles.cache
          .filter((r: any) => r.name !== "@everyone")
          .map((r: any) => ({
            id: r.id,
            name: r.name,
            hexColor: r.hexColor,
            managed: r.managed,
            position: r.position,
          }))
          .sort((a: any, b: any) => b.position - a.position);

        res.json({ roles });
      } catch (err: any) {
        console.error("❌ Error in /api/guilds/:guildId/roles:", err);
        res.status(500).json({ error: err.message });
      }
    });

    apiRouter.post("/guilds/:guildId/create-arab-roles", async (req, res) => {
      try {
        const { guildId } = req.params;
        const { style, autoSetup } = req.body;
        if (!client || !client.user) {
          return res.status(503).json({ error: "البوت غير متصل حالياً بـ Discord." });
        }
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
          return res.status(404).json({ error: "السيرفر غير موجود أو غير متاح." });
        }
        const botMember = guild.members.me;
        if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
          return res.status(403).json({ error: "البوت يفتقر إلى صلاحية إدارة الرتب (Manage Roles) في هذا السيرفر." });
        }

        const result = await createArabCountryRoles(guild, { 
          style: style || "space", 
          autoSetup: autoSetup !== false 
        });

        res.json({
          success: true,
          message: `تم إنشاء وتجهيز رتب الدول العربية بنجاح (${result.createdCount} رتبة جديدة، ${result.existingCount} كانت موجودة)!`,
          result
        });
      } catch (err: any) {
        console.error("❌ Error in /api/guilds/:guildId/create-arab-roles:", err);
        res.status(500).json({ error: err.message });
      }
    });

    apiRouter.post("/guilds/config", async (req, res) => {
      try {
        const { guildId, rolePrice, tokenPrice, paymentAccount, paymentChannelId, allowedRoles, freeRoleEnabled, gamesEnabled, moderationRoles, moderationShortcuts, logChannels } = req.body;
        if (!guildId) {
          return res.status(400).json({ error: "يرجى تحديد المعرف الفريد للسيرفر (guildId)." });
        }
        if (!db) {
          return res.status(503).json({ error: "قاعدة بيانات Firestore غير متصلة." });
        }

        const updatePayload: any = {};
        if (rolePrice !== undefined) updatePayload.rolePrice = Number(rolePrice);
        if (tokenPrice !== undefined) updatePayload.tokenPrice = Number(tokenPrice);
        if (paymentAccount !== undefined) updatePayload.paymentAccount = String(paymentAccount).trim();
        if (paymentChannelId !== undefined) updatePayload.paymentChannelId = String(paymentChannelId).trim();
        if (allowedRoles !== undefined) updatePayload.allowedRoles = Array.isArray(allowedRoles) ? allowedRoles : [];
        if (freeRoleEnabled !== undefined) updatePayload.freeRoleEnabled = Boolean(freeRoleEnabled);
        if (moderationRoles !== undefined) updatePayload.moderationRoles = moderationRoles;
        if (moderationShortcuts !== undefined) updatePayload.moderationShortcuts = moderationShortcuts;
        if (logChannels !== undefined) updatePayload.logChannels = logChannels;
        if (gamesEnabled !== undefined) {
          updatePayload.gamesEnabled = Boolean(gamesEnabled);
          if (!gamesEnabled && client) {
            const guild = client.guilds.cache.get(guildId);
            if (guild) {
              guild.channels.cache.forEach((c: any) => {
                activeXOGames.delete(c.id);
                activeRouletteGames.delete(c.id);
                activeMafiaGames.delete(c.id);
                activeLiarGames.delete(c.id);
              });
            }
          }
        }

        await setDoc(doc(db, "guilds", guildId), updatePayload, { merge: true });

        res.json({ success: true, message: "تم تحديث إعدادات السيرفر بنجاح في قاعدة البيانات!", data: updatePayload });
      } catch (err: any) {
        console.error("❌ Error in /api/guilds/config:", err);
        res.status(500).json({ error: err.message });
      }
    });

    apiRouter.post("/guilds/toggle-feature", async (req, res) => {
      try {
        const { guildId, feature, enabled } = req.body;
        if (!guildId || !feature) {
          return res.status(400).json({ error: "يرجى تحديد معرف السيرفر والميزة." });
        }
        if (!db) {
          return res.status(503).json({ error: "قاعدة بيانات Firestore غير متصلة." });
        }

        const updatePayload: any = {};
        if (feature === "freeRole") {
          updatePayload.freeRoleEnabled = Boolean(enabled);
        } else if (feature === "games") {
          updatePayload.gamesEnabled = Boolean(enabled);
          if (!enabled && client) {
            const guild = client.guilds.cache.get(guildId);
            if (guild) {
              guild.channels.cache.forEach((c: any) => {
                activeXOGames.delete(c.id);
                activeRouletteGames.delete(c.id);
                activeMafiaGames.delete(c.id);
                activeLiarGames.delete(c.id);
              });
            }
          }
        } else {
          return res.status(400).json({ error: "الميزة غير مدعومة." });
        }

        await setDoc(doc(db, "guilds", guildId), updatePayload, { merge: true });

        const featureName = feature === "freeRole" ? "صناعة الرول المجاني" : "قائمة ونظام الألعاب";
        const stateText = enabled ? "فتح وتشغيل" : "إغلاق وتعطيل";
        res.json({ 
          success: true, 
          message: `تم ${stateText} ${featureName} بنجاح!`, 
          data: { guildId, feature, enabled } 
        });
      } catch (err: any) {
        console.error("❌ Error in /api/guilds/toggle-feature:", err);
        res.status(500).json({ error: err.message });
      }
    });

    apiRouter.post("/games/action", async (req, res) => {
      try {
        const { channelId, action, gameType } = req.body;
        if (!channelId) {
          return res.status(400).json({ error: "يرجى تحديد القناة." });
        }
        if (!client || !client.user) {
          return res.status(503).json({ error: "البوت غير متصل حالياً بـ Discord." });
        }
        
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText) {
          return res.status(404).json({ error: "القناة غير موجودة أو ليست قناة كتابية." });
        }

        const fakeTrigger = { channel: channel, guild: channel.guild };
        const guildId = channel.guild.id;

        if (action !== "clear_games" && await isGamesDisabledForGuild(guildId)) {
          return res.status(400).json({ error: "لا يمكن إطلاق اللعبة لأن نظام الألعاب معطل ومغلق حالياً في إعدادات هذا السيرفر. قم بتفعيله أولاً." });
        }

        if (action === "send_console") {
          await showGamesConsole(fakeTrigger);
          return res.json({ success: true, message: "تم إرسال لوحة التحكم بالألعاب (Games Console) إلى القناة!" });
        }

        if (action === "clear_games") {
          let clearedCount = 0;
          if (activeXOGames.has(channelId)) {
            activeXOGames.delete(channelId);
            clearedCount++;
          }
          if (activeRouletteGames.has(channelId)) {
            activeRouletteGames.delete(channelId);
            clearedCount++;
          }
          if (activeMafiaGames.has(channelId)) {
            activeMafiaGames.delete(channelId);
            clearedCount++;
          }
          if (activeLiarGames.has(channelId)) {
            activeLiarGames.delete(channelId);
            clearedCount++;
          }

          await channel.send("⚠️ **تنبيه:** تم تصفير وإلغاء جميع الألعاب النشطة في هذه القناة بواسطة مالك البوت من لوحة التحكم.");
          return res.json({ 
            success: true, 
            message: `تم إلغاء وتصفير الألعاب النشطة بنجاح! تم مسح ${clearedCount} لعبة جارية في هذه القناة.` 
          });
        }

        if (action === "launch_game") {
          const botId = client.user.id;
          if (gameType === "xo") {
            await startXO(fakeTrigger, botId);
          } else if (gameType === "roulette") {
            await startRoulette(fakeTrigger, botId, 2);
          } else if (gameType === "liar") {
            await startLiarLobby(fakeTrigger, botId);
          } else if (gameType === "mafia") {
            await startMafiaLobby(fakeTrigger, botId);
          } else {
            return res.status(400).json({ error: "نوع اللعبة غير معروف." });
          }
          return res.json({ success: true, message: `تم إطلاق طلب لعبة (${gameType}) بنجاح باسم البوت في القناة!` });
        }

        res.status(400).json({ error: "الإجراء غير معروف." });
      } catch (err: any) {
        console.error("❌ Error in /api/games/action:", err);
        res.status(500).json({ error: err.message });
      }
    });

    // Fallback for any other /api routes
    apiRouter.all("*", (req, res) => {
      console.warn(`[API] 404: ${req.method} ${req.url}`);
      res.status(404).json({ error: `Route not found: ${req.url}` });
    });

    app.use("/api", apiRouter);
    console.log("📡 API routes registered on /api/*");

    // Explicitly handle root and health
    app.get("/health", (req, res) => res.send("OK"));

    if (process.env.NODE_ENV !== "production") {
      try {
        console.log("✨ Initializing Vite server...");
        const vite = await createViteServer({
          server: { middlewareMode: true },
          appType: "spa",
        });
        app.use(vite.middlewares);
        console.log("✅ Vite middleware attached.");
      } catch (viteError: any) {
        console.error("❌ Vite initialization failed:", viteError);
      }
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }

    // Now start listening!
    const serverInstance = app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server listening on port ${PORT}`);
      if (DISCORD_TOKEN) {
        testConnection();
        client.login(DISCORD_TOKEN).catch(err => {
          botStatus.lastError = `Discord Login Error: ${err.message}`;
          console.error("❌ Failed to login to Discord:", err.message);
        });
      }
    });
  } catch (error: any) {
    console.error("❌ startServer Error:", error);
    botStatus.lastError = `Server Start Error: ${error.message}`;
  }
}

startServer().catch(err => {
  console.error("Fatal Server Error:", err);
});

// ==========================================
//           BOT GAMES MODULE SYSTEM
// ==========================================

const activeXOGames = new Map<string, any>();
const activeRouletteGames = new Map<string, any>();
const activeMafiaGames = new Map<string, any>();

// Generic Polymorphic Reply Helper
async function gameReply(trigger: any, options: any) {
  try {
    if (trigger.reply && typeof trigger.reply === "function") {
      if (trigger.deferred || trigger.replied) {
        return await trigger.editReply(options);
      }
      return await trigger.reply(options);
    } else {
      return await trigger.channel.send(options);
    }
  } catch (err) {
    console.error("Error in gameReply:", err);
  }
}

// Security: Award Tokens
async function rewardTokens(userId: string, amount: number) {
  try {
    const profile = await getUserProfile(userId);
    const userRef = doc(db, "users", userId);
    await setDoc(userRef, { tokens: profile.tokens + amount }, { merge: true });
    return profile.tokens + amount;
  } catch (error) {
    console.error("Error rewarding tokens:", error);
    return 0;
  }
}

// Deduct Tokens for Betting
async function deductTokens(userId: string, amount: number) {
  try {
    const profile = await getUserProfile(userId);
    const newBalance = Math.max(0, profile.tokens - amount);
    const userRef = doc(db, "users", userId);
    await setDoc(userRef, { tokens: newBalance }, { merge: true });
    return newBalance;
  } catch (error) {
    console.error("Error deducting tokens:", error);
    return 0;
  }
}

// ------------------------------------------
// 1. XO GAME SYSTEM (NO AI - HUMAN ONLY LOBBY)
// ------------------------------------------

function buildXOComponents(gameId: string, board: string[], disabledAll = false) {
  const rows: ActionRowBuilder<any>[] = [];
  for (let r = 0; r < 3; r++) {
    const row = new ActionRowBuilder<any>();
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      const cell = board[idx];
      const btn = new ButtonBuilder()
        .setCustomId(`xo_play_${gameId}_${idx}`)
        .setDisabled(disabledAll || cell !== " ");
      
      if (cell === "❌") {
        btn.setLabel("❌").setStyle(ButtonStyle.Danger);
      } else if (cell === "⭕") {
        btn.setLabel("⭕").setStyle(ButtonStyle.Success);
      } else {
        btn.setLabel("➖").setStyle(ButtonStyle.Secondary);
      }
      row.addComponents(btn);
    }
    rows.push(row);
  }
  return rows;
}

function checkXOWinner(board: string[]) {
  const winPatterns = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
    [0, 4, 8], [2, 4, 6]             // Diagonals
  ];
  for (const pattern of winPatterns) {
    if (board[pattern[0]] !== " " && board[pattern[0]] === board[pattern[1]] && board[pattern[0]] === board[pattern[2]]) {
      return board[pattern[0]];
    }
  }
  if (!board.includes(" ")) return "draw";
  return null;
}

async function startXO(trigger: any, challengerId: string, opponentId?: string) {
  const channelId = trigger.channel.id;
  const guildId = trigger.guild?.id || trigger.channel?.guild?.id || trigger.guildId;
  if (await isGamesDisabledForGuild(guildId)) {
    if (trigger.reply && typeof trigger.reply === "function" && trigger.isChatInputCommand?.()) {
      await trigger.reply({ content: "🔒 **تنبيه:** قائمة ونظام الألعاب معطل ومغلق حالياً في هذا السيرفر من قِبل الإدارة.", ephemeral: true }).catch(() => {});
    }
    return;
  }

  // Check if there is already an active game in this channel
  if (activeXOGames.has(channelId)) {
    return gameReply(trigger, { content: "⚠️ هناك جولة XO جارية بالفعل أو طلب معلّق في هذه القناة! يرجى الانتظار لحين الانتهاء." });
  }

  // Set initial game states
  const game = {
    id: channelId,
    p1: challengerId,
    p2: opponentId && opponentId !== "AI" ? opponentId : null,
    phase: "lobby",
    board: Array(9).fill(" "),
    turn: challengerId,
    timeLeft: 30, // 30 seconds countdown
    msg: null as any
  };

  activeXOGames.set(channelId, game);

  const embed = new EmbedBuilder()
    .setTitle("🎮 تحدي الإكس أو (XO) المشوّق")
    .setDescription(`⚔️ أهلاً بكم في صالون تحدي الإكس أو التفاعلي!\n\n🔴 **المتحدي الأول:** <@${challengerId}> (❌)\n🟢 **المنتظر:** ${game.p2 ? `<@${game.p2}>` : "أي عضو سريع وشجاع من السيرفر! 🧑‍🤝‍🧑"}\n\n${game.p2 ? `👉 تم توجيه منشن مخصص إلى <@${game.p2}> لقبول التحدي المباشر.` : "👉 انقر على زر **اللانضمام للتحدي 🎮** بالأسفل للنزول إلى الحلبة فوراً!"}\n\n⏳ ينتهي طلب التحدي تلقائياً بعد **30** ثانية.`)
    .setColor("#5865F2");

  const row = new ActionRowBuilder<any>().addComponents(
    new ButtonBuilder()
      .setCustomId(`xo_join_${channelId}`)
      .setLabel("انضمام للتحدي 🎮")
      .setStyle(ButtonStyle.Success)
  );

  const sentMsg = await gameReply(trigger, { embeds: [embed], components: [row] });
  game.msg = sentMsg;

  // Start the countdown timer for the lobby
  const interval = setInterval(async () => {
    const liveGame = activeXOGames.get(channelId);
    if (!liveGame || liveGame.phase !== "lobby") {
      clearInterval(interval);
      return;
    }

    liveGame.timeLeft -= 10;
    if (liveGame.timeLeft <= 0) {
      clearInterval(interval);
      activeXOGames.delete(channelId);
      try {
        const expiredEmbed = new EmbedBuilder()
          .setTitle("❌ انتهى وقت تحدي XO")
          .setDescription(`⚠️ تم إلغاء طلب لعبة الإكس أو (XO) لعدم استجابة أو انضمام أي منافس في الوقت المحدد (30 ثانية).`)
          .setColor("#E74C3C");
        await sentMsg.edit({ embeds: [expiredEmbed], components: [] });
      } catch (err) {
        console.error("Expired XO edit failed", err);
      }
    } else {
      try {
        const progressEmbed = new EmbedBuilder()
          .setTitle("🎮 تحدي الإكس أو (XO) المشوّق")
          .setDescription(`⚔️ أهلاً بكم في صالون تحدي الإكس أو التفاعلي!\n\n🔴 **المتحدي الأول:** <@${challengerId}> (❌)\n🟢 **المنتظر:** ${liveGame.p2 ? `<@${liveGame.p2}>` : "أي عضو سريع وشجاع من السيرفر! 🧑‍🤝‍🧑"}\n\n⏳ متبقي **${liveGame.timeLeft}** ثانية للاستجابة والانضمام!`)
          .setColor("#5865F2");
        await sentMsg.edit({ embeds: [progressEmbed] });
      } catch (err) {
        console.error("Progress XO edit failed", err);
      }
    }
  }, 10000);
}

async function handleXOButton(interaction: any) {
  const customId = interaction.customId; // "xo_play_channelId_idx" or "xo_join_channelId"
  const parts = customId.split("_");
  const actionType = parts[1]; // "play" or "join"

  if (actionType === "join") {
    const channelId = parts[2];
    const game = activeXOGames.get(channelId);
    if (!game || game.phase !== "lobby") {
      return interaction.reply({ content: "⚠️ انتهت صلاحية هذا التحدي بالفعل أو جرى حسمه مع لاعبين آخرين.", ephemeral: true });
    }

    if (interaction.user.id === game.p1) {
      return interaction.reply({ content: "⚠️ لا يمكنك قبول تحدي قمت بإنشائه بنفسك! تفاعل من بوابات أخرى.", ephemeral: true });
    }

    if (game.p2 && interaction.user.id !== game.p2) {
      return interaction.reply({ content: `⚠️ هذا التحدي مخصص للاعب <@${game.p2}> بشكل مباشر!`, ephemeral: true });
    }

    // Register P2
    game.p2 = interaction.user.id;
    game.phase = "active";
    game.turn = game.p1;

    const startEmbed = new EmbedBuilder()
      .setTitle("🎮 بدأت حركة معركة الإكس أو (XO)!")
      .setDescription(`⚔️ مواجهة مباشرة بين الخصمين الشرسين:\n\n🔴 **اللاعب الأول:** <@${game.p1}> (❌)\n🟢 **اللاعب الثاني:** <@${game.p2}> (⭕)\n\n👉 الدور الآن على البادئ: <@${game.p1}> لوضع النقطة الأولى!`)
      .setColor("#2ECC71");

    const rows = buildXOComponents(channelId, game.board);
    await interaction.update({ embeds: [startEmbed], components: rows });
    return;
  }

  if (actionType === "play") {
    const channelId = parts[2];
    const idx = parseInt(parts[3]);

    const game = activeXOGames.get(channelId);
    if (!game || game.phase !== "active") {
      return interaction.reply({ content: "⚠️ لم يتم العثور على اللعبة أو انتهت جولتها وحذفت.", ephemeral: true });
    }

    const { board, p1, p2, turn } = game;

    if (interaction.user.id !== turn) {
      return interaction.reply({ content: "⚠️ ليس دورك في تحريك الخلية حالياً! يرجى انتظار منافسك.", ephemeral: true });
    }

    // Set move
    board[idx] = (turn === p1) ? "❌" : "⭕";

    const winner = checkXOWinner(board);
    if (winner) {
      activeXOGames.delete(channelId);
      let resultText = "";
      let rewardText = "";

      if (winner === "draw") {
        resultText = "🤝 انتهى النزال بالتعادل التوافقي العادل! تفاعل وحماس رائع.";
      } else if (winner === "❌") {
        resultText = `🎉 ألف مبروك! الفائز والمنتقم الملحمي هو: <@${p1}>!`;
        const newBal = await rewardTokens(p1, 5);
        rewardText = `🪙 حصل <@${p1}> على **5** توكنات تفاعلية! رصيد التفاعل المحدث: **${newBal}**`;
      } else {
        resultText = `🎉 ألف مبروك! الفائز والمنتقم الملحمي هو: <@${p2}>!`;
        const newBal = await rewardTokens(p2, 5);
        rewardText = `🪙 حصل <@${p2}> على **5** توكنات تفاعلية! رصيد التفاعل المحدث: **${newBal}**`;
      }

      const endEmbed = new EmbedBuilder()
        .setTitle("🏁 حسمت معركة الـ XO!")
        .setDescription(`🔴 <@${p1}> ضد 🟢 <@${p2}>\n\n${resultText}\n${rewardText}`)
        .setColor("#2ECC71");

      const disabledRows = buildXOComponents(channelId, board, true);
      return await interaction.update({ embeds: [endEmbed], components: disabledRows });
    }

    // Swap turn
    game.turn = (turn === p1) ? p2 : p1;

    const nextEmbed = new EmbedBuilder()
      .setTitle("🎮 معركة الإكس أو (XO) الجارية")
      .setDescription(`🔴 **اللاعب الأول:** <@${p1}> (❌)\n🟢 **اللاعب الثاني:** <@${p2}> (⭕)\n\n👉 الدور الآن على: <@${game.turn}> لغرس ضربته في الحقل!`)
      .setColor("#5865F2");

    const rows = buildXOComponents(channelId, board);
    await interaction.update({ embeds: [nextEmbed], components: rows });
  }
}

// ------------------------------------------
// 2. MULTIPLAYER COLOR ROULETTE (NO AI - LOBBY)
// ------------------------------------------

async function startRoulette(trigger: any, hostId: string, betAmount: number) {
  const channelId = trigger.channel.id;
  const guildId = trigger.guild?.id || trigger.channel?.guild?.id || trigger.guildId;
  if (await isGamesDisabledForGuild(guildId)) {
    if (trigger.reply && typeof trigger.reply === "function" && trigger.isChatInputCommand?.()) {
      await trigger.reply({ content: "🔒 **تنبيه:** قائمة ونظام الألعاب معطل ومغلق حالياً في هذا السيرفر من قِبل الإدارة.", ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (activeRouletteGames.has(channelId)) {
    return gameReply(trigger, { content: "⚠️ هناك طاولة روليت مفتوحة بالفعل في هذه القناة! يرجى الانتظار لحين الانتهاء." });
  }

  // Check host profile to make sure they can afford it
  const profile = await getUserProfile(hostId);
  if (profile.tokens < betAmount) {
    return gameReply(trigger, { content: `⚠️ رصيدك الحالي من التوكنات هو **${profile.tokens}**، وهو غير كافٍ لدخول الرهان بـ **${betAmount}** توكن.` });
  }

  // Initialize group roulette state
  const game = {
    id: channelId,
    hostId,
    bet: betAmount,
    phase: "lobby",
    players: [] as { id: string; name: string; choice: "red" | "black" | "green" }[],
    timeLeft: 30, // 30 seconds countdown
    msg: null as any
  };

  activeRouletteGames.set(channelId, game);

  const embed = new EmbedBuilder()
    .setTitle("🎡 عجلة الروليت الجماعية الكبرى للتفاعل")
    .setDescription(`🎰 افتتح <@${hostId}> طاولة روليت مراهنة جماعية تفاعلية!\n\n` +
      `💰 **قيمة رهان الاشتراك كخصم:** \`${betAmount}\` توكن.\n\n` +
      `اضغط على الزر الملون بالأسفل للمراهنة وحجز تذكرتك فوراً:\n` +
      `🔴 **الأحمر (أرباح الضعف x2)**\n` +
      `⚫ **الأسود (أرباح الضعف x2)**\n` +
      `🟢 **الأخضر (الربح التاريخي والمميز x14)**\n\n` +
      `👥 **لوحة المراهنين المسجلين حتى الآن:**\n*لا يوجد مسجلون حالياً.*\n\n` +
      `⏳ تدور عجلة الحظ تلقائياً مع كافة الأعضاء خلال **30** ثانية!`)
    .setColor("#E67E22");

  const row = new ActionRowBuilder<any>().addComponents(
    new ButtonBuilder().setCustomId(`roul_join_${channelId}_red`).setLabel("الأحمر 🔴").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`roul_join_${channelId}_black`).setLabel("الأسود ⚫").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`roul_join_${channelId}_green`).setLabel("الأخضر 🟢").setStyle(ButtonStyle.Success)
  );

  const sentMsg = await gameReply(trigger, { embeds: [embed], components: [row] });
  game.msg = sentMsg;

  // Countdown Loop
  const interval = setInterval(async () => {
    const liveRoul = activeRouletteGames.get(channelId);
    if (!liveRoul || liveRoul.phase !== "lobby") {
      clearInterval(interval);
      return;
    }

    liveRoul.timeLeft -= 10;
    if (liveRoul.timeLeft <= 0) {
      clearInterval(interval);
      liveRoul.phase = "spinning";
      await spinRouletteWheel(channelId);
    } else {
      await updateRouletteLobbyEmbed(channelId);
    }
  }, 10000);
}

async function updateRouletteLobbyEmbed(channelId: string) {
  const game = activeRouletteGames.get(channelId);
  if (!game) return;

  const redPlayers = game.players.filter(p => p.choice === "red").map(p => `<@${p.id}>`).join(", ") || "لا أحد";
  const blackPlayers = game.players.filter(p => p.choice === "black").map(p => `<@${p.id}>`).join(", ") || "لا أحد";
  const greenPlayers = game.players.filter(p => p.choice === "green").map(p => `<@${p.id}>`).join(", ") || "لا أحد";

  const updateEmbed = new EmbedBuilder()
    .setTitle("🎡 عجلة الروليت الجماعية الكبرى للتفاعل")
    .setDescription(`🎰 طاولة روليت تفاعلية جارية الآن مع الأعضاء!\n\n` +
      `💰 **قيمة تذكرة الرهان:** \`${game.bet}\` توكن.\n\n` +
      `👥 **لوحة الأعضاء وتصنيفاتهم الملونة:**\n` +
      `🔴 **الأحمر:** ${redPlayers}\n` +
      `⚫ **الأسود:** ${blackPlayers}\n` +
      `🟢 **الأخضر:** ${greenPlayers}\n\n` +
      `⏳ تدور العجلة وتتوقف تلقائياً خلال **${game.timeLeft}** ثانية!`)
    .setColor("#E67E22");

  try {
    await game.msg.edit({ embeds: [updateEmbed] });
  } catch (err) {
    console.error("Failed to edit roulette lobby", err);
  }
}

async function spinRouletteWheel(channelId: string) {
  const game = activeRouletteGames.get(channelId);
  if (!game) return;

  if (game.players.length === 0) {
    activeRouletteGames.delete(channelId);
    try {
      const cancelEmbed = new EmbedBuilder()
        .setTitle("❌ ألغيت طاولة الروليت")
        .setDescription("⚠️ لم تسجل مراهنات من الأعضاء على الطاولة خلال الـ 30 ثانية المنقضية، تم إغلاقها.")
        .setColor("#E74C3C");
      await game.msg.edit({ embeds: [cancelEmbed], components: [] });
    } catch (err) {
      console.log(err);
    }
    return;
  }

  // Spin step 
  try {
    const spinEmbed = new EmbedBuilder()
      .setTitle("🌀 تدور عجلة روليت الحظ الكبرى...!")
      .setDescription(`💫 الكرة تكمل لفتها السريعة فوق الأرقام والقرعات...\n\n🔊 انتظر قليلاً، جاري سحب اللائحة وتثبيت الرابحين الخارقين! ⏳`)
      .setColor("#9B59B6");
    await game.msg.edit({ embeds: [spinEmbed], components: [] });
  } catch (err) {
    console.log(err);
  }

  setTimeout(async () => {
    const finalGame = activeRouletteGames.get(channelId);
    if (!finalGame) return;
    activeRouletteGames.delete(channelId);

    const luckyNum = Math.floor(Math.random() * 37);
    let winningColor: "red" | "black" | "green" = "green";
    let colorArabic = "🟢 الأخضر (الصفر المميز)";

    if (luckyNum > 0) {
      if (luckyNum % 2 === 1) {
        winningColor = "red";
        colorArabic = "🔴 الأحمر";
      } else {
        winningColor = "black";
        colorArabic = "⚫ الأسود";
      }
    }

    let winningText = "";
    let losingText = "";

    const winners = finalGame.players.filter(p => p.choice === winningColor);
    const losers = finalGame.players.filter(p => p.choice !== winningColor);

    const multiplier = winningColor === "green" ? 14 : 2;
    const payout = finalGame.bet * multiplier;

    for (const w of winners) {
      const newBal = await rewardTokens(w.id, payout);
      winningText += `🏆 <@${w.id}> فاز بـ **${payout}** توكن! (رصيده الآن: **${newBal}**)\n`;
    }

    for (const l of losers) {
      const currentBal = await getUserProfile(l.id).then(p => p.tokens);
      losingText += `▫️ <@${l.id}> فقد رهان **${finalGame.bet}** توكن (رصيده الآن: **${currentBal}**)\n`;
    }

    const reportEmbed = new EmbedBuilder()
      .setTitle("🎡 report نتيجة عجلة الروليت الحاسم!")
      .setDescription(`🎯 **توقفت المقذوفة رسمياً عن الدوران!**\n\n🎯 **القرص والنتيجة:** الرقم \`${luckyNum}\` المنسوب لـ (${colorArabic})\n\n` +
        `🏆 **سجل الرابحين المحظوظين:**\n${winningText || "*لا يوجد رابحون في هذه اللفة العاصفة.*\n"}\n` +
        `💸 **سجل الخاسرين:**\n${losingText || "*لم يسجل أي خاسر بفضل ذكاء الاختيارات!*\n"}`)
      .setColor(winningColor === "red" ? "#C0392B" : winningColor === "black" ? "#2C3E50" : "#2ECC71");

    try {
      await finalGame.msg.reply({ embeds: [reportEmbed] });
    } catch (err) {
      console.error(err);
    }
  }, 4000);
}

async function handleRouletteButton(interaction: any) {
  const parts = interaction.customId.split("_");
  const actionType = parts[1]; // "join"

  if (actionType === "join") {
    const channelId = parts[2];
    const choice = parts[3] as "red" | "black" | "green";

    const game = activeRouletteGames.get(channelId);
    if (!game || game.phase !== "lobby") {
      return interaction.reply({ content: "⚠️ طاولة روليت الحجوزات جرى قفلها وبدأت الدوران الفعلية للكرة!", ephemeral: true });
    }

    const alreadyJoined = game.players.find(p => p.id === interaction.user.id);
    if (alreadyJoined) {
      return interaction.reply({ content: `⚠️ عذراً! حجزت مسبقاً في طاولة دوران هذه اللفة على اللون \`${alreadyJoined.choice.toUpperCase()}\`! يمنع تكرار المراهنة.`, ephemeral: true });
    }

    const profile = await getUserProfile(interaction.user.id);
    if (profile.tokens < game.bet) {
      return interaction.reply({ content: `❌ رصيدك الحالي (${profile.tokens}) غير كافٍ لتذكرة اشتراك الرهان بقيمة: **${game.bet}** توكن.`, ephemeral: true });
    }

    // Deduct immediately on registration to lock bets securely
    await deductTokens(interaction.user.id, game.bet);

    game.players.push({
      id: interaction.user.id,
      name: interaction.member?.displayName || interaction.user.username,
      choice
    });

    await interaction.reply({ content: `✅ تم تأكيد حجز مقعدك للمراهنة بنجاح على اللون **${choice === 'red' ? '🔴 الأحمر' : choice === 'black' ? '⚫ الأسود' : '🟢 الأخضر'}** بقيمة **${game.bet}** توكن. بالتوفيق وحظاً سعيداً!`, ephemeral: true });

    // Instantly update the parent message lobby list
    await updateRouletteLobbyEmbed(channelId);
  }
}

// ------------------------------------------
// 3. MULTIPLAYER / VS BOT MAFIA SYSTEM
// ------------------------------------------

interface MafiaPlayer {
  id: string;
  name: string;
  role: "mafia" | "doctor" | "detective" | "citizen";
  alive: boolean;
}

interface MafiaGame {
  id: string;
  guildId: string;
  channelId: string;
  hostId: string;
  players: MafiaPlayer[];
  phase: "lobby" | "night" | "day_voting";
  nightChoices: {
    kill?: string;
    save?: string;
    spy?: string;
  };
  votes: { [voterId: string]: string };
  round: number;
  timeLeft: number;
  msg: any;
}

async function launchMafiaGame(game: MafiaGame) {
  // Shuffle and assign secret roles
  const roles: ("mafia" | "doctor" | "detective" | "citizen")[] = ["mafia", "doctor", "detective"];
  while (roles.length < game.players.length) {
    roles.push("citizen");
  }
  
  // Shuffle roles array
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  // Assign roles
  for (let i = 0; i < game.players.length; i++) {
    game.players[i].role = roles[i];
  }

  // Kickstart night phase
  await startMafiaNightPhase(null, game);
}

async function startMafiaLobby(trigger: any, hostId: string) {
  const channelId = trigger.channel.id;
  const guildId = trigger.guild?.id || trigger.channel?.guild?.id || trigger.guildId;

  if (await isGamesDisabledForGuild(guildId)) {
    if (trigger.reply && typeof trigger.reply === "function" && trigger.isChatInputCommand?.()) {
      await trigger.reply({ content: "🔒 **تنبيه:** قائمة ونظام الألعاب معطل ومغلق حالياً في هذا السيرفر من قِبل الإدارة.", ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (activeMafiaGames.has(channelId)) {
    return gameReply(trigger, { content: "⚠️ هناك جلسة سهرة مافيا مجهزة أو جارية بالفعل في هذه القناة! انتظر إقفالها." });
  }

  // Setup game state
  const game: MafiaGame = {
    id: channelId,
    guildId,
    channelId,
    hostId,
    players: [{ id: hostId, name: trigger.member?.displayName || trigger.user?.username || "المضيف", role: "citizen", alive: true }],
    phase: "lobby",
    nightChoices: {},
    votes: {},
    round: 1,
    timeLeft: 60, // 60 seconds lobby wait
    msg: null
  };

  activeMafiaGames.set(channelId, game);

  const lobbyEmbed = new EmbedBuilder()
    .setTitle("🎪 سهرة لعبة المافيا البشرية التفاعلية")
    .setDescription(`مرحباً بكم في صالون التحقيق والشك الكامل السري!\n\n👑 **منظم السهرة:** <@${hostId}>\n👥 **المشاركون المنضمون حتى الآن:**\n- <@${hostId}>\n\n🚨 **الحد الأدنى للعب هو 4 أعضاء بشرية.** اللعبة لا تحتوي على أي ذكاء اصطناعي أو بوتات لضمان أعلى مستويات التحدي والذكاء!\n\n⏳ ينتهي حجز الحضور وتبدأ القرعة تلقائياً خلال **60** ثانية!`)
    .setColor("#E74C3C");

  const row = new ActionRowBuilder<any>().addComponents(
    new ButtonBuilder().setCustomId(`mafia_join_${channelId}`).setLabel("الانضمام للسهرة 🎪").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`mafia_start_${channelId}`).setLabel("بدء اللعبة الآن ⚔️").setStyle(ButtonStyle.Danger)
  );

  const sentMsg = await gameReply(trigger, { embeds: [lobbyEmbed], components: [row] });
  game.msg = sentMsg;

  // Lobby Countdown interval (60 seconds, updates every 10s)
  const interval = setInterval(async () => {
    const liveGame = activeMafiaGames.get(channelId);
    if (!liveGame || liveGame.phase !== "lobby") {
      clearInterval(interval);
      return;
    }

    liveGame.timeLeft -= 10;
    if (liveGame.timeLeft <= 0) {
      clearInterval(interval);
      if (liveGame.players.length < 4) {
        activeMafiaGames.delete(channelId);
        try {
          const failEmbed = new EmbedBuilder()
            .setTitle("❌ ألغيت سهرة مافيا")
            .setDescription(`⚠️ عذراً! انقضت الـ 60 ثانية ولم يكتمل الحد الأدنى (4 لاعبين). عدد المسجلين الحالي: **${liveGame.players.length}** أعضاء. تم إلغاء السهرة للأسف!`)
            .setColor("#C0392B");
          await liveGame.msg.edit({ embeds: [failEmbed], components: [] });
        } catch (err) {
          console.error(err);
        }
      } else {
        // Auto start
        await launchMafiaGame(liveGame);
      }
    } else {
      try {
        const plist = liveGame.players.map((p, idx) => `**${idx+1}.** <@${p.id}>`).join("\n");
        const progressEmbed = new EmbedBuilder()
          .setTitle("🎪 سهرة لعبة المافيا البشرية التفاعلية")
          .setDescription(`مرحباً بكم في صالون التحقيق والشك الكامل السري!\n\n👑 **منظم السهرة:** <@${liveGame.hostId}>\n👥 **المشاركون المنضمون حتى الآن:**\n${plist}\n\n⏳ متبقي **${liveGame.timeLeft}** ثانية للاشتراك وجمع الشمل! (الحد الأدنى 4، الأقصى 10)`)
          .setColor("#E74C3C");
        await liveGame.msg.edit({ embeds: [progressEmbed] });
      } catch (err) {
        console.error(err);
      }
    }
  }, 10000);
}

async function handleMafiaButtons(interaction: any) {
  const customId = interaction.customId;
  const channelId = interaction.channelId;
  const game = activeMafiaGames.get(channelId);

  if (!game) {
    return interaction.reply({ content: "⚠️ لم يتم العثور على سهرة مافيا نشطة في هذه القناة.", ephemeral: true });
  }

  if (customId.startsWith("mafia_join_")) {
    const alreadyIn = game.players.some(p => p.id === interaction.user.id);
    if (alreadyIn) {
      return interaction.reply({ content: "🙋‍♂️ أنت مسجل ومشارك في سهرة مافيا الحالية بالفعل!", ephemeral: true });
    }
    if (game.players.length >= 10) {
      return interaction.reply({ content: "⚠️ صالون سهرة المافيا ممتلئ تماماً حالياً (الحد الأقصى 10 أشخاص)!", ephemeral: true });
    }

    game.players.push({
      id: interaction.user.id,
      name: interaction.member?.displayName || interaction.user.username,
      role: "citizen",
      alive: true
    });

    const plist = game.players.map((p, idx) => `**${idx+1}.** <@${p.id}>`).join("\n");
    const updatedEmbed = new EmbedBuilder()
      .setTitle("🎪 سهرة لعبة المافيا البشرية التفاعلية")
      .setDescription(`مرحباً بكم في صالون التحقيق والشك الكامل السري!\n\n👑 **منظم السهرة:** <@${game.hostId}>\n👥 **المشاركون المنضمون حتى الآن:**\n${plist}\n\n⏳ متبقي **${game.timeLeft}** ثانية للاشتراك وجمع الشمل!`)
      .setColor("#E74C3C");

    await interaction.update({ embeds: [updatedEmbed] });
  }

  else if (customId.startsWith("mafia_start_")) {
    if (interaction.user.id !== game.hostId) {
      return interaction.reply({ content: "⚠️ المضيف ومنظم السهرة وحده من يمتلك صلاحية بدء المواجهة اليدوية!", ephemeral: true });
    }

    if (game.players.length < 4) {
      return interaction.reply({ content: `⚠️ لا يمكن إطلاق القرعة وتوزيع الأدوار قبل تسجيل **4** لاعبين بشر على الأقل! العدد الحالي: **${game.players.length}**`, ephemeral: true });
    }

    await launchMafiaGame(game);
  }

  else if (customId.startsWith("mafia_night_action_")) {
    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || !player.alive) {
      return interaction.reply({ content: "⚠️ لا ينطبق عليك هذا الإجراء لأنك غادرت الحياة أو لم تسجل بالسهرة مسبقاً!", ephemeral: true });
    }

    const aliveOthers = game.players.filter(p => p.alive && p.id !== player.id);
    const aliveAll = game.players.filter(p => p.alive);

    if (player.role === "citizen") {
      return interaction.reply({ content: "💤 أنت مواطن صالح ومخلص للعدالة. أنت مستمر بالنوم الهادئ لاستعادة التكتيك في الصباح!", ephemeral: true });
    }

    if (player.role === "mafia") {
      const options = aliveOthers.map(p => ({ label: p.name, value: p.id, description: `اغتيال اللاعب ${p.name}` }));
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`mafia_sec_${game.id}_kill`)
        .setPlaceholder("اختر الضحية لاغتيالها الليلة")
        .addOptions(options);
      const row = new ActionRowBuilder<any>().addComponents(menu);
      return interaction.reply({ content: "🦹 **سري للمافيا:** اختر الهدف الذي تود تصفيته وإسكاته الليلة بسرك:", components: [row], ephemeral: true });
    }

    if (player.role === "doctor") {
      const options = aliveAll.map(p => ({ label: p.name, value: p.id, description: `حماية وعلاج اللاعب ${p.name}` }));
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`mafia_sec_${game.id}_save`)
        .setPlaceholder("اختر لاعباً لحمايته وعلاجه")
        .addOptions(options);
      const row = new ActionRowBuilder<any>().addComponents(menu);
      return interaction.reply({ content: "🩺 **سري للطبيب والمنقذ:** اختر الروح التي تمنحها العناية والإنقاذ من الاغتيال المحدق الليلة:", components: [row], ephemeral: true });
    }

    if (player.role === "detective") {
      const options = aliveOthers.map(p => ({ label: p.name, value: p.id, description: `فحص هوية اللاعب ${p.name}` }));
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`mafia_sec_${game.id}_spy`)
        .setPlaceholder("اختر لاعباً لتقصي هويته السرية")
        .addOptions(options);
      const row = new ActionRowBuilder<any>().addComponents(menu);
      return interaction.reply({ content: "🕵️ **سري للمحقق والتقصي:** اختر الشخصية المشبوهة لكشف هوية الفريق التنويري لها ليلة بأمان:", components: [row], ephemeral: true });
    }
  }
}

async function handleMafiaSelectMenus(interaction: any) {
  const customId = interaction.customId;
  const channelId = interaction.channelId;
  const game = activeMafiaGames.get(channelId);

  if (!game) {
    return interaction.reply({ content: "⚠️ لم يتم العثور على سهرة مافيا جارية.", ephemeral: true });
  }

  if (customId.startsWith("mafia_sec_")) {
    const val = interaction.values[0];
    const parts = customId.split("_");
    const actionType = parts[3]; // "kill", "save", "spy"

    if (actionType === "kill") {
      game.nightChoices.kill = val;
      await interaction.reply({ content: `✅ اعتمدت تصفية الضحية: **${game.players.find(p => p.id === val)?.name}**. سنراهم بالصباح!`, ephemeral: true });
    } else if (actionType === "save") {
      game.nightChoices.save = val;
      await interaction.reply({ content: `✅ اعتمدت حماية وتطبيب اللاعب: **${game.players.find(p => p.id === val)?.name}** بنجاح.`, ephemeral: true });
    } else if (actionType === "spy") {
      game.nightChoices.spy = val;
      const targetRole = game.players.find(p => p.id === val)?.role;
      const isMafiaStr = targetRole === "mafia" ? "⚠️ مافيا شرير وخبيث!" : "✅ مواطن صالح نقي.";
      await interaction.reply({ content: `🕵️ **تقرير المحقق السري:** اللاعب **${game.players.find(p => p.id === val)?.name}** حقيقته هي: **${isMafiaStr}**`, ephemeral: true });
    }

    // Process game if all humans submitted or bot logic takes over
    await processMafiaNightFinished(interaction, game);
  }

  else if (customId.startsWith("mafia_vote_")) {
    const votedForId = interaction.values[0];
    const voterId = interaction.user.id;

    const voter = game.players.find(p => p.id === voterId);
    if (!voter || !voter.alive) {
      return interaction.reply({ content: "⚠️ الموتى والأشباح لا يمكنهم كتابة أوراق الاقتراع في قوانين المحاكمة السيرفرية!", ephemeral: true });
    }

    game.votes[voterId] = votedForId;
    const votedName = game.players.find(p => p.id === votedForId)?.name;
    await interaction.reply({ content: `🗳️ تم تسجيل صوتك للإطاحة بـ: **${votedName}**!`, ephemeral: true });

    // Check if everyone has voted
    const alivePlayers = game.players.filter(p => p.alive);
    const totalVotesCast = Object.keys(game.votes).length;

    if (totalVotesCast >= alivePlayers.length) {
      await processMafiaVotingResults(interaction, game);
    }
  }
}

async function startMafiaNightPhase(interaction: any, game: MafiaGame) {
  game.phase = "night";
  game.nightChoices = {};
  game.votes = {};

  const embed = new EmbedBuilder()
    .setTitle(`🌃 الغرفة الليلية - سهرة مافيا (الجولة: ${game.round})`)
    .setDescription(`🌌 **أسدل الستار وحل الليل الدامس على ساحة القرية...**\n\n🎯 **التعليمات السرية للأعضاء:**\n1️⃣ انقر على زر **🔐 صندوق أدوارك السري** للدخول إلى الإجراءات الشخصية الفعالة.\n2️⃣ قم باجتياز عمليتك السريعة لإنقاذ أو فضح الخصم.\n\n⏳ ينتهي الليل تلقائياً ويفسح الصباح خيوطه بعد **40** ثانية!`)
    .setColor("#2C3E50");

  const row = new ActionRowBuilder<any>().addComponents(
    new ButtonBuilder().setCustomId(`mafia_night_action_${game.id}`).setLabel("🔐 صندوق أدوارك السري").setStyle(ButtonStyle.Primary)
  );

  const targetChannel = client.channels.cache.get(game.channelId) as any;
  if (targetChannel) {
    try {
      await targetChannel.send({ embeds: [embed], components: [row] });
    } catch (err) {
      console.error(err);
    }
  }

  // Night phase fail-safe timer (40 seconds)
  setTimeout(async () => {
    const updatedGame = activeMafiaGames.get(game.id);
    if (updatedGame && updatedGame.phase === "night") {
      await processMafiaNightFinished(null, updatedGame, true);
    }
  }, 40000);
}

async function processMafiaNightFinished(interaction: any, game: MafiaGame, forceTimeOut = false) {
  // Check if all alive special roles made their lock
  const aliveHumanRoles = game.players.filter(p => p.alive && p.role !== "citizen");
  
  let allReady = true;
  for (const p of aliveHumanRoles) {
    if (p.role === "mafia" && !game.nightChoices.kill) allReady = false;
    if (p.role === "doctor" && !game.nightChoices.save) allReady = false;
    if (p.role === "detective" && !game.nightChoices.spy) allReady = false;
  }

  if (!allReady && !forceTimeOut) return; // Wait for actions

  // Night Outcome Evaluation
  const victimId = game.nightChoices.kill;
  const savedId = game.nightChoices.save;

  let morningText = "";
  if (victimId) {
    if (victimId === savedId) {
      morningText = `😇 **كانت ليلة هادئة للغاية!** بفضل حكمة وتفاني الطبيب البطل المخلص، تم تلافي الكارثة وصيانة القرية دون تسجيل وفيات!`;
    } else {
      const victim = game.players.find(p => p.id === victimId);
      if (victim) {
        victim.alive = false;
        morningText = `💀 **صباح بائس ومبكي!** استيقظ أهالي القرية على دماء في الساحة وسقط اللاعب الشهير **${victim.name}** مقتولاً بأيدي عصابات المافيا!`;
      }
    }
  } else {
    morningText = `🕊️ ليلة آمنة ونقية، لم تنجح المافيا في ترك بصمتها الدموية هذه الليلة!`;
  }

  // Check Win conditions
  const ended = await checkMafiaEndConditions(interaction, game, morningText);
  if (ended) return;

  // Transition to voting
  game.phase = "day_voting";
  await startMafiaDayVoting(interaction, game, morningText);
}

async function startMafiaDayVoting(interaction: any, game: MafiaGame, morningAnnouncement: string) {
  const alivePlayers = game.players.filter(p => p.alive);

  const embed = new EmbedBuilder()
    .setTitle(`🗳️ تصويت المحكمة المفتوحة - لعبة مافيا (الدورة: ${game.round})`)
    .setDescription(`${morningAnnouncement}\n\n🚨 **الرجاء الإجماع والتشاور لتحديد المشتبه به بكونه المافيا:**\nالتصويت الفردي عبر القائمة المنسدلة بالأسفل للتخلص منه ونصرة الأتقياء!`)
    .setColor("#F1C40F");

  const options = alivePlayers.map(p => ({ label: p.name, value: p.id, description: `التصويت لطرد ${p.name}` }));
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`mafia_vote_${game.id}`)
    .setPlaceholder("من برأيك المافيا الشرير؟ صوت هنا!")
    .addOptions(options);

  const row = new ActionRowBuilder<any>().addComponents(menu);

  const targetChannel = client.channels.cache.get(game.channelId) as any;
  if (targetChannel) {
    try {
      await targetChannel.send({ embeds: [embed], components: [row] });
    } catch (err) {
      console.error(err);
    }
  }

  // Force-settle voting if timer expires (e.g. 50 seconds)
  setTimeout(async () => {
    const updatedGame = activeMafiaGames.get(game.id);
    if (updatedGame && updatedGame.phase === "day_voting") {
      await processMafiaVotingResults(interaction, updatedGame, true);
    }
  }, 50000);
}

async function processMafiaVotingResults(interaction: any, game: MafiaGame, forceTimeOut = false) {
  // Calculate vote totals from actual human votes
  const voteCounts: { [userId: string]: number } = {};
  for (const v of Object.values(game.votes)) {
    voteCounts[v] = (voteCounts[v] || 0) + 1;
  }

  let lynchedId = "";
  let maxVotes = 0;
  for (const [uid, count] of Object.entries(voteCounts)) {
    if (count > maxVotes) {
      maxVotes = count;
      lynchedId = uid;
    }
  }

  let lynchText = "";
  if (lynchedId) {
    const victim = game.players.find(p => p.id === lynchedId);
    if (victim) {
      victim.alive = false;
      const roleArabic = victim.role === 'mafia' ? '🦹 مافيا شرير وخبيث!' : victim.role === 'doctor' ? '🩺 طبيب القرية' : victim.role === 'detective' ? '🕵️ محقق حكيم' : '🧑‍🌾 مواطن صالح وثاق';
      lynchText = `📢 **صدور الحكم بموجب قرار الأغلبية الشورية!**\nعقدت المحكمة الميدانية وعقرت حبل الإطاحة والشنق على اللاعب **${victim.name}**!\n🕵️‍♂️ وبعد نزع اللثام عنه، تبيّن لجميع الحضور أنه كان: **${roleArabic}**!`;
    }
  } else {
    lynchText = "📢 خيم الصمت والرهبة على ساحة الحوار، ولم يحظ أي شريك على إجماع وبقي الجميع دون إعدام!";
  }

  const ended = await checkMafiaEndConditions(interaction, game, lynchText);
  if (ended) return;

  // Next Round
  game.round++;
  await startMafiaNightPhase(interaction, game);
}

async function checkMafiaEndConditions(interaction: any, game: MafiaGame, descriptionHeader: string): Promise<boolean> {
  const mafiaAlive = game.players.some(p => p.role === "mafia" && p.alive);
  const citizensAliveCount = game.players.filter(p => p.role !== "mafia" && p.alive).length;

  let winnerText = "";
  let endColor: any = "";
  let wonTeam: "mafia" | "citizens" | null = null;

  if (!mafiaAlive) {
    winnerText = "🎉 **تحيا العدالة والنقاء! لقد فاز المواطنون الشرفاء باللعبة والحرية!** 🎉\nتخلصت القرية من طفيليات المافيا الشريرة ورفعت راية الأمان والحرية.";
    endColor = "#2ECC71";
    wonTeam = "citizens";
  } else if (citizensAliveCount <= 1) {
    winnerText = "🦹 **سقطت القرية بأيدي الرعب والشر! فوز كاسح لعصابات المافيا المتخفية!** 🦹\nالمافيا سيطرت على زمام الساحة الشورية ولا مهرب لقلائل الصالحين.";
    endColor = "#C0392B";
    wonTeam = "mafia";
  }

  if (wonTeam) {
    activeMafiaGames.delete(game.id);

    // List out and reward survivors
    const statusLines = game.players.map(p => {
      const icon = p.alive ? "🟢" : "💀";
      const team = p.role === 'mafia' ? 'مافيا' : 'شريف/مواطن';
      return `${icon} **${p.name}** (دور: ${p.role.toUpperCase()})`;
    }).join("\n");

    // Award rewards
    let rewardLine = "";
    if (wonTeam === "citizens") {
      const activeHumans = game.players.filter(p => p.role !== "mafia");
      for (const h of activeHumans) {
        await rewardTokens(h.id, 5);
      }
      rewardLine = "🪙 تم منح كافة المواطنين الشرفاء من البشر **5** توكنات تفصيلية تفاعلية تفوقاً للذكاء الإنساني!";
    } else {
      const activeHumans = game.players.filter(p => p.role === "mafia");
      for (const h of activeHumans) {
        await rewardTokens(h.id, 8);
      }
      if (activeHumans.length > 0) {
        rewardLine = "🪙 تم منح المافيا الشجاع المنتصر **8** توكنات تفاعلية تكريماً للمخطط البارع!";
      }
    }

    const embed = new EmbedBuilder()
      .setTitle("🏁 انتهت سهرة المافيا الإنسانية!")
      .setDescription(`${descriptionHeader}\n\n${winnerText}\n\n${rewardLine}\n\n🎮 **سجلات وأدوار المواجهة:**\n${statusLines}`)
      .setColor(endColor);

    const targetChannel = client.channels.cache.get(game.channelId) as any;
    if (targetChannel) {
      try {
        await targetChannel.send({ embeds: [embed] });
      } catch (err) {
        console.error(err);
      }
    }
    return true;
  }

  return false;
}

// ------------------------------------------
// ROUTERS FOR INTERACTION CONTROLS
// ------------------------------------------

async function handleGameButtons(interaction: any) {
  try {
    const customId = interaction.customId;
    if (customId.startsWith("xo_")) {
      await handleXOButton(interaction);
    } else if (customId.startsWith("roul_")) {
      await handleRouletteButton(interaction);
    } else if (customId.startsWith("mafia_")) {
      await handleMafiaButtons(interaction);
    } else if (customId.startsWith("liar_")) {
      await handleLiarButtons(interaction);
    } else if (customId.startsWith("gamesconsole_")) {
      await handleGamesConsoleButtons(interaction);
    }
  } catch (err) {
    console.error("Error in handleGameButtons:", err);
    await interaction.reply({ content: "⚠️ حدث خطأ فني أثناء اللعب بالزر تداركه لاحقاً.", ephemeral: true }).catch(() => {});
  }
}

async function handleGameSelectMenus(interaction: any) {
  try {
    const customId = interaction.customId;
    if (customId.startsWith("mafia_")) {
      await handleMafiaSelectMenus(interaction);
    } else if (customId.startsWith("liar_")) {
      await handleLiarSelectMenus(interaction);
    }
  } catch (err) {
    console.error("Error in handleGameSelectMenus:", err);
    await interaction.reply({ content: "⚠️ حدث خطأ فني بالمحكمة، يرجى التمهل والمحاولة بوضوح.", ephemeral: true }).catch(() => {});
  }
}

// ==========================================
//           WHO IS THE LIAR? (من الكاذب؟) Game Module
// ==========================================

const activeLiarGames = new Map<string, any>();

const LIAR_WORD_PAIRS = {
  easy: [
    { word1: "تفاح", word2: "سيارة" },
    { word1: "موز", word2: "طائرة" },
    { word1: "ماء", word2: "نار" },
    { word1: "كتاب", word2: "مسجد" },
    { word1: "منزل", word2: "بحر" },
    { word1: "راديو", word2: "ملعقة" },
    { word1: "حليب", word2: "تراب" },
    { word1: "هاتف", word2: "قلم" },
    { word1: "شمس", word2: "ثلج" },
    { word1: "جبل", word2: "سفينة" },
    { word1: "طماطم", word2: "كرسي" },
    { word1: "فستان", word2: "شاش" },
    { word1: "سماء", word2: "عشب" },
    { word1: "قمر", word2: "ساعة" },
    { word1: "تلفزيون", word2: "خاتم" }
  ],
  medium: [
    { word1: "تفاح", word2: "إجاص" },
    { word1: "موز", word2: "مانجو" },
    { word1: "قهوة", word2: "شاي" },
    { word1: "هاتف", word2: "لابتوب" },
    { word1: "كرة قدم", word2: "كرة سلة" },
    { word1: "قطة", word2: "كلب" },
    { word1: "حصان", word2: "حمار وحشي" },
    { word1: "طبيب", word2: "ممرض" },
    { word1: "بيتزا", word2: "برجر" },
    { word1: "سيارة", word2: "دراجة نارية" },
    { word1: "أسد", word2: "نمر" },
    { word1: "طائرة مدنية", word2: "مروحية" },
    { word1: "مدرسة", word2: "جامعة" },
    { word1: "سوق", word2: "سوبرماركت" },
    { word1: "صيدلية", word2: "مستشفى" }
  ],
  hard: [
    { word1: "شاي أخضر", word2: "شاي أحمر" },
    { word1: "لابتوب", word2: "كمبيوتر مكتبي" },
    { word1: "عصير برتقال", word2: "عصير ليمون" },
    { word1: "ساعة يد", word2: "ساعة جدار" },
    { word1: "دفتر ضريبة", word2: "دفتر مذكرات" },
    { word1: "دب قطبي", word2: "دب بني" },
    { word1: "بحر", word2: "محيط" },
    { word1: "قلعة", word2: "قصر" },
    { word1: "رائد فضاء", word2: "طيار مدني" },
    { word1: "شاحنة", word2: "حافلة" },
    { word1: "تذكرة سفر", word2: "جواز سفر" },
    { word1: "شامبو", word2: "صابون" },
    { word1: "نظافة", word2: "تعقيم" },
    { word1: "نهر", word2: "بحيرة" }
  ]
};

async function startLiarLobby(trigger: any, hostId: string) {
  const channelId = trigger.channel.id;
  const guildId = trigger.guild?.id || trigger.channel?.guild?.id || trigger.guildId;

  if (await isGamesDisabledForGuild(guildId)) {
    if (trigger.reply && typeof trigger.reply === "function" && trigger.isChatInputCommand?.()) {
      await trigger.reply({ content: "🔒 **تنبيه:** قائمة ونظام الألعاب معطل ومغلق حالياً في هذا السيرفر من قِبل الإدارة.", ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (activeLiarGames.has(channelId)) {
    return gameReply(trigger, { content: "⚠️ هناك جلسة سهرة 'من الكاذب؟' مجهزة أو جارية بالفعل في هذه القناة! انتظر إقفالها." });
  }

  const game = {
    id: channelId,
    guildId,
    channelId,
    hostId,
    players: [{ id: hostId, name: trigger.member?.displayName || trigger.user?.username || "المضيف", role: "citizen", alive: true }],
    phase: "lobby",
    difficulty: "medium",
    useSpecialRoles: false,
    word1: "",
    word2: "",
    timeLeft: 60,
    msg: null,
    votes: {},
    revealed: {},
    detectiveInvestigated: null
  };

  activeLiarGames.set(channelId, game);

  const embed = buildLiarLobbyEmbed(game);
  const rows = buildLiarLobbyButtons(game);

  const sentMsg = await gameReply(trigger, { embeds: [embed], components: rows });
  game.msg = sentMsg;

  // Lobby Countdown interval (60 seconds, updates every 10s)
  const interval = setInterval(async () => {
    const liveGame = activeLiarGames.get(channelId);
    if (!liveGame || liveGame.phase !== "lobby") {
      clearInterval(interval);
      return;
    }

    liveGame.timeLeft -= 10;
    if (liveGame.timeLeft <= 0) {
      clearInterval(interval);
      if (liveGame.players.length < 3) {
        activeLiarGames.delete(channelId);
        try {
          const failEmbed = new EmbedBuilder()
            .setTitle("❌ ألغيت سهرة 'من الكاذب؟'")
            .setDescription(`⚠️ عذراً! انتهى الوقت ولم يكتمل الحد الأدنى (3 لاعبين). عدد المسجلين الحالي: **${liveGame.players.length}**. تم إلغاء السهرة!`)
            .setColor("#C0392B");
          await liveGame.msg.edit({ embeds: [failEmbed], components: [] });
        } catch (err) {
          console.error(err);
        }
      } else {
        await launchLiarGame(liveGame);
      }
    } else {
      try {
        const updatedEmbed = buildLiarLobbyEmbed(liveGame);
        await liveGame.msg.edit({ embeds: [updatedEmbed] });
      } catch (err) {
        console.error(err);
      }
    }
  }, 10000);
}

function buildLiarLobbyEmbed(game: any) {
  const plist = game.players.map((p: any, idx: number) => `**${idx+1}.** <@${p.id}>`).join("\n");
  const diffIcons = { easy: "🟢 سهل", medium: "🟡 متوسط", hard: "🔴 صعب" };

  return new EmbedBuilder()
    .setTitle("🕵️‍♂️ سهرة لعبة 'من الكاذب؟' التفاعلية")
    .setDescription(`أهلاً بكم في صالون التحقيق والذكاء والفراسة الفائقة!\n\n👑 **منظم السهرة:** <@${game.hostId}>\n\n⚙️ **الإعدادات الحالية:**\n- 📊 **مستوى الصعوبة:** ${diffIcons[game.difficulty as keyof typeof diffIcons]}\n- 🎭 **الأدوار الخاصة:** ${game.useSpecialRoles ? "✅ مفعلة" : "❌ معطلة"}\n\n👥 **المشاركون المنضمون (${game.players.length}/20) حتى الآن:**\n${plist || "لا يوجد"}\n\n⚠️ **الحد الأدنى لإنطلاق اللعبة هو 3 لاعبين بشرية.**\n\n⏳ تبدأ الملحمة تلقائياً خلال **${game.timeLeft}** ثانية!`)
    .setColor("#3498DB");
}

function buildLiarLobbyButtons(game: any) {
  const row1 = new ActionRowBuilder<any>().addComponents(
    new ButtonBuilder().setCustomId(`liar_join_${game.id}`).setLabel("الانضمام 🎪").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`liar_start_${game.id}`).setLabel("بدء اللعبة الآن ⚔️").setStyle(ButtonStyle.Danger)
  );

  const activeDiffLabel = game.difficulty === "easy" ? "الصعوبة: سهل 🟢" : game.difficulty === "medium" ? "الصعوبة: متوسط 🟡" : "الصعوبة: صعب 🔴";
  const activeRolesLabel = game.useSpecialRoles ? "أدوار خاصة: مفعلة ✅" : "أدوار خاصة: معطلة ❌";

  const row2 = new ActionRowBuilder<any>().addComponents(
    new ButtonBuilder().setCustomId(`liar_toggle_diff_${game.id}`).setLabel(activeDiffLabel).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`liar_toggle_roles_${game.id}`).setLabel(activeRolesLabel).setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

async function launchLiarGame(game: any) {
  game.phase = "describe";
  
  // 1. Choose word pair
  const staticList = LIAR_WORD_PAIRS[game.difficulty as keyof typeof LIAR_WORD_PAIRS];
  const pair = staticList[Math.floor(Math.random() * staticList.length)];

  game.word1 = pair.word1;
  const noWordLiar = Math.random() < 0.3;
  game.word2 = noWordLiar ? "لا توجد كلمة لديك ❓" : pair.word2;

  // 2. Assign Secret Roles
  for (const p of game.players) {
    p.role = "citizen";
    p.word = game.word1;
    p.revealed = false;
  }

  // Shuffle players array
  const shuffledPlayers = [...game.players];
  for (let i = shuffledPlayers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledPlayers[i], shuffledPlayers[j]] = [shuffledPlayers[j], shuffledPlayers[i]];
  }

  // Choose Liar
  const liarPlayer = shuffledPlayers[0];
  liarPlayer.role = "liar";
  liarPlayer.word = game.word2;
  game.liarId = liarPlayer.id;

  // If Special Roles are enabled
  if (game.useSpecialRoles) {
    if (game.players.length >= 4) {
      const detPlayer = shuffledPlayers[1];
      detPlayer.role = "detective";
      game.detectiveId = detPlayer.id;
    }
    if (game.players.length >= 5) {
      const witPlayer = shuffledPlayers[2];
      witPlayer.role = "witness";
    }
    if (game.players.length >= 6) {
      const sabPlayer = shuffledPlayers[3];
      sabPlayer.role = "saboteur";
    }
  }

  // Setup accurate p.word logs
  for (const p of game.players) {
    if (p.role === "liar") {
      p.word = game.word2;
    } else {
      p.word = game.word1;
    }
  }

  // 3. Inform everyone & Post game start panel
  const rollDetails = game.players.map((p: any) => `<@${p.id}>`).join(", ");
  
  const startEmbed = new EmbedBuilder()
    .setTitle("🤫 انطلقت القرعة السحرية - لغز الكاذب!")
    .setDescription(`تم توزيع الأدوار والكلمات السرية بخصوصية تامة!\n\n🔍 **المشاركين في هذه السلسلة:**\n${rollDetails}\n\n🕵️‍♂️ **التعليمات السرية للأعضاء:**\n1️⃣ انقر على زر **🔐 كشف كلمتك السرية** أدناه لرؤية هويتك وكلمتك بنظام مؤقت (سري وخاص بك).\n2️⃣ بعد قراءة الكلمة، تشاوروا والبدء بكتابة **كلمة وصفية واحدة قصيرة** عن الكلمة في شات هذه القناة لتبرهن نزاهتك!\n\n💡 **ترتيب التوصيف المقترح:**\n` + game.players.map((p: any, idx: number) => `**${idx+1}.** <@${p.id}>`).join("\n") + `\n\n⏳ سينتهي وقت الاستجواب والوصف التلقائي تمهيداً للمحكمة بعد **90** ثانية!`)
    .setColor("#9B59B6")
    .setFooter({ text: "اضغط على الكشف السري لتلقي كلمتك" });

  const row = new ActionRowBuilder<any>().addComponents(
    new ButtonBuilder().setCustomId(`liar_reveal_${game.id}`).setLabel("🔐 كشف كلمتك السرية").setStyle(ButtonStyle.Primary)
  );

  const editOptions: any = { embeds: [startEmbed], components: [row] };
  
  const targetChannel = client.channels.cache.get(game.channelId) as any;
  if (targetChannel) {
    try {
      const playMsg = await targetChannel.send(editOptions);
      await game.msg.delete().catch(() => {});
      game.msg = playMsg;
    } catch (err) {
      console.error(err);
    }
  }

  // Switch to describe phase count-down
  setTimeout(async () => {
    const updatedGame = activeLiarGames.get(game.id);
    if (updatedGame && updatedGame.phase === "describe") {
      await startLiarVotingPhase(updatedGame);
    }
  }, 90000);
}

async function handleLiarButtons(interaction: any) {
  const customId = interaction.customId;
  const channelId = interaction.channelId;
  const game = activeLiarGames.get(channelId);

  if (!game) {
    return interaction.reply({ content: "⚠️ لم يتم العثور على سهرة كاذب نشطة برادار الصالون.", ephemeral: true });
  }

  if (customId.startsWith("liar_reveal_")) {
    const player = game.players.find((p: any) => p.id === interaction.user.id);
    if (!player) {
      return interaction.reply({ content: "⚠️ لم تشترك في هذه السهرة منذ بداية القرعة!", ephemeral: true });
    }

    player.revealed = true;
    let revealText = "";

    if (player.role === "citizen") {
      revealText = `🧑‍🌾 **أنت مواطن صالح نقي!**\nكلمتك السرية هي: **${game.word1}**\n\nقم بوصِفِها بذكاء دون أن تذكرها حرفياً لمساعدة المواطنين بكشف الدخلاء!`;
    } else if (player.role === "liar") {
      revealText = `🦹 **أنت الكاذب والمتسلل!**\nكلمتك السرية هي: **${game.word2}**\n\nتنبيه: كلمتك مختلفة عن بقية اللاعبين. راقب تلميحات الآخرين ووصفهم، وادَّع بذكاء أنك تملك نفس كلمتهم حتى لا يكتشفوك!`;
    } else if (player.role === "witness") {
      const liarIndex = game.players.findIndex((p: any) => p.role === "liar");
      const liarMention = liarIndex !== -1 ? `<@${game.players[liarIndex].id}>` : "غير معروف";
      revealText = `👁️ **أنت الشاهد العليم!**\nكلمتك السرية هي: **${game.word1}**\n\n📡 **التقرير السري:** الشخص الدخيل والكاذب الفعلي هو: ${liarMention}!\n\n🚨 **تحدي خاص:** وظيفتك هي توجيه الرأي لكشف الكاذب بحكمة، لكن **انتبه بشدة!** لا تعلن نفسك وتجنب إثارة الشبهات في محفل الحديث لأن الشريعة تحرم تصويتك الفردي المباشر!`;
    } else if (player.role === "detective") {
      revealText = `🕵️ **أنت المحقق الخبير!**\nكلمتك السرية هي: **${game.word1}**\n\n🔧 **جهاز التقصي:** لقد ظهر لك زر **"🕵️ رادار المحقق"** خاص بك فقط بالأسفل لمساعدتك في استنباط وتحليل بصمات أحد اللاعبين سراً لتكشف حقيقة قرابته لكلمتك!`;
    } else if (player.role === "saboteur") {
      revealText = `😈 **أنت المخرب المراوغ!**\nكلمتك السرية هي: **${game.word1}**\n\n🎯 **مهمتك الشيطانية:** هدفك الوحيد الإطاحة بالعدالة وتشتيت الأصوات نحو مواطن بريء لحماية المخيم المظلم! نجاح الإطاحة بأي بريء يمنحك التقدير والتوكنز الإضافية!`;
    }

    if (player.role === "detective" && !game.detectiveInvestigated) {
      const row = new ActionRowBuilder<any>().addComponents(
        new ButtonBuilder().setCustomId(`liar_det_scan_${game.id}`).setLabel("🕵️ رادار فحص البصمات").setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({ content: revealText, components: [row], ephemeral: true });
    }

    return interaction.reply({ content: revealText, ephemeral: true });
  }

  if (customId.startsWith("liar_det_scan_")) {
    if (game.detectiveInvestigated) {
      return interaction.reply({ content: "⚠️ لقد استنفدت رادار التحقيق المتاح لك هذه الجولة بالفعل!", ephemeral: true });
    }
    const player = game.players.find((p: any) => p.id === interaction.user.id);
    if (!player || player.role !== "detective") {
      return interaction.reply({ content: "⚠️ هذا الجهاز السري حصري للمحقق فقط!", ephemeral: true });
    }

    const scanOptions = game.players
      .filter((p: any) => p.id !== interaction.user.id)
      .map((p: any) => ({
        label: p.name,
        value: p.id,
        description: `فحص بصمة وهوية ${p.name}`
      }));

    if (scanOptions.length === 0) {
      return interaction.reply({ content: "⚠️ لم يتم العثور على لاعبين آخرين لاستجوابهم!", ephemeral: true });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`liar_det_scan_select_${game.id}`)
      .setPlaceholder("اختر المشتبه به لتفحصه سراً...")
      .addOptions(scanOptions);

    const row = new ActionRowBuilder<any>().addComponents(menu);
    return interaction.reply({ content: "🕵️‍♂️ **رادار التقصي الرقمي:** اختر أحد اللاعبين لتشريح بصمته السرية والكشف عن مدى مطابقته لكلمتك:", components: [row], ephemeral: true });
  }

  // LOBBY/SETUP BUTTONS
  if (customId.startsWith("liar_join_")) {
    const alreadyIn = game.players.some((p: any) => p.id === interaction.user.id);
    if (alreadyIn) {
      return interaction.reply({ content: "🙋‍♂️ أنت مسجل ومشارك في سهرة من الكاذب الحالية بالفعل!", ephemeral: true });
    }
    if (game.players.length >= 20) {
      return interaction.reply({ content: "⚠️ صالون السهرة ممتلئ تماماً حالياً (الحد الأقصى 20 شخص)!", ephemeral: true });
    }

    game.players.push({
      id: interaction.user.id,
      name: interaction.member?.displayName || interaction.user.username,
      role: "citizen",
      alive: true
    });

    const updatedEmbed = buildLiarLobbyEmbed(game);
    const updatedButtons = buildLiarLobbyButtons(game);
    await interaction.update({ embeds: [updatedEmbed], components: updatedButtons });
    return;
  }

  // Guard for host settings
  if (customId.startsWith("liar_toggle_") || customId.startsWith("liar_start_")) {
    if (interaction.user.id !== game.hostId) {
      return interaction.reply({ content: "⚠️ المضيف ومنظم السهرة وحده من يملك صلاحية تعديل الإعدادات وبدء اللعب!", ephemeral: true });
    }
  }

  if (customId.startsWith("liar_toggle_diff_")) {
    const difficulties: ("easy" | "medium" | "hard")[] = ["easy", "medium", "hard"];
    const currIdx = difficulties.indexOf(game.difficulty);
    game.difficulty = difficulties[(currIdx + 1) % difficulties.length];

    const updatedEmbed = buildLiarLobbyEmbed(game);
    const updatedButtons = buildLiarLobbyButtons(game);
    await interaction.update({ embeds: [updatedEmbed], components: updatedButtons });
    return;
  }

  if (customId.startsWith("liar_toggle_roles_")) {
    game.useSpecialRoles = !game.useSpecialRoles;

    const updatedEmbed = buildLiarLobbyEmbed(game);
    const updatedButtons = buildLiarLobbyButtons(game);
    await interaction.update({ embeds: [updatedEmbed], components: updatedButtons });
    return;
  }

  if (customId.startsWith("liar_start_")) {
    if (game.players.length < 3) {
      return interaction.reply({ content: `⚠️ لا يمكن إبراز القرعة قبل تسجيل **3** لاعبين على الأقل! سجلتم حالياً: **${game.players.length}** أعضاء.`, ephemeral: true });
    }

    await launchLiarGame(game);
  }
}

async function handleLiarSelectMenus(interaction: any) {
  const customId = interaction.customId;
  const channelId = interaction.channelId;
  const game = activeLiarGames.get(channelId);

  if (!game) {
    return interaction.reply({ content: "⚠️ لم يتم العثور على سهرة كاذب نشطة برادار الصالون.", ephemeral: true });
  }

  if (customId.startsWith("liar_det_scan_select_")) {
    const scientistId = interaction.user.id;
    const suspectId = interaction.values[0];

    const scientist = game.players.find((p: any) => p.id === scientistId);
    if (!scientist || scientist.role !== "detective") {
      return interaction.reply({ content: "⚠️ تعذر الفحص الفني، هذه الأقراص حصرية للمحقق كلياً!", ephemeral: true });
    }

    if (game.detectiveInvestigated) {
      return interaction.reply({ content: "⚠️ لقد أكملت كشف البصمة مسبقاً في هذه السهرة!", ephemeral: true });
    }

    const suspect = game.players.find((p: any) => p.id === suspectId);
    if (!suspect) {
      return interaction.reply({ content: "⚠️ تعذر العثور على الشخص المعني بالفحص في اللوحة.", ephemeral: true });
    }

    game.detectiveInvestigated = suspect.id;
    let scanResult = "";

    if (suspect.role === "liar") {
      scanResult = `🕵️‍♂️ **تقرير البصمة الرقمية:**\nاللاعب المحلل: <@${suspect.id}>\nالنتيجة السحرية: 🚨 **هو الكاذب الفعلي وسارق الفاكهة!** كلمته مختلفة كلياً عن المواطنين.\n\nتنبيه: لا تدلي بالخبر بأسلوب مباشر يفقد اللعبة متعتها، وجه الشكوك نحوه بالدهاء الإنساني!`;
    } else if (suspect.role === "saboteur") {
      scanResult = `🕵️‍♂️ **تقرير البصمة الرقمية:**\nاللاعب المحلل: <@${suspect.id}>\nالنتيجة السحرية: 😈 **المنمق التخريبي!** هذا الشخص هو المخرب، يحمل كلمتك الفعلية لكن مصلحته هي حماية الكاذب وتوريط الأبرياء!`;
    } else {
      scanResult = `🕵️‍♂️ **تقرير البصمة الرقمية:**\nاللاعب المحلل: <@${suspect.id}>\nالنتيجة السحرية: ✅ **مواطن صالح أو شاهد عليم.** هذا الشخص يحمل نفس كلمتك الحقيقية بنسبة 100%.`;
    }

    await interaction.update({ content: scanResult, components: [] });
  }

  else if (customId.startsWith("liar_vote_menu_")) {
    const voterId = interaction.user.id;
    const votedId = interaction.values[0];

    const player = game.players.find((p: any) => p.id === voterId);
    if (!player) {
      return interaction.reply({ content: "⚠️ أنت لست مشارك في هذه اللعبة حالياً!", ephemeral: true });
    }

    if (player.role === "witness") {
      return interaction.reply({ content: "⚠️ بصفتك الشاهد العليم، شريعتك تمنعك من التصويت الفردي المباشر للحفاظ على عدالة اللعبة!", ephemeral: true });
    }

    game.votes[voterId] = votedId;
    const votedName = game.players.find((p: any) => p.id === votedId)?.name || "عضو مجهول";
    
    await interaction.reply({ content: `🗳️ تم تسجيل صوتك بنجاح للإطاحة بـ **${votedName}**!`, ephemeral: true });

    const eligibleVoters = game.players.filter((p: any) => p.role !== "witness");
    const votesCastCount = Object.keys(game.votes).length;

    if (votesCastCount >= eligibleVoters.length) {
      await processLiarVotingResults(game);
    }
  }
}

async function startLiarVotingPhase(game: any) {
  if (game.phase !== "describe") return;
  game.phase = "voting";
  game.votes = {};

  const embed = new EmbedBuilder()
    .setTitle("🗳️ بدأت محكمة الشورى - من الكاذب؟")
    .setDescription(`انتهت فترة الوصف والتبرير، وبدأت لحظة الحقيقة والتحكيم العادل!\n\n🗣️ **الرجاء التباحث بالشكوك وتسمية المتسلل:**\n- استخدم القائمة المنسدلة بالأسفل للتصويت على الشخص الذي تشك في هويته.\n- تنويه: الشاهد العليم لا يحق له التصويت لكنه يراقب غلبة تلميحاتكم!\n\n⏳ تنتهي المحكمة ويصدر البوت قراره تلقائياً بعد **60** ثانية!`)
    .setColor("#E67E22");

  const votingOptions = game.players.map((p: any) => ({
    label: p.name,
    value: p.id,
    description: `التصويت لطرد ${p.name} وتجريده`
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`liar_vote_menu_${game.id}`)
    .setPlaceholder("اختر المتشبه الأكثر وزناً لطرده...")
    .addOptions(votingOptions);

  const row = new ActionRowBuilder<any>().addComponents(menu);

  const targetChannel = client.channels.cache.get(game.channelId) as any;
  if (targetChannel) {
    try {
      const voteMsg = await targetChannel.send({ embeds: [embed], components: [row] });
      await game.msg.delete().catch(() => {});
      game.msg = voteMsg;
    } catch (err) {
      console.error(err);
    }
  }

  // Settle voting after 60 seconds fail-safe timer
  setTimeout(async () => {
    const updatedGame = activeLiarGames.get(game.id);
    if (updatedGame && updatedGame.phase === "voting") {
      await processLiarVotingResults(updatedGame);
    }
  }, 60000);
}

async function processLiarVotingResults(game: any) {
  if (game.phase !== "voting") return;
  game.phase = "ended";

  const voteCounts: { [userId: string]: number } = {};
  for (const votedId of Object.values(game.votes) as string[]) {
    voteCounts[votedId] = (voteCounts[votedId] || 0) + 1;
  }

  let lynchedId = "";
  let maxVotes = 0;
  let tie = false;

  for (const [uid, count] of Object.entries(voteCounts)) {
    if (count > maxVotes) {
      maxVotes = count;
      lynchedId = uid;
      tie = false;
    } else if (count === maxVotes) {
      tie = true;
    }
  }

  activeLiarGames.delete(game.id);

  const targetChannel = client.channels.cache.get(game.channelId) as any;
  if (!targetChannel) return;

  try {
    const liarPlayer = game.players.find((p: any) => p.role === "liar");
    const liarMention = liarPlayer ? `<@${liarPlayer.id}>` : "المتسلل";

    const resultsEmbed = new EmbedBuilder();

    if (tie || !lynchedId) {
      resultsEmbed
        .setTitle("😈 نجا الكاذب العبقري! انتهى الوقت بتساوي الأصوات")
        .setDescription(`فشلت محكمة الشورى في إصدار قرار موحد وتشتت الأبرياء، مما أفسح المجال للكاذب بالفوز والهروب!\n\n👺 الكاذب الحقيقي هو: ${liarMention}\n🍏 كلمة الأبرياء كانت: **${game.word1}**\n**${game.word2}**\n\n🪙 حصل الكاذب المتسلل على **50** توكن تفاعل لتفوقه الفائق!\n${game.useSpecialRoles && game.players.some((p: any) => p.role === "saboteur") ? "🪙 وحصل المخرب المرافق على **30** توكن لقيامه بالدعاية الضالة!" : ""}`)
        .setColor("#C0392B");

      if (liarPlayer) {
        await rewardTokens(liarPlayer.id, 50);
      }
      if (game.useSpecialRoles) {
        const sab = game.players.find((p: any) => p.role === "saboteur");
        if (sab) await rewardTokens(sab.id, 30);
      }
    } else {
      const lynchedPlayer = game.players.find((p: any) => p.id === lynchedId);
      const isLiarCaught = lynchedPlayer?.role === "liar";

      if (isLiarCaught) {
        let winnerText = `🎉 **إنجاز عظيم ونباهة عالية! تم كشف الدخيل بنجاح!**\n\nأطاحت محكمة الشورى باللاعب الكاذب: <@${lynchedId}> بلائحة حاسمة بلغت **${maxVotes}** أصوات!\n\n🍏 كلمة الأبرياء كانت: **${game.word1}**\n🍐 كلمة الكاذب البائس كانت: **${game.word2}**\n\n🪙 تم مكافأة الشرفاء بـ **20** توكن تفوق وسرعة بديهة!`;
        resultsEmbed
          .setTitle("🎉 انتصر المواطنون والأبرياء!")
          .setDescription(winnerText)
          .setColor("#2ECC71");

        const winners = game.players.filter((p: any) => p.role !== "liar" && p.role !== "saboteur");
        for (const win of winners) {
          await rewardTokens(win.id, 20);
        }
      } else {
        const roleArabic = lynchedPlayer ? (lynchedPlayer.role === "citizen" ? "مواطن صالح بريء" : lynchedPlayer.role === "detective" ? "المحقق الصارم" : lynchedPlayer.role === "witness" ? "الشاهد المبصر" : "المخرب المناور") : "عضو بريء";

        resultsEmbed
          .setTitle("😈 فرّ الكاذب وغنم الشك!")
          .setDescription(`يا للحسرة! سقطت الفأس على بريء وطردتم: <@${lynchedId}> الذي اتضح بأنه **${roleArabic}**!\n\n👺 الكاذب الحقيقي الدخيل هو: ${liarMention}\n🍏 كلمة الأبرياء كانت: **${game.word1}**\n🍐 كلمة الكاذب الغامض كانت: **${game.word2}**\n\n🪙 حصل المتسلل على **50** توكن ذكاء وتفوق ونجاة!\n${game.useSpecialRoles && game.players.some((p: any) => p.role === "saboteur") ? "🪙 وحصل المخرب المخطط على **30** توكن لنجاحه في تشتيت العدالة وصرف الأنظار!" : ""}`)
          .setColor("#C0392B");

        if (liarPlayer) {
          await rewardTokens(liarPlayer.id, 50);
        }
        if (game.useSpecialRoles) {
          const sab = game.players.find((p: any) => p.role === "saboteur");
          if (sab) await rewardTokens(sab.id, 30);
        }
      }
    }

    const statsLines = game.players.map((p: any) => {
      const roleDisplayName = p.role === "liar" ? "👺 الكاذب" : p.role === "detective" ? "🕵️ المحقق" : p.role === "witness" ? "👁️ الشاهد" : p.role === "saboteur" ? "😈 المخرب" : "🧑‍🌾 مواطن صالح";
      return `- <@${p.id}> الهوية: **${roleDisplayName}** | الكلمة المستلمة: \`${p.word}\``;
    }).join("\n");

    resultsEmbed.addFields({ name: "📊 رول هوية السهرة وتوصيفاتها الخفية:", value: statsLines });

    await targetChannel.send({ embeds: [resultsEmbed], components: [] });
    await game.msg.delete().catch(() => {});
  } catch (err) {
    console.error(err);
  }
}

// ==========================================
//          GAMES CONSOLE COMPONENT
// ==========================================

function convertToPublicTrigger(interaction: any) {
  return {
    channel: interaction.channel,
    guild: interaction.guild,
    member: interaction.member,
    user: interaction.user
  };
}

async function showGamesConsole(trigger: any) {
  const guildId = trigger.guild?.id || trigger.channel?.guild?.id || trigger.guildId;
  if (await isGamesDisabledForGuild(guildId)) {
    if (trigger.reply && typeof trigger.reply === "function" && trigger.isChatInputCommand?.()) {
      await trigger.reply({ content: "🔒 **تنبيه:** قائمة ونظام الألعاب معطل ومغلق حالياً في هذا السيرفر من قِبل الإدارة.", ephemeral: true }).catch(() => {});
    }
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("🎮 صالون الألعاب التفاعلي | Discord Games Console")
    .setDescription(`أهلاً بك في منصة الألعاب الرسمية للسيرفر! 🚀
اختر دليلك لمنافسة الأصدقاء وبدء المغامرة فوراً مع أصدقائك أو ضد البوت عبر النقر على أزرار التحكم بالأسفل:

---

1️⃣ **🎮 لعبة إكس-أو (XO):**
- تحدي كلاسيكي شيق للذكاء والتخطيط.
- العب ضد بوت السيرفر الذكي أو استدعِ رفيقاً لينافسك وجهاً لوجه!

2️⃣ **🎲 روليت التوكنات (Roulette):**
- جرب حظك لربح وتكثير توكنات التألق الخاصة بك!
- خوض الرهان الكلاسيكي أو الروليت الروسية لجرعة تشويق كبرى.

3️⃣ **🕵️ سهرة من الكاذب؟ (Who is the Liar):**
- صالون التحقيق والذكاء والفراسة الكبرى (من 3 لـ 20 لاعب).
- خمن من هو اللاعب الذي يمتلك الكلمة المختلفة قبل كشف هويتك!

4️⃣ **🐺 سهرة المافيا التفاعلية (Mafia):**
- سهرة الغموض والتسلل لربوع القرية الهادئة (من 3 لـ 8 لاعبين أو مع بوتات آلية).
- دافع وعاقب المفسدين أو انشر الذعر بظلام الليل المطبق!`)
    .setColor("#2ECC71")
    .setFooter({ text: "انقر على الأزرار أدناه لإيقاد وبدء اللعبة المناسبة لك علناً" });

  const row = new ActionRowBuilder<any>().addComponents(
    new ButtonBuilder().setCustomId("gamesconsole_xo").setLabel("لعب XO 🎮").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("gamesconsole_roulette").setLabel("لعب روليت 🎲").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("gamesconsole_liar").setLabel("لعب من الكاذب 🕵️").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("gamesconsole_mafia").setLabel("لعب مافيا 🐺").setStyle(ButtonStyle.Secondary)
  );

  await gameReply(trigger, { embeds: [embed], components: [row] });
}

async function handleGamesConsoleButtons(interaction: any) {
  const customId = interaction.customId;
  const userId = interaction.user.id;

  if (await isGamesDisabledForGuild(interaction.guildId)) {
    return interaction.reply({ content: "🔒 **تنبيه:** قائمة ونظام الألعاب معطل ومغلق حالياً في هذا السيرفر من قِبل الإدارة.", ephemeral: true }).catch(() => {});
  }

  const publicTrigger = convertToPublicTrigger(interaction);

  if (customId === "gamesconsole_xo") {
    await interaction.reply({ content: "🎮 تم إطلاق جولة XO علناً بالدردشة!", ephemeral: true }).catch(() => {});
    await startXO(publicTrigger, userId);
  } else if (customId === "gamesconsole_roulette") {
    await interaction.reply({ content: "🎲 تم إحداث طاولة روليت علناً بالدردشة!", ephemeral: true }).catch(() => {});
    await startRoulette(publicTrigger, userId, 2);
  } else if (customId === "gamesconsole_liar") {
    await interaction.reply({ content: "🕵️ تم فتح صالون سهرة من الكاذب علناً بالدردشة!", ephemeral: true }).catch(() => {});
    await startLiarLobby(publicTrigger, userId);
  } else if (customId === "gamesconsole_mafia") {
    await interaction.reply({ content: "🐺 تم فتح باب التسجيل لسهرة المافيا علناً بالدردشة!", ephemeral: true }).catch(() => {});
    await startMafiaLobby(publicTrigger, userId);
  }
}

