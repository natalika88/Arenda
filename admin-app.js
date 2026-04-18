const adminWeekdays = document.getElementById("adminWeekdays");
const adminGrid = document.getElementById("adminGrid");
const adminMonth = document.getElementById("adminMonth");
const adminStatus = document.getElementById("adminStatus");
const loadMonthBtn = document.getElementById("loadMonth");

const fetchAdmin = (url, options = {}) =>
  fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.headers || {})
    }
  });

async function readAdminResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || res.statusText };
  }
}

const labels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
adminWeekdays.innerHTML = labels.map((t) => `<span>${t}</span>`).join("");

const now = new Date();
adminMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function loadMonth() {
  const [year, month] = adminMonth.value.split("-").map(Number);
  const res = await fetchAdmin(`/api/admin/calendar?year=${year}&month=${month}`);
  const data = await readAdminResponse(res);
  if (!res.ok) {
    adminStatus.textContent = data.error || "Ошибка загрузки.";
    return;
  }

  renderGrid(data.days, year, month);
  adminStatus.textContent = "Месяц загружен.";
}

function renderGrid(days, year, month) {
  adminGrid.innerHTML = "";
  const first = new Date(year, month - 1, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysMap = new Map(days.map((d) => [d.date, d]));
  const total = Math.ceil((startPad + days.length) / 7) * 7;

  for (let i = 0; i < total; i += 1) {
    const cell = document.createElement("div");
    cell.className = "acal-cell";

    if (i < startPad || i >= startPad + days.length) {
      cell.classList.add("acal-cell--empty");
      adminGrid.appendChild(cell);
      continue;
    }

    const dayNumber = i - startPad + 1;
    const iso = toISO(new Date(year, month - 1, dayNumber));
    const row = daysMap.get(iso);

    const button = document.createElement("button");
    button.type = "button";
    button.className = `acal-day acal-day--admin ${row.status === "busy" ? "acal-day--busy" : ""}`;
    button.innerHTML =
      `<span class="admin-cal-daynum">${dayNumber}</span>` +
      `<span class="admin-cal-price">${Number(row.price_per_night).toLocaleString("ru-RU")} ₽</span>`;
    button.title = `${iso} | ${row.status} | ${row.guest_limit} гостей — клик: правка`;
    button.addEventListener("click", () => editDay(row));

    cell.appendChild(button);
    adminGrid.appendChild(cell);
  }
}

async function editDay(day) {
  const mode = window.prompt(
    `${day.date}\n1 — полная правка (статус, цена, гости)\n2 — только цена`,
    "2"
  );
  if (mode === null || mode === "") return;

  if (mode.trim() === "2") {
    const price = window.prompt(`Цена за ночь (${day.date}), сейчас ${day.price_per_night} ₽:`, String(day.price_per_night));
    if (price === null || price === "") return;

    const res = await fetchAdmin("/api/admin/day-price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: day.date, pricePerNight: Number(price) })
    });
    const data = await readAdminResponse(res);
    if (!res.ok) {
      adminStatus.textContent = data.error || "Ошибка обновления цены.";
      return;
    }
    adminStatus.textContent = `Цена обновлена: ${day.date} → ${data.day.price_per_night} ₽`;
    await loadMonth();
    return;
  }

  if (mode.trim() !== "1") {
    adminStatus.textContent = "Введите 1 или 2.";
    return;
  }

  const status = window.prompt(`Статус для ${day.date} (free/busy):`, day.status);
  if (!status) return;
  const price = window.prompt(`Цена за ночь для ${day.date}:`, String(day.price_per_night));
  if (!price) return;
  const guests = window.prompt(`Лимит гостей для ${day.date}:`, String(day.guest_limit));
  if (!guests) return;
  const note = window.prompt(`Комментарий для ${day.date}:`, day.note || "") || "";

  const res = await fetchAdmin("/api/admin/day", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      date: day.date,
      status: status.trim(),
      pricePerNight: Number(price),
      guestLimit: Number(guests),
      note
    })
  });
  const data = await readAdminResponse(res);
  if (!res.ok) {
    adminStatus.textContent = data.error || "Ошибка обновления даты.";
    return;
  }

  adminStatus.textContent = `Обновлено: ${data.day.date}`;
  await loadMonth();
}

loadMonthBtn.addEventListener("click", loadMonth);

document.getElementById("applyMonthPrices").addEventListener("click", async () => {
  const [year, month] = adminMonth.value.split("-").map(Number);
  const weekdayPrice = Number(document.getElementById("priceWeekday").value);
  const weekendPrice = Number(document.getElementById("priceWeekend").value);
  const includeBusy = document.getElementById("priceIncludeBusy").checked;

  if (Number.isNaN(weekdayPrice) || Number.isNaN(weekendPrice)) {
    adminStatus.textContent = "Укажите корректные цены.";
    return;
  }

  const ok = window.confirm(
    `Применить цены к ${includeBusy ? "всем" : "свободным"} дням ${month}.${year}?\n` +
      `Будни: ${weekdayPrice} ₽, выходные: ${weekendPrice} ₽`
  );
  if (!ok) return;

  const res = await fetchAdmin("/api/admin/month-prices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      year,
      month,
      weekdayPrice,
      weekendPrice,
      includeBusy
    })
  });
  const data = await readAdminResponse(res);
  if (!res.ok) {
    adminStatus.textContent = data.error || "Ошибка.";
    return;
  }
  adminStatus.textContent = `Обновлено дней: ${data.updated}`;
  await loadMonth();
});
