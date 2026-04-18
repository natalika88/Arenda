require("dotenv").config();
const express = require("express");
const path = require("path");
const {
  initDb,
  checkAvailability,
  calculatePrice,
  createBooking,
  getMonth,
  upsertDay,
  updateDayPrice,
  updateMonthPrices
} = require("./booking-service");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

function requireBasicAdmin(req, res, next) {
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD === "change-this-admin-password") {
    res.status(503).type("text/plain; charset=utf-8")
      .send("Задайте ADMIN_USER и ADMIN_PASSWORD в файле .env и перезапустите сервер.");
    return;
  }

  const hdr = req.headers.authorization || "";
  const m = /^Basic\s+(.+)$/i.exec(hdr);
  if (!m) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Arenda Admin"');
    res.status(401).send("Unauthorized");
    return;
  }

  let decoded = "";
  try {
    decoded = Buffer.from(m[1], "base64").toString("utf8");
  } catch {
    res.setHeader("WWW-Authenticate", 'Basic realm="Arenda Admin"');
    res.status(401).send("Unauthorized");
    return;
  }

  const colon = decoded.indexOf(":");
  const u = colon >= 0 ? decoded.slice(0, colon) : decoded;
  const p = colon >= 0 ? decoded.slice(colon + 1) : "";

  if (u !== ADMIN_USER || p !== ADMIN_PASSWORD) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Arenda Admin"');
    res.status(401).send("Unauthorized");
    return;
  }

  return next();
}

app.use(express.json());

app.get("/api/admin/calendar", requireBasicAdmin, async (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const rows = await getMonth(year, month);
    res.json({ year, month, days: rows });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/admin/day", requireBasicAdmin, async (req, res) => {
  try {
    const row = await upsertDay(req.body);
    res.json({ ok: true, day: row });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/admin/day-price", requireBasicAdmin, async (req, res) => {
  try {
    const { date, pricePerNight } = req.body;
    const row = await updateDayPrice(date, pricePerNight);
    res.json({ ok: true, day: row });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/admin/month-prices", requireBasicAdmin, async (req, res) => {
  try {
    const result = await updateMonthPrices(req.body);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get(["/admin", "/admin.html"], requireBasicAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/api/availability", async (req, res) => {
  try {
    const { checkin, checkout, guests } = req.query;
    const result = await checkAvailability(checkin, checkout, Number(guests || 1));
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/price", async (req, res) => {
  try {
    const { checkin, checkout, guests } = req.query;
    const result = await calculatePrice(checkin, checkout, Number(guests || 1));
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/bookings", async (req, res) => {
  try {
    const booking = await createBooking(req.body);
    res.status(201).json({ ok: true, booking });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/calendar", async (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const rows = await getMonth(year, month);
    res.json({ year, month, days: rows });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use(express.static(__dirname));

async function start() {
  await initDb();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Booking server running on http://localhost:${PORT}`);
  });
}

start();
