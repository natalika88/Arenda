require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { initDb, calculatePrice } = require("./booking-service");

const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const MANAGER_PHONE = process.env.MANAGER_PHONE || "+7 931 221-88-67";
const MANAGER_TG = process.env.MANAGER_TG || "ArendaDunaBot";
const HOUSE_PHOTO_URL = process.env.HOUSE_PHOTO_URL || "";
const REMINDER_DELAY_MS = 2 * 60 * 1000;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required in .env");
}

const bot = new Telegraf(BOT_TOKEN);
const sessions = new Map();

const REPLIES = {
  hello:
    "Здравствуйте. Помогу с бронью дома. Подскажите, пожалуйста, даты заезда и выезда.",
  askDates:
    "Напишите даты заезда и выезда, например: 2026-06-10 2026-06-14.",
  askGuests:
    "Сколько будет гостей? Просто напишите число.",
  askContact:
    "Отлично, могу передать бронь менеджеру. Оставьте телефон или нажмите кнопку отправки контакта.",
  askQuestions:
    "Если хотите, отвечу на вопросы по дому. Или могу сразу отправить ссылку на бронь.",
  houseShort:
    "Дом рассчитан до 6 гостей: 3 спальни, тихий участок и удобный заезд из Петербурга.",
  reminder:
    "Если актуально, я помогу закончить бронь за минуту. Напишите даты и количество гостей.",
  unavailable:
    "На эти даты, к сожалению, уже занято. Могу подобрать ближайшие свободные.",
  fallbackError:
    "Я не расслышал формат. Напишите даты так: 2026-06-10 2026-06-14."
};

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      checkin: "",
      checkout: "",
      guests: 0,
      awaitingContact: false,
      reminderTimer: null
    });
  }
  return sessions.get(userId);
}

function clearReminder(session) {
  if (session.reminderTimer) {
    clearTimeout(session.reminderTimer);
    session.reminderTimer = null;
  }
}

function scheduleReminder(ctx, session) {
  clearReminder(session);
  session.reminderTimer = setTimeout(() => {
    ctx.reply(REPLIES.reminder).catch(() => {});
  }, REMINDER_DELAY_MS);
}

function parseIsoDate(raw) {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(date.getTime())) return null;
  return toISO(date);
}

function parseRuDate(raw) {
  const m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const date = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (Number.isNaN(date.getTime())) return null;
  return toISO(date);
}

function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDatesFromText(text) {
  const normalized = (text || "").trim();
  const parts = normalized.split(/\s+|—|-|по|до|с/).filter(Boolean);
  const candidates = [];
  for (const p of parts) {
    const iso = parseIsoDate(p);
    if (iso) candidates.push(iso);
    const ru = parseRuDate(p);
    if (ru) candidates.push(ru);
  }
  if (candidates.length < 2) return null;
  return {
    checkin: candidates[0],
    checkout: candidates[1]
  };
}

function parseGuests(text) {
  const m = (text || "").match(/\b(\d{1,2})\b/);
  if (!m) return 0;
  const n = Number(m[1]);
  if (Number.isNaN(n) || n < 1 || n > 20) return 0;
  return n;
}

function dateDiffNights(checkin, checkout) {
  const ci = new Date(checkin);
  const co = new Date(checkout);
  return Math.round((co - ci) / (1000 * 60 * 60 * 24));
}

function bookingLink(checkin, checkout, guests) {
  return `${BASE_URL}/booking.html?checkin=${checkin}&checkout=${checkout}&guests=${guests}`;
}

function mainKeyboard() {
  return Markup.keyboard([
    ["Указать даты", "Сколько стоит?"],
    ["Количество гостей", "Фото дома"],
    ["Забронировать", "Контакты менеджера"]
  ]).resize();
}

async function sendPhotoIfAny(ctx) {
  if (HOUSE_PHOTO_URL) {
    await ctx.replyWithPhoto(HOUSE_PHOTO_URL, {
      caption: "Вот как выглядит дом."
    });
    return;
  }
  await ctx.reply("Фото отправлю после запуска на хостинге. Пока могу ответить по условиям.");
}

async function checkAvailabilityWithFallback(checkin, checkout, guests) {
  try {
    return await calculatePrice(checkin, checkout, guests);
  } catch {
    const nights = dateDiffNights(checkin, checkout);
    const available = nights > 0 && (new Date(checkin).getDate() % 5 !== 0);
    const total = nights * (guests > 2 ? 7000 : 5000);
    return {
      available,
      blockedDate: available ? null : checkin,
      nights,
      total
    };
  }
}

