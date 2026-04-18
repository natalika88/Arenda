const adminWeekdays = document.getElementById("adminWeekdays");
const adminGrid = document.getElementById("adminGrid");
const adminMonth = document.getElementById("adminMonth");
const adminToken = document.getElementById("adminToken");
const adminStatus = document.getElementById("adminStatus");
const loadMonthBtn = document.getElementById("loadMonth");

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
  const token = adminToken.value.trim();
  if (!token) {
    adminStatus.textContent = "Введите ADMIN_TOKEN.";
    return;
  }
  const [year, month] = adminMonth.value.split("-").map(Number);
  const res = await fetch(`/api/admin/calendar?year=${year}&month=${month}`, {
    headers: { "x-admin-token": token }
  });
  const data = await res.json();
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
    button.className = `acal-day ${row.status === "busy" ? "acal-day--busy" : ""}`;
    button.textContent = String(dayNumber);
    button.title = `${iso} | ${row.status} | ${row.price_per_night} ₽ | ${row.guest_limit} гостей`;
    button.addEventListener("click", () => editDay(row));

    cell.appendChild(button);
    adminGrid.appendChild(cell);
  }
}

async function editDay(day) {
  const token = adminToken.value.trim();
  const status = window.prompt(`Статус для ${day.date} (free/busy):`, day.status);
  if (!status) return;
  const price = window.prompt(`Цена за ночь для ${day.date}:`, String(day.price_per_night));
  if (!price) return;
  const guests = window.prompt(`Лимит гостей для ${day.date}:`, String(day.guest_limit));
  if (!guests) return;
  const note = window.prompt(`Комментарий для ${day.date}:`, day.note || "") || "";

  const res = await fetch("/api/admin/day", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": token
    },
    body: JSON.stringify({
      date: day.date,
      status: status.trim(),
      pricePerNight: Number(price),
      guestLimit: Number(guests),
      note
    })
  });
  const data = await res.json();
  if (!res.ok) {
    adminStatus.textContent = data.error || "Ошибка обновления даты.";
    return;
  }

  adminStatus.textContent = `Обновлено: ${data.day.date}`;
  await loadMonth();
}

loadMonthBtn.addEventListener("click", loadMonth);
