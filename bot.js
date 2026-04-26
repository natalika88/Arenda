require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Telegraf, Markup } = require("telegraf");
const { initDb, calculatePrice } = require("./booking-service");

const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const MANAGER_PHONE = process.env.MANAGER_PHONE || "+7 931 221-88-67";
const MANAGER_TG = process.env.MANAGER_TG || "NataliaAI288";
const HOUSE_PHOTO_URL = process.env.HOUSE_PHOTO_URL || "";
const REMINDER_DELAY_MS = 2 * 60 * 1000;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required in .env");
}

const bot = new Telegraf(BOT_TOKEN);
const sessions = new Map();
const BRIF_PATH = path.join(__dirname, "brif.txt");
const BRIF_TEXT = loadBrifText();
const BRIF_FAQ = parseBrifFaq(BRIF_TEXT);
const BRIF_INTENTS = [
  {
    keys: ["wi-fi", "wifi", "вайфай", "интернет"],
    answer:
      "Да, в доме есть бесплатный Wi-Fi, покрытие по всему дому."
  },
  {
    keys: ["спальн", "кроват", "мест", "гостей"],
    answer:
      "Дом рассчитан до 6 гостей, спальные места подготовлены, постельное бельё и полотенца предоставляются."
  },
  {
    keys: ["полотен", "белье", "постельн", "простын", "пододеяль"],
    answer:
      "Да, полотенца и свежее постельное бельё предоставляются каждому гостю."
  },
  {
    keys: ["кухн", "посуда", "микровол", "чайник", "холодильник", "плита"],
    answer:
      "Кухня полностью оборудована: посуда, холодильник, плита, микроволновка и чайник есть."
  },
  {
    keys: ["подушк", "одеял"],
    answer:
      "Да, в доме есть подушки и одеяла, всё подготовлено для комфортного сна."
  },
  {
    keys: ["фен", "душ", "туалет", "горяч", "вода"],
    answer:
      "Да, в доме есть душевая, туалет, горячая вода и фен для волос."
  },
  {
    keys: ["телев", "smart", "тв"],
    answer:
      "Да, в доме есть телевизор (Smart TV)."
  },
  {
    keys: ["отоплен", "тепло", "зимой"],
    answer:
      "Да, в доме есть отопление, поэтому отдыхать комфортно и в прохладный сезон."
  },
  {
    keys: ["мангал", "шампур", "решет", "барбекю"],
    answer:
      "Да, для гостей есть мангал, решётка и шампуры."
  },
  {
    keys: ["дет", "ребен", "малыш"],
    answer:
      "Дом подходит для семьи с детьми: есть детский стол и стульчик, на участке достаточно места для игр."
  },
  {
    keys: ["живот", "собак", "кот", "питом"],
    answer:
      "С животными можно по согласованию. Напишите, пожалуйста, породу и размер питомца."
  },
  {
    keys: ["парков", "машин", "авто"],
    answer:
      "На территории есть парковка, обычно до 2–3 автомобилей."
  },
  {
    keys: ["стираль", "посудомоеч", "кондицион"],
    answer:
      "Стиральной и посудомоечной машины в доме нет, кондиционера тоже нет."
  },
  {
    keys: ["адрес", "как добрат", "где находится", "локац"],
    answer:
      "Адрес: Санкт-Петербург, Курортный район, посёлок Белоостров, район Дюны, Западная улица, 6."
  },
  {
    keys: ["заезд", "выезд", "время"],
    answer:
      "Заезд после 14:00, выезд до 12:00. При необходимости можно отдельно уточнить ранний заезд или поздний выезд."
  },
  {
    keys: ["курен", "шум", "правил"],
    answer:
      "Курение в доме запрещено, шум желательно ограничить после 23:00."
  },
  {
    keys: ["что рядом", "инфраструктур", "магазин", "аптек", "останов", "пляж", "гольф"],
    answer:
      "Рядом есть магазины и остановки в Белоострове, а также зона Дюн и побережье Финского залива для отдыха."
  },
  {
    keys: ["оплат", "предоплат", "отмен", "услов"],
    answer:
      "Бронирование по предоплате. Точные условия оплаты и отмены уточняются при подтверждении брони."
  }
];

const REPLIES = {
  hello:
    "Здравствуйте! 👋 Вас приветствует бот Дома в Дюнах. Напишите ваш вопрос.",
  askDates:
    "Напишите даты заезда и выезда, например: 2026-06-10 2026-06-14.",
  askGuests:
    "Сколько будет гостей? Просто напишите число.",
  askContact:
    "Отлично, могу передать бронь менеджеру. Оставьте телефон или нажмите кнопку отправки контакта.",
  askQuestions:
    "Если хотите, отвечу на вопросы по дому и условиям. Когда будете готовы, помогу перейти к бронированию.",
  houseShort:
    "Дом рассчитан до 6 гостей: 3 спальни, тихий участок и удобный заезд из Петербурга.",
  reminder:
    "Если останутся вопросы по дому или условиям, напишите. Когда будете готовы, подберу даты и стоимость.",
  unavailable:
    "На эти даты, к сожалению, уже занято. Могу подобрать ближайшие свободные.",
  fallbackError:
    "Могу помочь с любыми вопросами по дому. Если хотите проверить стоимость, напишите даты так: 2026-06-10 2026-06-14."
};

