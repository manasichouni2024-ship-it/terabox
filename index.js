// Cloudflare Workers environment does not need 'dotenv', it loads secrets automatically.
const { Telegraf, Markup } = require('telegraf');
const { MongoClient } = require('mongodb');
const axios = require('axios');

// --- 1. CONFIGURATION (Loaded from Cloudflare Secrets) ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
// Convert ADMIN_ID string from environment to an integer
const ADMIN_ID = parseInt(process.env.ADMIN_ID); 
const TERABOX_API_BASE = process.env.TERABOX_API_BASE || "https://wadownloader.amitdas.site/api/TeraBox/main/?url=";
const ACCESS_LINK_API = process.env.ACCESS_LINK_API || "https://vplink.in/api?api=bbdcdbe30fa584eb68269dd61da632c591b2ee80&url=https://t.me/TERABOX_0_BOT&alias=terabot&format=text";
const ACCESS_REDIRECT_PREFIX = process.env.ACCESS_REDIRECT_PREFIX || "https://vplink.in/terabot";
const VIDEO_DELETE_DELAY = parseInt(process.env.VIDEO_DELETE_DELAY || 20) * 1000; // in milliseconds

// Initialize Bot (in Webhook Mode)
// Note: Telegraf needs an empty token during setup in Workers, 
// as the actual processing happens via the handleUpdate call.
const bot = new Telegraf(BOT_TOKEN); 

// --- 2. DATABASE CONNECTION AND UTILITIES ---
let db;
let client;

async function connectDB() {
    if (db) return; // Check if connection already exists
    try {
        client = new MongoClient(MONGO_URI);
        await client.connect();
        db = client.db('terabox_bot_db');
        console.log("MongoDB connected successfully.");
    } catch (error) {
        console.error("Failed to connect to MongoDB:", error);
        // In a worker, we should not exit, just log the error
    }
}

const usersCollection = () => db.collection('users');
const configCollection = () => db.collection('config');

// ... [Helper functions like getOrCreateUser, hasAccess, grant24HourAccess remain the same] ...
async function getOrCreateUser(userId, userDetails) {
    if (!db) await connectDB();
    let user = await usersCollection().findOne({ _id: userId });
    // ... [Rest of the function logic] ...
    if (!user) {
        const newUser = {
            _id: userId,
            username: userDetails.username || '',
            first_name: userDetails.first_name || '',
            access_expires: new Date(0), 
            join_date: new Date(),
        };
        await usersCollection().insertOne(newUser);
        return newUser;
    }
    return user;
}

async function hasAccess(userId) {
    if (!db) await connectDB();
    const user = await usersCollection().findOne({ _id: userId });
    if (!user) return false;
    return user.access_expires.getTime() > new Date().getTime();
}

async function grant24HourAccess(userId) {
    if (!db) await connectDB();
    const newExpiryTime = new Date(new Date().getTime() + 24 * 60 * 60 * 1000); 
    await usersCollection().updateOne(
        { _id: userId },
        { $set: { access_expires: newExpiryTime } }
    );
}

// --- 3. KEYBOARDS ---
const accessKeyboard = () => {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('🔐 Get 24 Hours Access', 'get_access'),
            Markup.button.callback('▶️ Access Tutorial Video', 'show_tutorial')
        ]
    ]);
};

const videoKeyboard = (mediaUrl) => {
    return Markup.inlineKeyboard([
        [
            Markup.button.url('Download ⬇️', mediaUrl)
        ]
    ]);
};


// --- 4. TELEGRAM HANDLERS ---

bot.start(async (ctx) => {
    await connectDB(); // Ensure DB is connected before accessing user data
    const userDetails = ctx.from;
    await getOrCreateUser(userDetails.id, userDetails);

    // Check for access link redirect
    const fullCommand = ctx.message.text;
    if (fullCommand && fullCommand.includes(ACCESS_REDIRECT_PREFIX)) {
        await grant24HourAccess(userDetails.id);
        return ctx.replyWithHTML(
            "✅ **Access successfully added!**\n\nYou can now watch videos for the next **24 hours**.\nPlease provide your **Terabox video link**."
        );
    }

    const welcomeText = (
        "👋 **Welcome! I'm your Terabox Video Viewer Bot.**\n\n"
        "Use this bot to easily view videos from any Terabox link.\n\n"
        "Please provide your **Terabox video link** 👇"
    );

    ctx.replyWithHTML(welcomeText);
});

bot.on('text', async (ctx) => {
    await connectDB();
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;

    if (!text.startsWith('http://') && !text.startsWith('https://')) {
        return; 
    }

    if (await hasAccess(userId)) {
        const loadingMsg = await ctx.reply('🔄 Loading video... Please wait.');

        try {
            const fullApiUrl = `${TERABOX_API_BASE}${encodeURIComponent(text)}`;
            const response = await axios.get(fullApiUrl, { timeout: 30000 });
            const data = response.data;

            if (data.status === 'success') {
                const mediaUrl = data.media_url;
                const title = data.title || 'Terabox Video';

                const captionText = (
                    `🎬 **${title}**\n\n` +
                    "⚠️ **Forward the video to save it!** ⚠️\n" +
                    `It will **automatically delete in ${process.env.VIDEO_DELETE_DELAY || 20} seconds**.`
                );

                const sentMessage = await ctx.replyWithVideo(
                    mediaUrl, {
                        caption: captionText,
                        reply_markup: videoKeyboard(mediaUrl),
                        parse_mode: 'HTML'
                    }
                );

                await ctx.deleteMessage(loadingMsg.message_id);

                // Automatic message deletion (Workers use setTimeout for this)
                setTimeout(async () => {
                    try {
                        await ctx.telegram.deleteMessage(sentMessage.chat.id, sentMessage.message_id);
                    } catch (e) {
                        console.error("Error deleting message:", e.message);
                    }
                }, VIDEO_DELETE_DELAY);

            } else {
                await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, "❌ Sorry! Could not process the video. Unexpected response from API.");
            }

        } catch (error) {
            console.error("Video processing error:", error.message);
            const errorMessage = error.response ? `API Error: ${error.response.status}` : "Network or API connection issue occurred.";
            await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, `❌ An error occurred: ${errorMessage}`);
        }

    } else {
        const balanceMsg = (
            "❌ **Insufficient Balance**\n\n"
            "You need **24-hour access** to view Terabox videos. Use the button below to get access."
        );
        ctx.replyWithHTML(balanceMsg, accessKeyboard());
    }
});

