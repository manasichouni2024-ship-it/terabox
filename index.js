// index.js for Cloudflare Worker (ES Module Syntax)

// Cloudflare Workers Node.js লাইব্রেরিগুলিকে সরাসরি সমর্থন করে না।
// এই import গুলি শুধুমাত্র তখনই কাজ করবে যখন কোডটিকে 'wrangler deploy' দ্বারা বান্ডল করা হবে।
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';

// =========================================================
// ১. কাস্টম কনফিগারেশন ভেরিয়েবল
// =========================================================

const BOT_TOKEN = "8545244121:AAGovQWgpng0WkrKJfjQ6HmtWkK3izZJ0tg"; 
const ADMIN_IDS_RAW = "6295533968,9876543210"; 
const ADMIN_IDS = ADMIN_IDS_RAW.split(',').map(id => parseInt(id.trim()));

// টিউটোরিয়াল ভিডিও ফাইল ID (প্রথমে অ্যাডমিন দ্বারা সেট করতে হবে)
let TUTORIAL_VIDEO_FILE_ID = null;

// =========================================================
// ২. ডেটা স্টোরেজ মক (Workers এ KV বা D1 ব্যবহার করা উচিত)
// যেহেতু MongoDB এখানে কাজ করবে না, আমরা একটি সিমুলেটেড ইন-মেমরি স্টোর ব্যবহার করছি।
// *গুরুত্বপূর্ণ: রিয়েল-ওয়ার্ল্ড Workers এ এই স্টোরটি কাজ করবে না, কারণ এটি স্টেট হারাবে।*
// =========================================================

const userStore = new Map(); // { userId: { access_expires: Date, username: string } }
const configStore = new Map(); // { key: value }

function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

function ensureUserExists(userId, username) {
    if (!userStore.has(userId)) {
        userStore.set(userId, { 
            username: username, 
            access_expires: new Date(Date.now() - 1000) 
        });
    }
}

function hasActiveAccess(userId) {
    const user = userStore.get(userId);
    if (!user) return false;
    return user.access_expires > new Date();
}

function add24HourAccess(userId) {
    const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const user = userStore.get(userId);
    if (user) {
        user.access_expires = newExpiry;
        userStore.set(userId, user);
    }
}

function setConfig(key, value) {
    configStore.set(key, value);
    if (key === 'tutorial_video_id') {
        TUTORIAL_VIDEO_FILE_ID = value;
    }
}

// =========================================================
// ৩. Telegraf বট ইনিসিয়ালাইজেশন এবং হ্যান্ডলার
// =========================================================

const bot = new Telegraf(BOT_TOKEN);

// --- /start কমান্ড ---
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    
    // Cloudflare Workers-এ ডাটাবেস ইন্টারেকশন খুবই জটিল, এটি কেবল সিনট্যাক্সের জন্য
    ensureUserExists(userId, username);
    
    // vplink থেকে ফিরে আসা (Payload চেক করা Workers এ জটিল)
    if (ctx.startPayload) {
        add24HourAccess(userId);
        return ctx.replyWithMarkdown(
            `🥳 **অভিনন্দন ${ctx.from.first_name}!**\n` +
            "আপনার ২৪-ঘণ্টার অ্যাক্সেস সফলভাবে যুক্ত হয়েছে।\n\n" +
            "⬇️ **এবার TeraBox ভিডিওর লিঙ্কটি দিন, আমি ডাউনলোড করে দেব।**"
        );
    }

    const hasAccess = hasActiveAccess(userId);

    if (hasAccess) {
        // সক্রিয় অ্যাক্সেস থাকলে
        return ctx.replyWithMarkdown(
            `👋 **স্বাগতম ${ctx.from.first_name}!**\n` +
            "আপনার কাছে বর্তমানে সক্রিয় ২৪-ঘণ্টার অ্যাক্সেস আছে।\n\n" +
            "⬇️ **TeraBox ভিডিওর লিঙ্কটি দিন, আমি ডাউনলোড করে দেব।**"
        );
    } else {
        // অ্যাক্সেস না থাকলে
        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('🔓 ২৪-ঘণ্টার অ্যাক্সেস নিন', 'get_access'),
                Markup.button.callback('▶️ অ্যাক্সেস টিউটোরিয়াল দেখুন', 'access_tutorial')
            ]
        ]);
        
        return ctx.replyWithMarkdown(
            `👋 **স্বাগতম ${ctx.from.first_name}!**\n\n` +
            "🚨 আপনার বর্তমান **ব্যালেন্স অপর্যাপ্ত**।\n" +
            "আপনাকে ২৪-ঘণ্টার অ্যাক্সেস নিতে হবে।\n\n" +
            "⬇️ **TeraBox ভিডিওর লিঙ্কটি দিন অথবা অ্যাক্সেস নিন।**",
            keyboard
        );
    }
});

