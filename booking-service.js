const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dbPath = path.join(__dirname, "booking.db");
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseISO(iso) {
  const [y, m, d] = (iso || "").split("-").map(Number);
  if (!y || !m || !d) return null;
  const parsed = new Date(y, m - 1, d);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function defaultPriceForDate(date) {
  const day = date.getDay();
  return day === 0 || day === 6 ? 7000 : 5000;
}

async function ensureDay(dateISO) {
  const existing = await get("SELECT date FROM daily_rates WHERE date = ?", [dateISO]);
  if (existing) return;
  const date = parseISO(dateISO);
  const price = defaultPriceForDate(date);
  await run(
    `INSERT INTO daily_rates (date, status, price_per_night, guest_limit)
     VALUES (?, 'free', ?, 6)`,
    [dateISO, price]
  );
}

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS daily_rates (
    date TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('free','busy')) DEFAULT 'free',
    price_per_night INTEGER NOT NULL,
    guest_limit INTEGER NOT NULL DEFAULT 6,
    note TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checkin TEXT NOT NULL,
    checkout TEXT NOT NULL,
    guests INTEGER NOT NULL,
    guest_name TEXT NOT NULL,
    guest_phone TEXT NOT NULL,
    guest_email TEXT,
    telegram_user TEXT,
    total_price INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','confirmed','cancelled')) DEFAULT 'confirmed',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}

function validateRange(checkin, checkout) {
  const ci = parseISO(checkin);
  const co = parseISO(checkout);
  if (!ci || !co) {
    throw new Error("Некорректные даты.");
  }
  if (co <= ci) {
    throw new Error("Дата выезда должна быть позже даты заезда.");
  }
  return { ci, co };
}

async function getRangeDays(checkin, checkout) {
  const { ci, co } = validateRange(checkin, checkout);
  const dates = [];
  let cursor = new Date(ci);
  while (cursor < co) {
    dates.push(toISO(cursor));
    cursor = addDays(cursor, 1);
  }

  for (const iso of dates) {
    await ensureDay(iso);
  }

  const placeholders = dates.map(() => "?").join(",");
  return all(
    `SELECT date, status, price_per_night, guest_limit
     FROM daily_rates
     WHERE date IN (${placeholders})
     ORDER BY date ASC`,
    dates
  );
}

async function checkAvailability(checkin, checkout, guests = 1) {
  const days = await getRangeDays(checkin, checkout);
  const blocked = days.find((d) => d.status === "busy" || d.guest_limit < guests);
  return {
    available: !blocked,
    blockedDate: blocked ? blocked.date : null,
    nights: days.length,
    days
  };
}

async function calculatePrice(checkin, checkout, guests = 1) {
  const availability = await checkAvailability(checkin, checkout, guests);
  const total = availability.days.reduce((sum, d) => sum + d.price_per_night, 0);
  return {
    ...availability,
    total
  };
}

async function createBooking(payload) {
  const {
    checkin,
    checkout,
    guests,
    guestName,
    guestPhone,
    guestEmail = "",
    telegramUser = ""
  } = payload;

  if (!guestName || !guestPhone) {
    throw new Error("Имя и телефон обязательны.");
  }

  const guestsCount = Number(guests || 1);
  if (Number.isNaN(guestsCount) || guestsCount < 1) {
    throw new Error("Некорректное количество гостей.");
  }

  const pricing = await calculatePrice(checkin, checkout, guestsCount);
  if (!pricing.available) {
    throw new Error(`Даты заняты: ${pricing.blockedDate}`);
  }

  await run("BEGIN TRANSACTION");
  try {
    for (const d of pricing.days) {
      await run("UPDATE daily_rates SET status = 'busy' WHERE date = ?", [d.date]);
    }

    const result = await run(
      `INSERT INTO bookings (
        checkin, checkout, guests, guest_name, guest_phone, guest_email, telegram_user, total_price, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
      [
        checkin,
        checkout,
        guestsCount,
        guestName,
        guestPhone,
        guestEmail,
        telegramUser,
        pricing.total
      ]
    );
    await run("COMMIT");
    return {
      id: result.lastID,
      checkin,
      checkout,
      guests: guestsCount,
      total: pricing.total
    };
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }
}

async function getMonth(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (Number.isNaN(y) || Number.isNaN(m) || m < 1 || m > 12) {
    throw new Error("Некорректный месяц.");
  }

  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const startISO = toISO(first);
  const endISO = toISO(last);

  let cursor = new Date(first);
  while (cursor <= last) {
    await ensureDay(toISO(cursor));
    cursor = addDays(cursor, 1);
  }

  return all(
    `SELECT date, status, price_per_night, guest_limit, note
     FROM daily_rates
     WHERE date BETWEEN ? AND ?
     ORDER BY date ASC`,
    [startISO, endISO]
  );
}

async function upsertDay({ date, status, pricePerNight, guestLimit, note = "" }) {
  const parsed = parseISO(date);
  if (!parsed) throw new Error("Некорректная дата.");

  await ensureDay(date);

  const current = await get(
    "SELECT date, status, price_per_night, guest_limit, note FROM daily_rates WHERE date = ?",
    [date]
  );
  const nextStatus = status || current.status;
  const nextPrice = Number(pricePerNight || current.price_per_night);
  const nextGuestLimit = Number(guestLimit || current.guest_limit);
  if (!["free", "busy"].includes(nextStatus)) throw new Error("Статус должен быть free или busy.");
  if (Number.isNaN(nextPrice) || nextPrice < 0) throw new Error("Некорректная цена.");
  if (Number.isNaN(nextGuestLimit) || nextGuestLimit < 1) throw new Error("Некорректный лимит гостей.");

  await run(
    `UPDATE daily_rates
     SET status = ?, price_per_night = ?, guest_limit = ?, note = ?
     WHERE date = ?`,
    [nextStatus, nextPrice, nextGuestLimit, note, date]
  );

  return get(
    "SELECT date, status, price_per_night, guest_limit, note FROM daily_rates WHERE date = ?",
    [date]
  );
}

module.exports = {
  initDb,
  checkAvailability,
  calculatePrice,
  createBooking,
  getMonth,
  upsertDay
};