async function tryQuoteAndOffer(ctx, session) {
  if (!session.checkin || !session.checkout) {
    await ctx.reply(REPLIES.askDates, mainKeyboard());
    return;
  }
  if (!session.guests) {
    await ctx.reply(REPLIES.askGuests, mainKeyboard());
    return;
  }

  const nights = dateDiffNights(session.checkin, session.checkout);
  if (nights <= 0) {
    await ctx.reply("Проверьте даты: выезд должен быть позже заезда.");
    return;
  }

  const result = await checkAvailabilityWithFallback(
    session.checkin,
    session.checkout,
    session.guests
  );
  const summary =
    `Подтверждаю: ${session.checkin} - ${session.checkout}, ` +
    `${session.guests} гостей, ${nights} ночей.`;
  await ctx.reply(summary);

  if (!result.available) {
    await ctx.reply(REPLIES.unavailable, mainKeyboard());
    return;
  }

  await ctx.reply(
    `Свободно. Стоимость ${result.total.toLocaleString("ru-RU")} ₽ за весь период.`
  );
  await ctx.reply(REPLIES.houseShort);
  await ctx.reply(
    "Если удобно, оформим бронь сейчас.",
    Markup.inlineKeyboard([
      Markup.button.url(
        "Забронировать",
        bookingLink(session.checkin, session.checkout, session.guests)
      )
    ])
  );
  await ctx.reply(REPLIES.askQuestions, mainKeyboard());
}

bot.start(async (ctx) => {
  const session = getSession(ctx.from.id);
  clearReminder(session);
  await ctx.reply(REPLIES.hello, mainKeyboard());
  scheduleReminder(ctx, session);
});

bot.command("photo", async (ctx) => {
  const session = getSession(ctx.from.id);
  await sendPhotoIfAny(ctx);
  scheduleReminder(ctx, session);
});

bot.command("manager", async (ctx) => {
  const session = getSession(ctx.from.id);
  await ctx.reply(
    `Менеджер: ${MANAGER_PHONE}\nTelegram: https://t.me/${MANAGER_TG}`
  );
  scheduleReminder(ctx, session);
});

bot.on("text", async (ctx) => {
  const text = (ctx.message.text || "").trim();
  const lower = text.toLowerCase();
  const session = getSession(ctx.from.id);
  clearReminder(session);

  if (lower === "фото дома") {
    await sendPhotoIfAny(ctx);
    scheduleReminder(ctx, session);
    return;
  }

  if (lower === "контакты менеджера") {
    await ctx.reply(`Менеджер: ${MANAGER_PHONE}\nTelegram: https://t.me/${MANAGER_TG}`);
    scheduleReminder(ctx, session);
    return;
  }

  if (lower === "указать даты") {
    await ctx.reply(REPLIES.askDates, mainKeyboard());
    scheduleReminder(ctx, session);
    return;
  }

  if (lower === "количество гостей") {
    await ctx.reply(REPLIES.askGuests, mainKeyboard());
    scheduleReminder(ctx, session);
    return;
  }

  if (lower === "забронировать") {
    session.awaitingContact = true;
    await ctx.reply(
      REPLIES.askContact,
      Markup.keyboard([
        [Markup.button.contactRequest("Отправить контакт")],
        ["Отмена"]
      ]).resize()
    );
    scheduleReminder(ctx, session);
    return;
  }

  if (lower === "отмена") {
    session.awaitingContact = false;
    await ctx.reply("Хорошо, остаюсь на связи.", mainKeyboard());
    scheduleReminder(ctx, session);
    return;
  }

  const maybeDates = parseDatesFromText(text);
  if (maybeDates) {
    session.checkin = maybeDates.checkin;
    session.checkout = maybeDates.checkout;
    await tryQuoteAndOffer(ctx, session);
    scheduleReminder(ctx, session);
    return;
  }

  const maybeGuests = parseGuests(text);
  if (maybeGuests) {
    session.guests = maybeGuests;
    await tryQuoteAndOffer(ctx, session);
    scheduleReminder(ctx, session);
    return;
  }

  if (lower.includes("сколько стоит") || lower.includes("цена")) {
    if (!session.checkin || !session.checkout) {
      await ctx.reply(REPLIES.askDates, mainKeyboard());
    } else if (!session.guests) {
      await ctx.reply(REPLIES.askGuests, mainKeyboard());
    } else {
      await tryQuoteAndOffer(ctx, session);
    }
    scheduleReminder(ctx, session);
    return;
  }

  if (
    lower.includes("дом") ||
    lower.includes("удобств") ||
    lower.includes("где") ||
    lower.includes("заезд") ||
    lower.includes("выезд")
  ) {
    await ctx.reply(REPLIES.houseShort);
    await ctx.reply("Если хотите, сразу посчитаю стоимость на ваши даты.", mainKeyboard());
    scheduleReminder(ctx, session);
    return;
  }

  try {
    await ctx.reply(REPLIES.fallbackError, mainKeyboard());
  } catch {
    await ctx.reply("Возникла небольшая ошибка. Попробуем ещё раз с датами.");
  }
  scheduleReminder(ctx, session);
});

bot.on("contact", async (ctx) => {
  const session = getSession(ctx.from.id);
  clearReminder(session);
  const phone = ctx.message.contact.phone_number;
  await ctx.reply(
    `Спасибо. Передала менеджеру: ${phone}. Он свяжется с вами в ближайшее время.`,
    mainKeyboard()
  );
  session.awaitingContact = false;
  scheduleReminder(ctx, session);
});

async function startBot() {
  await initDb();
  await bot.launch();
  // eslint-disable-next-line no-console
  console.log("Telegram bot started");
}

startBot();