// --- Callback Query Handler (Button Clicks) ---
bot.action('get_access', async (ctx) => {
    await ctx.answerCbQuery();
    
    const requestUrl = "https://vplink.in/api?api=bbdcdbe30fa584eb68269dd61da632c591b2ee80&url=https://t.me/TERABOX_0_BOT&alias=terabot&format=text";
    
    await ctx.editMessageText("⏳ অ্যাক্সেস লিঙ্ক তৈরি করা হচ্ছে, অপেক্ষা করুন...");

    try {
        // Workers এ fetch API ব্যবহার করা axios এর চেয়ে ভালো
        const response = await fetch(requestUrl);
        const accessLink = await response.text(); 
        
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url('🔗 এখানে ক্লিক করে অ্যাক্সেস নিন', accessLink.trim())]
        ]);

        await ctx.editMessageText(
            "✅ অ্যাক্সেস লিঙ্ক তৈরি হয়েছে!\n\n" +
            "👇 **নিচের লিঙ্কে ক্লিক করুন এবং প্রক্রিয়াটি সম্পন্ন করার পর আবার /start করে বট-এ আসুন।**\n" +
            "আপনার ২৪-ঘণ্টার অ্যাক্সেস স্বয়ংক্রিয়ভাবে যুক্ত হবে।",
            { reply_markup: keyboard, parse_mode: 'Markdown' }
        );

    } catch (e) {
        console.error("vplink.in API ত্রুটি:", e);
        await ctx.editMessageText("❌ অ্যাক্সেস লিঙ্ক তৈরি করার সময় নেটওয়ার্ক বা API ত্রুটি হয়েছে।");
    }
});

bot.action('access_tutorial', async (ctx) => {
    await ctx.answerCbQuery();
    
    const videoFileId = configStore.get('tutorial_video_id');
    
    if (videoFileId) {
        await ctx.replyWithVideo(videoFileId, {
            caption: "▶️ **২৪-ঘণ্টার অ্যাক্সেস নেওয়ার টিউটোরিয়াল ভিডিও**"
        });
        await ctx.editMessageText("টিউটোরিয়াল ভিডিওটি উপরে পাঠানো হয়েছে।");
    } else {
        await ctx.editMessageText("❌ অ্যাডমিন এখনও কোনো টিউটোরিয়াল ভিডিও সেট করেননি।");
    }
});

// --- TeraBox লিঙ্ক হ্যান্ডলিং ---
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const messageText = ctx.message.text;

    // ১. URL প্যাটার্ন চেক
    if (!messageText.includes("terabox.com") && !messageText.includes("4funbox.com")) {
        return; 
    }

    // ২. অ্যাক্সেস চেক
    const hasAccess = hasActiveAccess(userId);
    if (!hasAccess) {
        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('🔓 ২৪-ঘণ্টার অ্যাক্সেস নিন', 'get_access'),
                Markup.button.callback('▶️ অ্যাক্সেস টিউটোরিয়াল দেখুন', 'access_tutorial')
            ]
        ]);
        return ctx.replyWithMarkdown(
            "🚫 **অ্যাক্সেস নেই!**\n" +
            "ভিডিও ডাউনলোড করার জন্য আপনার **২৪-ঘণ্টার সক্রিয় অ্যাক্সেস** নেই।\n" +
            "দয়া করে অ্যাক্সেস নিন।",
            keyboard
        );
    }
    
    // ৩. ভিডিও ডাউনলোড প্রসেস
    const processingMsg = await ctx.reply("⏳ লিঙ্কটি প্রসেস করা হচ্ছে, দয়া করে অপেক্ষা করুন...");
    
    const teraboxApiUrl = `https://wadownloader.amitdas.site/api/TeraBox/main/?url=${encodeURIComponent(messageText.trim())}`;

    try {
        // Workers এ fetch API ব্যবহার করা হচ্ছে
        const response = await fetch(teraboxApiUrl, { timeout: 30000 }); 
        const data = await response.json();

        if (data.status === "success" && data.media_url) {
            const { media_url, title, thumbnail } = data;

            const downloadKeyboard = Markup.inlineKeyboard([
                [Markup.button.url("🔗 ভিডিওটি ডাউনলোড করুন (URL)", media_url)]
            ]);

            // ভিডিওটি টেলিগ্রামে পাঠানো
            const sentMessage = await ctx.replyWithVideo(media_url, {
                caption: `🎥 **${title}**\n\n` +
                         "⚠️ **ভিডিওটি ফরওয়ার্ড করে সেভ করে নিন। এটি ২০ সেকেন্ডের মধ্যে স্বয়ংক্রিয়ভাবে ডিলিট হয়ে যাবে।**",
                thumbnail: thumbnail, 
                supports_streaming: true,
                reply_markup: downloadKeyboard,
                parse_mode: 'Markdown'
            });

            await ctx.deleteMessage(processingMsg.message_id);

            // ২০ সেকেন্ড পর মেসেজ ডিলিট করার শিডিউল (Workers এ setTimeout খুব নির্ভরযোগ্য নয়)
            // এটি Workers এ background task বা Durable Objects ছাড়া কঠিন
            // আমরা একটি সাধারণ setTimeout ব্যবহার করছি, যা Workers এ ভালোভাবে কাজ নাও করতে পারে।
            setTimeout(async () => {
                try {
                    await ctx.deleteMessage(sentMessage.message_id);
                } catch (e) {
                    console.error("মেসেজ ডিলিট করতে ব্যর্থ:", e);
                }
            }, 20000); 
            
        } else {
            await ctx.reply(`❌ ভিডিও প্রসেস করতে ব্যর্থ হয়েছে: ${data.message || 'অজানা ত্রুটি।'}`);
        }

    } catch (e) {
        console.error("TeraBox API রিকোয়েস্ট ত্রুটি:", e.message);
        await ctx.reply("❌ ভিডিও প্রসেস করার সময় নেটওয়ার্ক বা API ত্রুটি হয়েছে। আবার চেষ্টা করুন।");
    }
});

