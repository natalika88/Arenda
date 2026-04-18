require("dotenv").config();
const express = require("express");
const path = require("path");
const {
  initDb,
  checkAvailability,
  calculatePrice,
  createBooking,
  getMonth,
  upsertDay
} = require("./booking-service");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change-this-admin-token";

app.use(express.json());
app.use(express.static(__dirname));

function requireAdmin(req, res, next) {
  const token = req.header("x-admin-token") || req.query.token;
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

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

app.get("/api/admin/calendar", requireAdmin, async (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const rows = await getMonth(year, month);
    res.json({ year, month, days: rows });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/admin/day", requireAdmin, async (req, res) => {
  try {
    const row = await upsertDay(req.body);
    res.json({ ok: true, day: row });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

async function start() {
  await initDb();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Booking server running on http://localhost:${PORT}`);
  });
}

start();