function loadBrifText() {
  try {
    return fs.readFileSync(BRIF_PATH, "utf8");
  } catch {
    return "";
  }
}

function parseBrifFaq(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const items = [];
  let currentQuestion = "";
  let currentAnswer = [];

  const flush = () => {
    if (!currentQuestion || !currentAnswer.length) return;
    const answer = currentAnswer.join(" ").replace(/\s+/g, " ").trim();
    if (answer) {
      items.push({
        question: currentQuestion,
        answer
      });
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("— ")) {
      flush();
      currentQuestion = line.slice(2).trim();
      currentAnswer = [];
      continue;
    }
    if (currentQuestion) {
      // Останавливаем сбор ответа, если начинается новый раздел.
      if (/^\d+\./.test(line) || /^###/.test(line)) {
        flush();
        currentQuestion = "";
        currentAnswer = [];
        continue;
      }
      currentAnswer.push(line);
    }
  }
  flush();
  return items;
}

function containsAny(text, words) {
  return words.some((w) => text.includes(w));
}

function tokenize(text) {
  return text
    .split(/[^a-zа-я0-9ё-]+/i)
    .map((w) => w.trim())
    .filter(Boolean);
}

function matchesKey(normalizedText, tokens, key) {
  const k = key.toLowerCase().replace(/ё/g, "е");
  if (k.includes(" ")) return normalizedText.includes(k);
  return tokens.some((t) => t === k || t.startsWith(k));
}

function firstSentences(text, count = 2) {
  const parts = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  return parts.slice(0, count).join(" ").trim();
}