// --- Admin Commands ---

bot.command('setvideo', (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply("🚫 আপনি অ্যাডমিন নন।");
    }
    
    ctx.reply("দয়া করে টিউটোরিয়াল ভিডিওটি পাঠান।");
});

bot.on('video', (ctx, next) => {
    if (isAdmin(ctx.from.id)) {
        const videoFileId = ctx.message.video.file_id;
        setConfig('tutorial_video_id', videoFileId);
        
        return ctx.replyWithMarkdown(
            `✅ টিউটোরিয়াল ভিডিও সফলভাবে সেট করা হয়েছে।\n` +
            `File ID: \`${videoFileId}\``
        );
    }
    return next();
});

bot.command('usercount', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply("🚫 আপনি অ্যাডমিন নন।");
    }
    
    const count = userStore.size;
    await ctx.replyWithMarkdown(`📊 বটের মোট ইউজারের সংখ্যা: **${count}** জন।`);
});

bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply("🚫 আপনি অ্যাডমিন নন।");
    }
    
    const broadcastMessage = ctx.message.text.substring(ctx.message.text.indexOf(' ') + 1);

    if (ctx.message.text === '/broadcast') {
        return ctx.reply("দয়া করে /broadcast এর পর আপনার মেসেজটি দিন।");
    }

    let sentCount = 0;
    let blockedCount = 0;

    await ctx.reply("⏳ ব্রডকাস্টিং শুরু হয়েছে...");

    // যদিও userStore সঠিক নয়, এটি কেবল একটি ডেমো
    for (const userId of userStore.keys()) { 
        try {
            await ctx.telegram.sendMessage(userId, broadcastMessage, { parse_mode: 'Markdown' });
            sentCount++;
            await new Promise(resolve => setTimeout(resolve, 50)); 
        } catch (e) {
            if (e.message.includes('bot was blocked by the user')) {
                blockedCount++;
            }
        }
    }
            
    await ctx.replyWithMarkdown(
        `✅ ব্রডকাস্টিং সম্পন্ন হয়েছে।\n` +
        `মোট পাঠানো হয়েছে: **${sentCount}** জন।\n` +
        `বট ব্লক করেছে: **${blockedCount}** জন।`
    );
});


// =========================================================
// ৪. Cloudflare Worker Webhook Export (Worker Code's entry point)
// =========================================================

export default {
    /**
     * @param {Request} request 
     * @param {ExecutionContext} env (Environment variables/bindings, if used)
     */
    async fetch(request, env) {
        if (request.method === 'POST') {
            try {
                // টেলিগ্রাম থেকে আসা Webhook ডেটা
                const update = await request.json();
                await bot.handleUpdate(update); 
                return new Response('OK', { status: 200 });
            } catch (e) {
                console.error('Webhook Error:', e);
                return new Response('Error Processing Update', { status: 200 }); 
            }
        }
        return new Response('TeraBox Bot Worker Running!', { status: 200 });
    }
};
