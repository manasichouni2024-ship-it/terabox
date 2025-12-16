// index.js

const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const mongoose = require('mongoose');

// =========================================================
// 1. CONFIGURATION (REPLACE WITH YOUR ACTUAL VALUES)
// =========================================================

const BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN_HERE"; // Your Bot Token
const MONGO_URI = "YOUR_MONGODB_CONNECTION_STRING_HERE"; // Your MongoDB URI
const ADMIN_IDS_RAW = "1234567890,9876543210"; // Your numeric Telegram User IDs (comma-separated)
const ADMIN_IDS = ADMIN_IDS_RAW.split(',').map(id => parseInt(id.trim()));

// TeraBox and Access APIs
const VPLINK_API_URL = "https://vplink.in/api?api=bbdcdbe30fa584eb68269dd61da632c591b2ee80&url=https://t.me/TERABOX_0_BOT&alias=terabot&format=text";
const TERABOX_DL_API = "https://wadownloader.amitdas.site/api/TeraBox/main/?url=";
const VIDEO_DELETE_DELAY_MS = 20000; // 20 seconds

// =========================================================
// 2. MONGODB SCHEMA AND CONNECTION
// =========================================================

const userSchema = new mongoose.Schema({
    _id: Number, 
    username: String,
    access_expires: { type: Date, default: () => new Date(Date.now() - 1000) }
});

const configSchema = new mongoose.Schema({
    _id: String,
    value: String
});

const User = mongoose.model('User', userSchema);
const Config = mongoose.model('Config', configSchema);

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB connection successful.'))
    .catch(err => console.error('❌ MongoDB connection failed:', err));


// =========================================================
// 3. UTILITY AND DB FUNCTIONS
// =========================================================

function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

async function ensureUserExists(userId, username) {
    let user = await User.findById(userId);
    if (!user) {
        user = new User({ _id: userId, username: username });
        await user.save();
    }
    return user;
}

async function hasActiveAccess(userId) {
    const user = await User.findById(userId);
    if (user && user.access_expires && user.access_expires > new Date()) {
        return true;
    }
    return false;
}

async function add24HourAccess(userId) {
    const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); 
    await User.findByIdAndUpdate(userId, { access_expires: newExpiry }, { upsert: true });
}

async function getConfig(key) {
    const config = await Config.findById(key);
    return config ? config.value : null;
}

async function setConfig(key, value) {
    await Config.findByIdAndUpdate(key, { value: value }, { upsert: true });
}


// =========================================================
// 4. TELEGRAF BOT INITIALIZATION AND HANDLERS
// =========================================================

const bot = new Telegraf(BOT_TOKEN);
// Simple session state management for /setvideo
bot.use((ctx, next) => {
    ctx.session = ctx.session || {};
    next();
});


// --- /start Command ---
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    
    await ensureUserExists(userId, username);
    
    // Logic: If user returns via /start (e.g., from vplink), grant access.
    if (ctx.startPayload) {
        await add24HourAccess(userId);
        return ctx.replyWithMarkdown(
            `🥳 **Congratulations ${ctx.from.first_name}!**\n` +
            "Your 24-hour access has been successfully activated.\n\n" +
            "⬇️ **Now, please send the TeraBox video link.**"
        );
    }

    const hasAccess = await hasActiveAccess(userId);

    if (hasAccess) {
        // Active Access
        return ctx.replyWithMarkdown(
            `👋 **Welcome ${ctx.from.first_name}!**\n` +
            "✅ You currently have active 24-hour access.\n\n" +
            "⬇️ **Please send the TeraBox video link.**",
        );
    } else {
        // Insufficient Balance / No Access 
        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('🔓 Get 24 Hours Access', 'get_access'),
                Markup.button.callback('▶️ Access Tutorial Video', 'access_tutorial')
            ]
        ]);
        
        return ctx.replyWithMarkdown(
            `👋 **Welcome ${ctx.from.first_name}!**\n` +
            "⬇️ Please send the TeraBox video link.\n\n" +
            "🚨 **Insufficient Balance.** You need to purchase 24-hour access.",
            keyboard
        );
    }
});

// --- Callback Query Handler (Button Clicks) ---

bot.action('get_access', async (ctx) => {
    await ctx.answerCbQuery();
    
    await ctx.editMessageText("⏳ Generating access link, please wait...");

    try {
        // Request to vplink.in API
        const response = await axios.get(VPLINK_API_URL, { timeout: 15000 });
        const accessLink = response.data.trim(); 
        
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url('🔗 Click Here to Get Access', accessLink)]
        ]);

        await ctx.editMessageText(
            "✅ Access link generated successfully!\n\n" +
            "👇 **Click the link below, complete the process, and then return to the bot and send /start.**\n" +
            "Your 24-hour access will be added automatically.",
            { reply_markup: keyboard, parse_mode: 'Markdown' }
        );

    } catch (e) {
        console.error("vplink.in API error:", e.message);
        await ctx.editMessageText("❌ Error generating access link. Please try again later.");
    }
});

bot.action('access_tutorial', async (ctx) => {
    await ctx.answerCbQuery();
    
    const videoFileId = await getConfig('tutorial_video_id');
    
    if (videoFileId) {
        // Send the video
        await ctx.replyWithVideo(videoFileId, {
            caption: "▶️ **Tutorial Video for 24-Hour Access**"
        });
        // Edit the original message to reflect the action
        await ctx.editMessageText("Tutorial video sent above. Please check it.");
    } else {
        await ctx.editMessageText("❌ Admin has not set the tutorial video yet.");
    }
});