function answerFromBrif(text) {
  if (!BRIF_TEXT) return "";
  const lower = text.toLowerCase();
  const normalized = lower.replace(/ё/g, "е");
  const tokens = tokenize(normalized);

  // 0) Сначала intent-скоринг по ключевым словам.
  const intents = BRIF_INTENTS
    .map((intent) => {
      let score = 0;
      for (const key of intent.keys) {
        if (matchesKey(normalized, tokens, key)) score += 1;
      }
      return { ...intent, score };
    })
    .filter((i) => i.score > 0)
    .sort((a, b) => b.score - a.score);

  if (intents.length) {
    return intents[0].answer;
  }

  // 1) Сначала ищем в блоке FAQ, если вопрос похож.
  const rankedFaq = BRIF_FAQ
    .map((item) => {
      const q = item.question.toLowerCase().replace(/ё/g, "е");
      const score =
        (q.includes("wi-fi") && containsAny(normalized, ["wifi", "wi-fi", "вайфай", "интернет"]) ? 3 : 0) +
        (q.includes("спальн") && containsAny(normalized, ["спальн", "кроват", "мест"]) ? 3 : 0) +
        (q.includes("животн") && containsAny(normalized, ["живот", "собак", "кот"]) ? 3 : 0) +
        (q.includes("парков") && containsAny(normalized, ["парков", "машин", "авто"]) ? 3 : 0) +
        (q.includes("мангал") && containsAny(normalized, ["мангал", "шампур", "решет"]) ? 3 : 0) +
        (q.includes("стиральн") && containsAny(normalized, ["стираль", "посудомоеч"]) ? 3 : 0) +
        (q.includes("брониров") && containsAny(normalized, ["брон", "оплат", "предоплат"]) ? 3 : 0);
      return { ...item, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (rankedFaq.length) {
    return firstSentences(rankedFaq[0].answer, 2);
  }

  // 2) Короткие тематические ответы из общего текста brif.
  if (containsAny(normalized, ["адрес", "как добрат", "где находится"])) {
    return "Адрес: Санкт-Петербург, Курортный район, посёлок Белоостров, район Дюны, Западная улица, 6.";
  }
  if (containsAny(normalized, ["заезд", "выезд"])) {
    return "Заезд после 14:00, выезд до 12:00. Если нужно другое время, уточним по возможности.";
  }
  if (containsAny(normalized, ["дет", "ребен"])) {
    return "Дом подходит для семей с детьми: есть детский стол и стульчик, а на участке достаточно места для игр.";
  }
  if (containsAny(normalized, ["курен"])) {
    return "Курение в доме запрещено, на улице — можно.";
  }
  if (containsAny(normalized, ["что рядом", "магазин", "инфраструктур", "останов"])) {
    return "Рядом есть магазины в Белоострове, остановки автобусов и места отдыха в зоне Дюн у Финского залива.";
  }

  // 3) Поиск по строкам brif.txt для свободных формулировок.
  const words = normalized
    .split(/[^a-zа-я0-9ё-]+/i)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !["если", "хотите", "можно", "вопрос", "дому", "условия"].includes(w));
  if (words.length) {
    const lines = BRIF_TEXT
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) =>
        l &&
        !l.startsWith("###") &&
        !/^\d+\./.test(l) &&
        !l.startsWith("*(") &&
        !l.includes("список кнопок") &&
        !l.includes("Дальше — шаблонные ответы")
      );
    let bestLine = "";
    let bestScore = 0;
    for (const line of lines) {
      const ll = line.toLowerCase().replace(/ё/g, "е");
      const score = words.reduce((acc, w) => (ll.includes(w) ? acc + 1 : acc), 0);
      if (score > bestScore) {
        bestScore = score;
        bestLine = line;
      }
    }
    if (bestScore >= 2) {
      return firstSentences(bestLine, 1);
    }
  }

  return "";
}

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
  const m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!m) return null;
  let year = Number(m[3]);
  if (m[3].length === 2) {
    year += 2000;
  }
  const date = new Date(year, Number(m[2]) - 1, Number(m[1]));
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
  // Ищем даты прямо в тексте, чтобы работали форматы:
  // 2026-06-10 2026-06-14
  // 01.05.2026-03.05.2026
  // 01.05.26 по 03.05.26
  const matches = normalized.match(/\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4})/g) || [];
  const candidates = [];
  for (const p of matches) {
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

function hasBookingCore(session) {
  return Boolean(session.checkin && session.checkout && session.guests);
}

async function offerBookingActions(ctx, session) {
  if (!hasBookingCore(session)) {
    await ctx.reply("Чтобы оформить бронь, сначала подскажите даты и количество гостей.", mainKeyboard());
    return;
  }

  await ctx.reply(
    "Готово. Могу дать ссылку для самостоятельной брони или передать вашу заявку менеджеру.",
    Markup.keyboard([
      ["Открыть ссылку брони", "Передать менеджеру"],
      ["Отмена"]
    ]).resize()
  );
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
  // Источник доступности и цены: данные из админки (daily_rates в БД).
  return calculatePrice(checkin, checkout, guests);
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
    "Если захотите, пришлю ссылку для бронирования или передам заявку менеджеру.",
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
    await offerBookingActions(ctx, session);
    scheduleReminder(ctx, session);
    return;
  }

  if (lower === "открыть ссылку брони") {
    if (!hasBookingCore(session)) {
      await ctx.reply("Нужны даты и количество гостей, чтобы открыть ссылку с уже заполненными данными.", mainKeyboard());
      scheduleReminder(ctx, session);
      return;
    }
    await ctx.reply(
      "Вот ссылка на бронь с вашими данными:",
      Markup.inlineKeyboard([
        Markup.button.url(
          "Открыть форму бронирования",
          bookingLink(session.checkin, session.checkout, session.guests)
        )
      ])
    );
    await ctx.reply("Если хотите, могу также передать заявку менеджеру.", mainKeyboard());
    scheduleReminder(ctx, session);
    return;
  }

  if (lower === "передать менеджеру") {
    if (!hasBookingCore(session)) {
      await ctx.reply("Передам менеджеру. Подскажите даты и количество гостей, чтобы заявка была полной.", mainKeyboard());
      scheduleReminder(ctx, session);
      return;
    }
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

  if (
    lower.includes("хочу забронировать") ||
    lower.includes("готов забронировать") ||
    lower.includes("желаю забронировать")
  ) {
    await offerBookingActions(ctx, session);
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

  if (
    lower.includes("сколько стоит") ||
    lower.includes("цена") ||
    lower.includes("стоимост")
  ) {
    if (lower.includes("сутк") || lower.includes("ноч")) {
      await ctx.reply("Обычно будни от 5 000 ₽ за ночь, выходные от 7 000 ₽. Точную стоимость считаю по вашим датам.");
      scheduleReminder(ctx, session);
      return;
    }
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
    const briefAnswer = answerFromBrif(lower);
    await ctx.reply(briefAnswer || REPLIES.houseShort);
    await ctx.reply("Если нужно, могу посчитать стоимость на ваши даты или ответить на другие вопросы.", mainKeyboard());
    scheduleReminder(ctx, session);
    return;
  }

  const briefAnswer = answerFromBrif(lower);
  if (briefAnswer) {
    await ctx.reply(briefAnswer);
    await ctx.reply("Если хотите, также могу проверить доступность и стоимость на ваши даты.", mainKeyboard());
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
  const details = hasBookingCore(session)
    ? `\nЗаявка: ${session.checkin} - ${session.checkout}, гостей: ${session.guests}.`
    : "";
  await ctx.reply(
    `Спасибо. Передала менеджеру ваш контакт: ${phone}.${details} Менеджер свяжется с вами в ближайшее время.`,
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
