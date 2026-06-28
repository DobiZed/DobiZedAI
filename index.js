const { Telegraf } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const express = require('express');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

const apiKeys = [
  process.env.GEMINI_KEY_1,
  process.env.GEMINI_KEY_2,
  process.env.GEMINI_KEY_3,
  process.env.GEMINI_KEY_4,
  process.env.GEMINI_KEY_5
].filter(key => key);

let currentKeyIndex = 0;

function getNextGenAIInstance() {
  if (apiKeys.length === 0) {
    return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  const key = apiKeys[currentKeyIndex];
  console.log(`🔄 Routing request to API key index: ${currentKeyIndex + 1}`);
  currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
  return new GoogleGenerativeAI(key);
}

const SYSTEM_PROMPT = `
You are the advanced core AI of "Project Prism". Your primary superpower is turning complex technical, mathematical, and engineering concepts (from either user text OR uploaded images/diagrams) into perfect visual representations (Circuits, Geometric Shapes, Function Plots, and Data Tables) using LaTeX.

DECISION RULE (CRITICAL):
Determine if the user's request (or the provided image) requires any technical formulas, equations, charts, diagrams, geometric shapes, circuits, or structured tables.
1. If NO (it's just a general question, chat, greeting, or simple text), respond with plain text only. Do NOT wrap it in LaTeX code or document structure.
2. If YES, you MUST respond ONLY with a complete, compile-ready LaTeX document. Do not include markdown code wrappers like \`\`\`latex.

STRICT VISUAL & TECHNICAL STANDARDS (WHEN GENERATING LATEX):
- Start exactly with: % !TeX program = xelatex
- Preamble Packages: Include amsmath, tikz, circuitikz, pgfplots.
- xepersian MUST be the absolute last package in the preamble. Font must be strictly: \\settextfont{Amiri}.
- For TEXT/LABELS: Every Persian text inside TikZ/Circuitikz/Plots must be enclosed in \\text{...} to avoid inversion.

- FOR CIRCUITS (Circuitikz): Strict 90-degree orthogonal connections using |- and -| only. No diagonal lines. Mark wire junctions of 3+ wires with a solid dot (*-* or \\node[circ]). Use relative positioning.
- FOR GEOMETRY & DIAGRAMS (TikZ): Draw clear, mathematically accurate shapes. Use named coordinates and relative positioning to avoid overlapping elements.
- FOR PLOTS & GRAPHS (Pgfplots): Always use the 'axis' environment. Label the axes clearly in Persian inside \\text{...}.
- FOR TABLES: Use standard 'tabular' or 'booktabs' environments with proper borders and alignment.

No explanations outside the LaTeX code are allowed if a LaTeX document is triggered.
`;

const queue = [];
let activeWorkers = 0;
const MAX_CONCURRENT = 3;

async function processQueue() {
  if (queue.length === 0 || activeWorkers >= MAX_CONCURRENT) return;
  activeWorkers++;
  const task = queue.shift();
  try { 
    await task(); 
  } catch (e) { 
    console.error("Queue Error:", e); 
  } finally {
    activeWorkers--; 
    processQueue(); 
  }
}

async function handleAIWorkflow(ctx, msg, promptText, imagePart = null) {
  try {
    const genAI = getNextGenAIInstance();
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3.1-flash-lite", 
      systemInstruction: SYSTEM_PROMPT 
    });
    
    const contents = [];
    if (imagePart) contents.push(imagePart);
    contents.push(promptText || "Analyze the input and generate the Prism-compliant LaTeX or plain text response.");

    const result = await model.generateContent(contents);
    let aiResponse = result.response.text().trim();
    let cleanResponse = aiResponse.replace(/```latex/g, '').replace(/```/g, '').trim();

    if (cleanResponse.startsWith('% !TeX program = xelatex') || cleanResponse.includes('\\begin{document}')) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '📊 در حال ساخت المان‌های بصری و فایل PDF نهایی...');
      
      try {
        const response = await axios({
          url: 'https://latexonline.cc/compile',
          method: 'POST',
          data: `text=${encodeURIComponent(cleanResponse)}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          responseType: 'arraybuffer',
          timeout: 25000
        });

        await ctx.replyWithDocument(
          { source: Buffer.from(response.data), filename: 'Prism_Output.pdf' },
          { reply_to_message_id: ctx.message.message_id }
        );
        
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
      } catch (latexError) {
        console.error("LaTeX Compiler Error:", latexError.message);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '❌ سرور کامپایل آنلاین شلوغ است. کد لاتک آماده کامپایل:');
        await ctx.reply(`\`\`\`latex\n${cleanResponse}\n\`\`\``, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
      }
    } else {
      await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
      await ctx.reply(aiResponse, { reply_to_message_id: ctx.message.message_id });
    }
  } catch (geminiError) {
    console.error("Gemini API Error:", geminiError.message);
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '❌ مشکلی در ارتباط با سرور هوش مصنوعی به وجود آمد.');
  }
}

bot.on('text', async (ctx) => {
  const userText = ctx.message.text;
  if (userText.startsWith('/')) return;

  const msg = await ctx.reply('🧠 در حال پردازش و تحلیل متن توسط جمینای...');
  queue.push(() => handleAIWorkflow(ctx, msg, userText));
  processQueue();
});

bot.on('photo', async (ctx) => {
  const msg = await ctx.reply('📸 در حال دانلود و آنالیز تصویر توسط هوش مصنوعی Prism...');
  const caption = ctx.message.caption || "";

  const task = async () => {
    try {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const fileUrl = await ctx.telegram.getFileLink(photo.file_id);
      const response = await axios.get(fileUrl.href, { responseType: 'arraybuffer' });
      
      const imagePart = {
        inlineData: {
          data: Buffer.from(response.data).toString("base64"),
          mimeType: "image/jpeg"
        },
      };

      await handleAIWorkflow(ctx, msg, caption, imagePart);
    } catch (error) {
      console.error("Photo Error:", error.message);
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '❌ خطا در دانلود یا پردازش تصویر شما.');
    }
  };

  queue.push(task);
  processQueue();
});

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SERVER_URL = process.env.SERVER_URL;

if (SERVER_URL) {
  const webhookPath = `/bot${process.env.TELEGRAM_TOKEN}`;
  bot.telegram.setWebhook(`${SERVER_URL}${webhookPath}`)
    .then(() => console.log(`🚀 Webhook set to: ${SERVER_URL}${webhookPath}`))
    .catch(err => console.error("Webhook error:", err.message));
    
  app.post(webhookPath, (req, res) => {
    bot.handleUpdate(req.body, res);
  });
} else {
  bot.launch().then(() => console.log('⚠️ Running on Polling mode...'));
}

app.get('/', (req, res) => {
  res.send('Prism Enterprise Visual Engine is online!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