// --- Message Handler (TeraBox Link Processing) ---

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const messageText = ctx.message.text;

    // Check if it looks like a TeraBox URL
    if (!messageText.includes("terabox.com") && !messageText.includes("4funbox.com")) {
        return; 
    }

    // 1. Access Check
    const hasAccess = await hasActiveAccess(userId);
    if (!hasAccess) {
        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('🔓 Get 24 Hours Access', 'get_access'),
                Markup.button.callback('▶️ Access Tutorial Video', 'access_tutorial')
            ]
        ]);
        return ctx.replyWithMarkdown(
            "🚫 **ACCESS DENIED!**\n" +
            "You do not have **active 24-hour access** to download videos. Please get access.",
            keyboard
        );
    }
    
    // 2. Video Download Process
    const processingMsg = await ctx.reply("⏳ Link processing started, please wait...");
    
    const teraboxApiUrl = `${TERABOX_DL_API}${encodeURIComponent(messageText.trim())}`;

    try {
        const response = await axios.get(teraboxApiUrl, { timeout: 30000 });
        const data = response.data;

        if (data.status === "success" && data.media_url) {
            const { media_url, title, thumbnail } = data;

            // Caption text as requested 
            const videoCaption = `🎥 **${title}**\n\n` +
                                 "⚠️ video ko forward karke save kar lo 20 second me delete ho jayega";

            // Download/Play button
            const downloadKeyboard = Markup.inlineKeyboard([
                [Markup.button.url("🔗 Download/Play Video (URL)", media_url)]
            ]);

            // Send the video directly from the URL
            const sentMessage = await ctx.replyWithVideo(media_url, {
                caption: videoCaption,
                thumbnail: thumbnail, 
                supports_streaming: true,
                reply_markup: downloadKeyboard,
                parse_mode: 'Markdown'
            });

            // Delete processing message
            await ctx.deleteMessage(processingMsg.message_id);

            // 3. Auto-Delete Logic (20 seconds)
            setTimeout(async () => {
                try {
                    await ctx.deleteMessage(sentMessage.message_id);
                } catch (e) {
                    console.error("Failed to auto-delete message:", e.message);
                }
            }, VIDEO_DELETE_DELAY_MS); 
            
        } else {
            await ctx.reply(`❌ Failed to process video: ${data.message || 'Unknown error.'}`);
        }

    } catch (e) {
        console.error("TeraBox API Request error:", e.message);
        await ctx.reply("❌ Network or API error occurred while processing the video. Please try again.");
    }
});


// =========================================================
// 5. ADMIN COMMANDS
// =========================================================

// --- /setvideo ---
bot.command('setvideo', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("🚫 Access Denied.");
    
    // Set state to listen for next video message
    ctx.session.waitingForVideo = true; 
    await ctx.reply("Please send the tutorial video now. I will save its file ID.");
});

bot.on('video', async (ctx, next) => {
    if (isAdmin(ctx.from.id) && ctx.session && ctx.session.waitingForVideo) {
        const videoFileId = ctx.message.video.file_id;
        await setConfig('tutorial_video_id', videoFileId);
        
        ctx.session.waitingForVideo = false; // Reset state

        return ctx.replyWithMarkdown(
            `✅ Tutorial video set successfully.\n` +
            `File ID: \`${videoFileId}\``
        );
    }
    return next();
});

// --- /usercount ---
bot.command('usercount', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("🚫 Access Denied.");
    
    const count = await User.countDocuments({});
    await ctx.replyWithMarkdown(`📊 Total user count in bot: **${count}** users.`);
});

// --- /broadcast ---
bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("🚫 Access Denied.");

    const broadcastMessage = ctx.message.text.substring(ctx.message.text.indexOf(' ') + 1);

    if (ctx.message.text === '/broadcast') {
        return ctx.reply("Please provide the message after /broadcast.");
    }

    const users = await User.find({});
    let sentCount = 0;
    let blockedCount = 0;

    await ctx.reply("⏳ Broadcast started...");

    for (const user of users) {
        try {
            await ctx.telegram.sendMessage(user._id, broadcastMessage, { parse_mode: 'Markdown' });
            sentCount++;
            await new Promise(resolve => setTimeout(resolve, 50)); 
        } catch (e) {
            if (e.message.includes('bot was blocked by the user')) {
                blockedCount++;
            }
        }
    }
            
    await ctx.replyWithMarkdown(
        `✅ Broadcast finished.\n` +
        `Total sent: **${sentCount}** users.\n` +
        `Blocked bot: **${blockedCount}** users.`
    );
});


// =========================================================
// 6. CLOUDFLARE WORKER WEBHOOK EXPORT (ES Module Format)
// =========================================================
// This exports the fetch handler required for Cloudflare Workers.

module.exports = {
    async fetch(request) {
        if (request.method === 'POST') {
            try {
                const update = await request.json();
                await bot.handleUpdate(update); 
                return new Response('OK', { status: 200 });
            } catch (e) {
                console.error('Webhook Error:', e);
                // Important: Return 200 even on error to prevent Telegram retries
                return new Response('Error Processing Update', { status: 200 }); 
            }
        }
        return new Response('TeraBox Bot Worker Running!', { status: 200 });
    }
};
