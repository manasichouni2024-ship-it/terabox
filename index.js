// index.js - FIXED FOR CLOUDFLARE WORKERS (ESM & Mongoose Issue)

import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
// Using the ES Module import style for Mongoose
import mongoose from 'mongoose'; 

// =========================================================
// 1. CONFIGURATION (USER-PROVIDED VALUES)
// =========================================================

const BOT_TOKEN = "8545244121:AAGovQWgpng0WkrKJfjQ6HmtWkK3izZJ0tg"; // Your Bot Token
const MONGO_URI = "mongodb+srv://manasichouni2024_db_user:sayan6799@cluster0.jsolkip.mongodb.net/?appName=Cluster0"; // Your MongoDB URI
const ADMIN_IDS_RAW = "6295533968,9876543210"; // Your numeric Telegram User IDs (comma-separated)
const ADMIN_IDS = ADMIN_IDS_RAW.split(',').map(id => parseInt(id.trim()));

// TeraBox and Access APIs (Fixed)
const VPLINK_API_URL = "https://vplink.in/api?api=bbdcdbe30fa584eb68269dd61da632c591b2ee80&url=https://t.me/TERABOX_0_BOT&alias=terabot&format=text";
const TERABOX_DL_API = "https://wadownloader.amitdas.site/api/TeraBox/main/?url=";
const VIDEO_DELETE_DELAY_MS = 20000; // 20 seconds

// =========================================================
// 2. MONGODB SCHEMA AND CONNECTION (RESTRUCTURED)
// =========================================================

let isConnected = false;

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

// Connection logic encapsulated into an async function
async function connectToDatabase() {
    if (isConnected) {
        console.log('✅ MongoDB connection already established.');
        return;
    }

    console.log('⏳ Connecting to MongoDB...');
    // IMPORTANT: Adding the useNewUrlParser and useUnifiedTopology options
    // is often required to resolve Mongoose connection issues in serverless.
    try {
        await mongoose.connect(MONGO_URI);
        isConnected = true;
        console.log('✅ MongoDB connection successful.');
    } catch (err) {
        // Log error but allow worker to proceed (may fail later if DB is needed)
        console.error('❌ MongoDB connection failed:', err);
    }
}

// =========================================================
// 3. UTILITY AND DB FUNCTIONS (MODIFIED TO CALL connectToDatabase)
// =========================================================

function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

// Ensure every DB function calls connectToDatabase
async function ensureUserExists(userId, username) {
    await connectToDatabase(); // Ensure connection before every query
    let user = await User.findById(userId);
    if (!user) {
        user = new User({ _id: userId, username: username });
        await user.save();
    }
    return user;
}

async function hasActiveAccess(userId) {
    await connectToDatabase();
    const user = await User.findById(userId);
    if (user && user.access_expires && user.access_expires > new Date()) {
        return true;
    }
    return false;
}

async function add24HourAccess(userId) {
    await connectToDatabase();
    const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); 
    await User.findByIdAndUpdate(userId, { access_expires: newExpiry }, { upsert: true });
}

async function getConfig(key) {
    await connectToDatabase();
    const config = await Config.findById(key);
    return config ? config.value : null;
}

async function setConfig(key, value) {
    await connectToDatabase();
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
            `🥳 **অভিনন্দন ${ctx.from.first_name}!**\n` +
            "আপনার ২৪-ঘণ্টার অ্যাক্সেস সফলভাবে যুক্ত হয়েছে।\n\n" +
            "⬇️ **এবার TeraBox ভিডিওর লিঙ্কটি দিন, আমি ডাউনলোড করে দেব।**"
        );
    }

    const hasAccess = await hasActiveAccess(userId);

    if (hasAccess) {
        // Active Access
        return ctx.replyWithMarkdown(
            `👋 **স্বাগতম ${ctx.from.first_name}!**\n` +
            "✅ আপনার কাছে বর্তমানে সক্রিয় ২৪-ঘণ্টার অ্যাক্সেস আছে।\n\n" +
            "⬇️ **TeraBox ভিডিওর লিঙ্কটি দিন, আমি ডাউনলোড করে দেব।**",
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
            `👋 **স্বাগতম ${ctx.from.first_name}!**\n` +
            "⬇️ দয়া করে TeraBox ভিডিওর লিঙ্কটি দিন।\n\n" +
            "🚨 **Insufficient Balance** (অপর্যাপ্ত ব্যালেন্স)। আপনাকে ২৪-ঘণ্টার অ্যাক্সেস নিতে হবে।",
            keyboard
        );
    }
});

// --- Callback Query Handler (Button Clicks) ---