// --- 5. CALLBACK QUERY HANDLERS ---

bot.action('get_access', async (ctx) => {
    await ctx.answerCbQuery('Generating access link...');

    try {
        const response = await axios.get(ACCESS_LINK_API);
        const redirectLink = response.data.trim();

        if (redirectLink.startsWith(ACCESS_REDIRECT_PREFIX)) {
            const finalLink = redirectLink;

            const linkMessage = (
                "🔗 **24 Hour Access Link**\n\n" +
                "To confirm your access, **click the link below**. Complete the steps on the link, and then **return to the bot and use the /start command again**.\n\n" +
                `➡️ [Access Link](${finalLink})`
            );

            await ctx.editMessageText(
                linkMessage, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                }
            );
        } else {
            await ctx.editMessageText("❌ Failed to generate link. Unexpected response from API.");
        }

    } catch (error) {
        console.error("Error in get_access callback:", error.message);
        await ctx.editMessageText("❌ An unknown error occurred while fetching the access link.");
    }
});

bot.action('show_tutorial', async (ctx) => {
    await connectDB();
    await ctx.answerCbQuery('Sending tutorial video...');

    try {
        const config = await configCollection().findOne({ _id: 'tutorial_video' });
        const fileId = config ? config.file_id : null;

        if (fileId) {
            await ctx.replyWithVideo(
                fileId, {
                    caption: "▶️ **Tutorial Video**\n\nWatch the video and follow the steps to get 24 hours access."
                }
            );
        } else {
            await ctx.reply("❌ Sorry, the tutorial video has not been set by the admin yet.");
        }
    } catch (error) {
        console.error("Error in show_tutorial callback:", error.message);
        await ctx.reply("❌ Sorry, the tutorial video could not be sent.");
    }
});

// --- 6. ADMIN COMMANDS ---

bot.command('setvideo', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("❌ You do not have admin access.");

    ctx.reply(
        "🎬 **Tutorial Video Setup**\n\n" +
        "Please send the **tutorial video** in the next message."
    );
});

bot.on('video', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return; 
    await connectDB();

    const videoFileId = ctx.message.video.file_id;

    await configCollection().updateOne(
        { _id: 'tutorial_video' },
        { $set: { file_id: videoFileId } },
        { upsert: true }
    );

    ctx.reply("✅ **Tutorial video successfully set!**");
});

bot.command('usercount', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("❌ You do not have admin access.");
    await connectDB();

    try {
        const count = await usersCollection().countDocuments({});
        ctx.reply(`👥 **Total User Count:** ${count} users.`);
    } catch (error) {
        console.error("Error fetching user count:", error);
        ctx.reply("❌ Could not fetch user count from DB.");
    }
});

bot.command('broadcast', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("❌ You do not have admin access.");
    await connectDB();

    const broadcastText = ctx.message.text.replace('/broadcast', '').trim();

    if (!broadcastText) {
        return ctx.reply(
            "📢 **Start Broadcast**\n\n" +
            "Write the message you want to send to all users after `/broadcast`.\n" +
            "Example: `/broadcast Our bot is now faster!`"
        );
    }

    const statusMsg = await ctx.reply("🔄 Starting broadcast... Please wait.");
    
    let successCount = 0;
    let failureCount = 0;
    
    const usersCursor = usersCollection().find({}, { projection: { _id: 1 } });
    
    await usersCursor.forEach(async (user) => {
        try {
            await ctx.telegram.sendMessage(user._id, broadcastText, { parse_mode: 'HTML' });
            successCount++;
            // Small delay to avoid flood limits
            await new Promise(resolve => setTimeout(resolve, 50)); 
        } catch (error) {
            failureCount++;
        }
    });

    await ctx.telegram.editMessageText(
        statusMsg.chat.id, 
        statusMsg.message_id,
        `✅ **Broadcast successfully completed!**\nSuccessful: ${successCount}\nFailed: ${failureCount}`
    );
});

// --- 7. WORKER ENTRY POINT ---

// This function processes the incoming Telegram update
async function handleUpdate(request) {
    // Telegraf processes the incoming update and executes the corresponding handlers
    try {
        const update = await request.json();
        await bot.handleUpdate(update);
        // Telegram expects a simple 200 OK response quickly
        return new Response('OK', { status: 200 });
    } catch (error) {
        console.error("Worker Error processing update:", error);
        return new Response('Error', { status: 500 });
    }
}

// The Cloudflare Worker event listener
addEventListener('fetch', event => {
    // Only process POST requests coming from Telegram (the webhook)
    if (event.request.method === 'POST') {
        event.respondWith(handleUpdate(event.request));
    } else {
        // Handle GET requests (e.g., to verify the worker is running)
        event.respondWith(new Response('Terabox Bot Worker is Running. Please set the Webhook URL.', { status: 200 }));
    }
});
