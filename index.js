// Cloudflare Workers environment loads secrets automatically.
// 1. Convert require to import
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';

// --- 1. CONFIGURATION (Loaded from Cloudflare Secrets) ---
// KV Binding is exposed as a global variable: USER_DATA_KV
const USER_DATA_KV = USER_DATA_KV; 
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID); 
const TERABOX_API_BASE = process.env.TERABOX_API_BASE;
const ACCESS_LINK_API = process.env.ACCESS_LINK_API;
const ACCESS_REDIRECT_PREFIX = process.env.ACCESS_REDIRECT_PREFIX;
const VIDEO_DELETE_DELAY = parseInt(process.env.VIDEO_DELETE_DELAY) * 1000; // in milliseconds

// Initialize Bot (in Webhook Mode)
const bot = new Telegraf(BOT_TOKEN); 

// --- 2. KV HELPER FUNCTIONS (Unchanged, use USER_DATA_KV directly) ---

async function getOrCreateUser(userId, userDetails) {
    const key = `user_${userId}`;
    let userString = await USER_DATA_KV.get(key);

    if (userString) {
        return JSON.parse(userString);
    }
    
    // User not found, create a new one
    const newUser = {
        id: userId,
        username: userDetails.username || '',
        first_name: userDetails.first_name || '',
        access_expires: new Date(0).toISOString(), 
        join_date: new Date().toISOString(),
        total_access_grants: 0
    };
    
    await USER_DATA_KV.put(key, JSON.stringify(newUser));
    return newUser;
}

async function hasAccess(userId) {
    const key = `user_${userId}`;
    const userString = await USER_DATA_KV.get(key);
    if (!userString) return false;

    const user = JSON.parse(userString);
    const expiryDate = new Date(user.access_expires);
    return expiryDate.getTime() > new Date().getTime();
}

async function grant24HourAccess(userId) {
    const key = `user_${userId}`;
    let userString = await USER_DATA_KV.get(key);
    let user = JSON.parse(userString);

    const newExpiryTime = new Date(new Date().getTime() + 24 * 60 * 60 * 1000); 
    
    user.access_expires = newExpiryTime.toISOString();
    user.total_access_grants = (user.total_access_grants || 0) + 1;

    await USER_DATA_KV.put(key, JSON.stringify(user));
}

async function getTutorialVideoFileId() {
    return USER_DATA_KV.get('config_tutorial_video_id');
}

// --- 3. KEYBOARDS (Unchanged) ---
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


// --- 4. TELEGRAM HANDLERS (Unchanged) ---

bot.start(async (ctx) => {
    const userDetails = ctx.from;
    await getOrCreateUser(userDetails.id, userDetails);

    const fullCommand = ctx.message.text;
    if (fullCommand && fullCommand.includes(ACCESS_REDIRECT_PREFIX)) {
        await grant24HourAccess(userDetails.id);
        return ctx.replyWithHTML(
            "✅ **Access successfully added!**\n\nYou can now watch videos for the next **24 hours**.\nPlease provide your **Terabox video link**."
        );
    }

    const welcomeText = `
👋 **Welcome! I'm your Terabox Video Viewer Bot.**

Use this bot to easily view videos from any Terabox link.

Please provide your **Terabox video link** 👇
`;

    ctx.replyWithHTML(welcomeText);
});

bot.on('text', async (ctx) => {
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

                const captionText = `
🎬 **${title}**

⚠️ **Forward the video to save it!** ⚠️
It will **automatically delete in ${process.env.VIDEO_DELETE_DELAY || 20} seconds**.
`;

                const sentMessage = await ctx.replyWithVideo(
                    mediaUrl, {
                        caption: captionText,
                        reply_markup: videoKeyboard(mediaUrl),
                        parse_mode: 'HTML'
                    }
                );

                await ctx.deleteMessage(loadingMsg.message_id);

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
        const balanceMsg = `
❌ **Insufficient Balance**

You need **24-hour access** to view Terabox videos. Use the button below to get access.
`;
        ctx.replyWithHTML(balanceMsg, accessKeyboard());
    }
});