bot.action('get_access', async (ctx) => {
    await ctx.answerCbQuery();
    
    await ctx.editMessageText("⏳ অ্যাক্সেস লিঙ্ক তৈরি করা হচ্ছে, অপেক্ষা করুন...");

    try {
        // Request to vplink.in API
        const response = await axios.get(VPLINK_API_URL, { timeout: 15000 });
        const accessLink = response.data.trim(); // Expected: "https://vplink.in/terabot"
        
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url('🔗 এখানে ক্লিক করে অ্যাক্সেস নিন', accessLink)]
        ]);

        await ctx.editMessageText(
            "✅ অ্যাক্সেস লিঙ্ক তৈরি হয়েছে!\n\n" +
            "👇 **নিচের লিঙ্কে ক্লিক করুন এবং প্রক্রিয়াটি সম্পন্ন করার পর আবার /start করে বট-এ আসুন।**\n" +
            "আপনার ২৪-ঘণ্টার অ্যাক্সেস স্বয়ংক্রিয়ভাবে যুক্ত হবে।",
            { reply_markup: keyboard, parse_mode: 'Markdown' }
        );

    } catch (e) {
        console.error("vplink.in API error:", e.message);
        await ctx.editMessageText("❌ অ্যাক্সেস লিঙ্ক তৈরি করার সময় নেটওয়ার্ক বা API ত্রুটি হয়েছে।");
    }
});

bot.action('access_tutorial', async (ctx) => {
    await ctx.answerCbQuery();
    
    const videoFileId = await getConfig('tutorial_video_id');
    
    if (videoFileId) {
        // Send the video
        await ctx.replyWithVideo(videoFileId, {
            caption: "▶️ **২৪-ঘণ্টার অ্যাক্সেস নেওয়ার টিউটোরিয়াল ভিডিও**"
        });
        // Edit the original message to reflect the action
        await ctx.editMessageText("টিউটোরিয়াল ভিডিওটি উপরে পাঠানো হয়েছে।");
    } else {
        await ctx.editMessageText("❌ অ্যাডমিন এখনও কোনো টিউটোরিয়াল ভিডিও সেট করেননি।");
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
    const processingMsg = await ctx.reply("⏳ লিঙ্কটি প্রসেস করা হচ্ছে, দয়া করে অপেক্ষা করুন...");
    
    const teraboxApiUrl = `${TERABOX_DL_API}${encodeURIComponent(messageText.trim())}`;

    try {
        const response = await axios.get(teraboxApiUrl, { timeout: 30000 });
        const data = response.data;

        if (data.status === "success" && data.media_url) {
            const { media_url, title, thumbnail } = data;

            // Caption text as requested (Hindi/Bangla mix)
            const videoCaption = `🎥 **${title}**\n\n` +
                                 "⚠️ video ko forward karke save kar lo 20 second me delete ho jayega";

            // Download/Play button
            const downloadKeyboard = Markup.inlineKeyboard([
                [Markup.button.url("🔗 Download/Play Video (URL)", media_url)]
            ]);

            // Send the video
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
            await ctx.reply(`❌ ভিডিও প্রসেস করতে ব্যর্থ হয়েছে: ${data.message || 'Unknown error.'}`);
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
    await ctx.reply("দয়া করে টিউটোরিয়াল ভিডিওটি পাঠান। আমি এটির ফাইল আইডি সেভ করে নেব।");
});

bot.on('video', async (ctx, next) => {
    if (isAdmin(ctx.from.id) && ctx.session && ctx.session.waitingForVideo) {
        const videoFileId = ctx.message.video.file_id;
        await setConfig('tutorial_video_id', videoFileId);
        
        ctx.session.waitingForVideo = false; // Reset state

        return ctx.replyWithMarkdown(
            `✅ টিউটোরিয়াল ভিডিও সফলভাবে সেট করা হয়েছে।\n` +
            `File ID: \`${videoFileId}\``
        );
    }
    return next();
});

// --- /usercount ---
bot.command('usercount', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("🚫 Access Denied.");
    
    const count = await User.countDocuments({});
    await ctx.replyWithMarkdown(`📊 বটের মোট ইউজারের সংখ্যা: **${count}** জন।`);
});

// --- /broadcast ---
bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("🚫 Access Denied.");

    const broadcastMessage = ctx.message.text.substring(ctx.message.text.indexOf(' ') + 1);

    if (ctx.message.text === '/broadcast') {
        return ctx.reply("দয়া করে /broadcast এর পর আপনার মেসেজটি দিন।");
    }

    // Ensure connection before fetching users
    await connectToDatabase();
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
        `মোট পাঠানো হয়েছে: **${sentCount}** জন।\n` +
        `বট ব্লক করেছে: **${blockedCount}** জন।`
    );
});


// =========================================================
// 6. CLOUDFLARE WORKER WEBHOOK EXPORT 
// =========================================================

export default { 
    async fetch(request) {
        // We will call connectToDatabase here as well to ensure it's attempted 
        // early in the request lifecycle, even though it's called in utility functions.
        await connectToDatabase(); 

        if (request.method === 'POST') {
            try {
                const update = await request.json();
                // Handle the update and let Telegraf process the event
                await bot.handleUpdate(update); 
                return new Response('OK', { status: 200 });
            } catch (e) {
                console.error('Webhook Error:', e);
                // Return 200 even on error to prevent Telegram retries
                return new Response('Error Processing Update', { status: 200 }); 
            }
        }
        return new Response('TeraBox Bot Worker Running!', { status: 200 });
    }
};
