const ACAL_MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
];

const checkinInput = document.getElementById("checkin");
const checkoutInput = document.getElementById("checkout");
const guestsInput = document.getElementById("guests");
const priceEl = document.getElementById("price");
const acalWeekdays = document.getElementById("acalWeekdays");
const acalGrid = document.getElementById("acalGrid");
const acalTitle = document.getElementById("acalTitle");
const acalPrev = document.getElementById("acalPrev");
const acalNext = document.getElementById("acalNext");

let acalViewYear = new Date().getFullYear();
let acalViewMonth = new Date().getMonth();
let monthDays = [];
let monthDaysMap = new Map();

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseISO(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function todayISO() {
  return toISO(new Date());
}

async function loadMonth() {
  const monthHuman = acalViewMonth + 1;
  const res = await fetch(`/api/calendar?year=${acalViewYear}&month=${monthHuman}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Ошибка загрузки календаря.");
  monthDays = data.days || [];
  monthDaysMap = new Map(monthDays.map((d) => [d.date, d]));
}

function renderCalendar() {
  acalTitle.textContent = `${ACAL_MONTHS[acalViewMonth]} ${acalViewYear}`;
  acalGrid.innerHTML = "";

  const first = new Date(acalViewYear, acalViewMonth, 1);
  const startPad = (first.getDay() + 6) % 7;
  const total = Math.ceil((startPad + monthDays.length) / 7) * 7;
  const ci = parseISO(checkinInput.value);
  const co = parseISO(checkoutInput.value);
  const lastNight = co ? addDays(co, -1) : null;

  for (let i = 0; i < total; i += 1) {
    const cell = document.createElement("div");
    cell.className = "acal-cell";
    if (i < startPad || i >= startPad + monthDays.length) {
      cell.classList.add("acal-cell--empty");
      acalGrid.appendChild(cell);
      continue;
    }

    const dayNum = i - startPad + 1;
    const iso = toISO(new Date(acalViewYear, acalViewMonth, dayNum));
    const dayData = monthDaysMap.get(iso);
    const busy = !dayData || dayData.status === "busy";
    const past = iso < todayISO();

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "acal-day";
    btn.textContent = String(dayNum);
    btn.title = dayData ? `${dayData.price_per_night} ₽, до ${dayData.guest_limit} гостей` : "";

    if (busy) btn.classList.add("acal-day--busy");
    if (iso === todayISO()) btn.classList.add("acal-day--today");
    if (ci && co) {
      const d = parseISO(iso);
      if (d >= ci && d < co) btn.classList.add("acal-day--in-range");
      if (ci && d.getTime() === ci.getTime()) btn.classList.add("acal-day--range-start");
      if (lastNight && d.getTime() === lastNight.getTime()) btn.classList.add("acal-day--range-end");
    }
    if (past || busy) btn.disabled = true;

    btn.addEventListener("click", () => onDayClick(iso));
    cell.appendChild(btn);
    acalGrid.appendChild(cell);
  }
}

function onDayClick(iso) {
  const day = monthDaysMap.get(iso);
  if (!day || day.status === "busy") return;

  const selected = parseISO(checkinInput.value);
  const clicked = parseISO(iso);
  if (!selected || clicked <= selected) {
    checkinInput.value = iso;
    checkoutInput.value = "";
  } else {
    checkoutInput.value = iso;
  }
  onDatesChange();
}

async function calculatePrice() {
  const checkin = checkinInput.value;
  const checkout = checkoutInput.value;
  const guests = guestsInput.value || "1";
  if (!checkin || !checkout) {
    priceEl.textContent = "Выберите даты";
    return;
  }
  const res = await fetch(
    `/api/price?checkin=${checkin}&checkout=${checkout}&guests=${guests}`
  );
  const data = await res.json();
  if (!res.ok) {
    priceEl.textContent = data.error || "Ошибка расчета";
    return;
  }
  if (!data.available) {
    priceEl.textContent = `Занято (${data.blockedDate})`;
    return;
  }
  priceEl.textContent = `${data.nights} ночи — ${data.total.toLocaleString("ru-RU")} ₽`;
}

async function onDatesChange() {
  const ci = parseISO(checkinInput.value);
  if (ci) {
    acalViewYear = ci.getFullYear();
    acalViewMonth = ci.getMonth();
    await loadMonth();
  }
  renderCalendar();
  await calculatePrice();
}

async function initCalendar() {
  acalWeekdays.innerHTML = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    .map((t) => `<span>${t}</span>`)
    .join("");

  await loadMonth();
  renderCalendar();
}

acalPrev.addEventListener("click", async () => {
  if (acalViewMonth === 0) {
    acalViewMonth = 11;
    acalViewYear -= 1;
  } else {
    acalViewMonth -= 1;
  }
  await loadMonth();
  renderCalendar();
});

acalNext.addEventListener("click", async () => {
  if (acalViewMonth === 11) {
    acalViewMonth = 0;
    acalViewYear += 1;
  } else {
    acalViewMonth += 1;
  }
  await loadMonth();
  renderCalendar();
});

checkinInput.addEventListener("change", onDatesChange);
checkoutInput.addEventListener("change", onDatesChange);
guestsInput.addEventListener("change", onDatesChange);

window.submitForm = async function submitForm() {
  const guestName = document.getElementById("guestName").value.trim();
  const guestPhone = document.getElementById("guestPhone").value.trim();
  const guestEmail = document.getElementById("guestEmail").value.trim();
  const checkin = checkinInput.value;
  const checkout = checkoutInput.value;
  const consent = document.getElementById("consent").checked;
  const guests = Number(guestsInput.value || 1);

  if (!guestName || !guestPhone) {
    alert("Пожалуйста, заполните имя и телефон.");
    return;
  }
  if (!consent) {
    alert("Подтвердите согласие на обработку персональных данных.");
    return;
  }

  const res = await fetch("/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      checkin,
      checkout,
      guests,
      guestName,
      guestPhone,
      guestEmail
    })
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Не удалось создать бронь.");
    return;
  }
  alert(`Бронь #${data.booking.id} создана. Стоимость: ${data.booking.total.toLocaleString("ru-RU")} ₽`);
};

window.goTelegram = function goTelegram() {
  const text = [
    "Здравствуйте! Хочу забронировать дом.",
    `Даты: ${checkinInput.value || "не выбраны"} - ${checkoutInput.value || "не выбраны"}`,
    `Гостей: ${guestsInput.value || "1"}`,
    `Расчет: ${priceEl.textContent}`
  ].join("\n");
  window.open(`https://t.me/NataliaAI288?text=${encodeURIComponent(text)}`, "_blank");
};

(async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("checkin")) checkinInput.value = params.get("checkin");
  if (params.get("checkout")) checkoutInput.value = params.get("checkout");
  if (params.get("guests")) guestsInput.value = params.get("guests");
  await initCalendar();
  await calculatePrice();
})();