// ... (Other handlers like bot.action, bot.on, bot.command are unchanged) ...
bot.action('get_access', async (ctx) => {
    await ctx.answerCbQuery('Generating access link...');

    try {
        const response = await axios.get(ACCESS_LINK_API);
        const redirectLink = response.data.trim();

        if (redirectLink.startsWith(ACCESS_REDIRECT_PREFIX)) {
            const finalLink = redirectLink;

            const linkMessage = `
🔗 **24 Hour Access Link**

To confirm your access, **click the link below**. Complete the steps on the link, and then **return to the bot and use the /start command again**.

➡️ [Access Link](${finalLink})
`;

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
    await ctx.answerCbQuery('Sending tutorial video...');

    const fileId = await getTutorialVideoFileId();

    if (fileId) {
        try {
            await ctx.replyWithVideo(
                fileId, {
                    caption: "▶️ **Tutorial Video**\n\nWatch the video and follow the steps to get 24 hours access."
                }
            );
        } catch (error) {
            console.error("Error sending tutorial video:", error.message);
            await ctx.reply("❌ Sorry, the tutorial video could not be sent.");
        }
    } else {
        await ctx.reply("❌ Sorry, the tutorial video has not been set by the admin yet.");
    }
});

bot.command('setvideo', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("❌ You do not have admin access.");

    ctx.reply(
        "🎬 **Tutorial Video Setup**\n\n" +
        "Please send the **tutorial video** in the next message."
    );
});

bot.on('video', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return; 

    const videoFileId = ctx.message.video.file_id;

    await USER_DATA_KV.put('config_tutorial_video_id', videoFileId);

    ctx.reply("✅ **Tutorial video successfully set!**");
});

bot.command('usercount', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("❌ You do not have admin access.");

    try {
        const listResponse = await USER_DATA_KV.list();
        const userKeys = listResponse.keys.filter(k => k.name.startsWith('user_'));
        
        ctx.reply(`👥 **Total User Count:** ${userKeys.length} users.`);
    } catch (error) {
        console.error("Error fetching user count from KV:", error);
        ctx.reply("❌ Could not fetch user count from DB.");
    }
});

bot.command('broadcast', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("❌ You do not have admin access.");

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
    
    const listResponse = await USER_DATA_KV.list();
    const userKeys = listResponse.keys.filter(k => k.name.startsWith('user_'));

    for (const userKey of userKeys) {
        const userId = parseInt(userKey.name.replace('user_', ''));
        try {
            await ctx.telegram.sendMessage(userId, broadcastText, { parse_mode: 'HTML' });
            successCount++;
            await new Promise(resolve => setTimeout(resolve, 50)); 
        } catch (error) {
            failureCount++;
        }
    }

    await ctx.telegram.editMessageText(
        statusMsg.chat.id, 
        statusMsg.message_id,
        `✅ **Broadcast successfully completed!**\nSuccessful: ${successCount}\nFailed: ${failureCount}`
    );
});


// --- 7. WORKER ENTRY POINT (ES Module Format) ---

// Telegraf Webhook handler function
async function webhookHandler(request) {
    try {
        const url = new URL(request.url);
        const secretPath = url.pathname.replace('/', ''); 
        
        // This is a minimal check, Telegraf handles the rest of the verification
        if (secretPath !== BOT_TOKEN) {
            return new Response('Invalid Request', { status: 403 });
        }
        
        const update = await request.json();
        await bot.handleUpdate(update);
        return new Response('OK', { status: 200 });
    } catch (error) {
        console.error("Worker Error processing update:", error.message);
        return new Response('Error', { status: 500 });
    }
}

// 2. Export the handler as the default object (Module Worker format)
export default {
    async fetch(request, env, ctx) {
        // Expose KV binding and Secrets to the global scope for Telegraf access
        globalThis.USER_DATA_KV = env.USER_DATA_KV;
        
        // Expose all environment variables/secrets as process.env
        // Note: env is implicitly available globally in Worker context for bindings.
        // For Telegraf's process.env access, we rely on nodejs_compat, but manually passing helps.
        
        return webhookHandler(request);
    }
};
