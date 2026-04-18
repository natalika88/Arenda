require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { initDb, calculatePrice } = require("./booking-service");

const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required in .env");
}

const bot = new Telegraf(BOT_TOKEN);

function parseUserInput(text) {
  const match = (text || "").trim().match(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d+))?$/
  );
  if (!match) return null;
  return {
    checkin: match[1],
    checkout: match[2],
    guests: Number(match[3] || 1)
  };
}

bot.start((ctx) =>
  ctx.reply(
    "Отправьте даты в формате:\n2026-06-10 2026-06-14 4\n\nГде последнее число — количество гостей (необязательно)."
  )
);

bot.on("text", async (ctx) => {
  const parsed = parseUserInput(ctx.message.text);
  if (!parsed) {
    await ctx.reply("Не понял формат. Пример: 2026-06-10 2026-06-14 2");
    return;
  }

  try {
    const result = await calculatePrice(parsed.checkin, parsed.checkout, parsed.guests);
    if (!result.available) {
      await ctx.reply(
        `К сожалению, даты заняты.\nПроблемная дата: ${result.blockedDate}`
      );
      return;
    }

    const bookingUrl = `${BASE_URL}/booking.html?checkin=${parsed.checkin}&checkout=${parsed.checkout}&guests=${parsed.guests}`;
    await ctx.reply(
      `Свободно!\n` +
        `Период: ${parsed.checkin} - ${parsed.checkout}\n` +
        `Гостей: ${parsed.guests}\n` +
        `Стоимость: ${result.total.toLocaleString("ru-RU")} ₽`,
      Markup.inlineKeyboard([
        Markup.button.url("Забронировать", bookingUrl)
      ])
    );
  } catch (error) {
    await ctx.reply(`Ошибка: ${error.message}`);
  }
});

async function startBot() {
  await initDb();
  await bot.launch();
  // eslint-disable-next-line no-console
  console.log("Telegram bot started");
}

startBot();
