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
    if (res.status === 401) {
      adminStatus.textContent = "Нет доступа. Откройте /admin в обычном браузере и введите логин/пароль заново.";
    } else {
      adminStatus.textContent = data.error || "Ошибка загрузки.";
    }
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
  const priceRaw = window.prompt(
    `Дата: ${day.date}\nУкажите цену за ночь (₽):`,
    String(day.price_per_night)
  );
  if (priceRaw === null || priceRaw === "") return;
  const price = Number(priceRaw);
  if (Number.isNaN(price) || price < 0) {
    adminStatus.textContent = "Некорректная цена.";
    return;
  }

  const statusRaw = window.prompt(
    `Статус для ${day.date}:\n1 — Свободно\n2 — Занято\n(можно ввести: free/busy или свободно/занято)`,
    day.status === "busy" ? "2" : "1"
  );
  if (statusRaw === null || statusRaw === "") return;
  const statusInput = statusRaw.trim().toLowerCase();
  let status = "";
  if (statusInput === "1" || statusInput === "free" || statusInput === "свободно") {
    status = "free";
  } else if (statusInput === "2" || statusInput === "busy" || statusInput === "занято") {
    status = "busy";
  }
  if (!["free", "busy"].includes(status)) {
    adminStatus.textContent = "Введите 1/2, free/busy или свободно/занято.";
    return;
  }

  const res = await fetchAdmin("/api/admin/day", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      date: day.date,
      status,
      pricePerNight: price,
      guestLimit: Number(day.guest_limit),
      note: day.note || ""
    })
  });
  const data = await readAdminResponse(res);
  if (!res.ok) {
    adminStatus.textContent = data.error || "Ошибка обновления даты.";
    return;
  }

  adminStatus.textContent =
    `Обновлено: ${data.day.date} — ${Number(data.day.price_per_night).toLocaleString("ru-RU")} ₽, ${data.day.status}`;
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

// Автозагрузка календаря при открытии админки.
loadMonth().catch(() => {
  adminStatus.textContent = "Не удалось загрузить календарь. Обновите страницу и войдите в админку снова.";
});
