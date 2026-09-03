const LOCATIONS = [
  {
    id: "xiamen",
    displayName: "Xiamen",
    latitude: 24.4798,
    longitude: 118.0819,
    timezone: "Asia/Shanghai",
  },
  {
    id: "ningbo",
    displayName: "Ningbo",
    latitude: 29.8683,
    longitude: 121.544,
    timezone: "Asia/Shanghai",
  },
];

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

applyThemePreference();

for (const location of LOCATIONS) {
  const root = document.querySelector(`[data-weather="${location.id}"]`);
  const elements = {
    root,
    temperature: root.querySelector("[data-temperature]"),
    description: root.querySelector("[data-description]"),
    icon: root.querySelector("[data-weather-icon]"),
    status: root.querySelector("[data-status]"),
  };

  renderIcon(elements.icon, "cloud", true);
  loadCachedWeather(location, elements);
  refreshWeather(location, elements);
  window.setInterval(
    () => refreshWeather(location, elements),
    REFRESH_INTERVAL_MS,
  );
}

function applyThemePreference() {
  const theme = new URLSearchParams(window.location.search).get("theme");
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  }
}

function buildEndpoint(location) {
  const params = new URLSearchParams({
    latitude: location.latitude,
    longitude: location.longitude,
    current: "temperature_2m,weather_code,is_day",
    timezone: location.timezone,
  });

  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

async function refreshWeather(location, elements) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(buildEndpoint(location), {
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Weather request failed with ${response.status}`);
    }

    const data = await response.json();
    const current = data.current;

    if (!current || !Number.isFinite(current.temperature_2m)) {
      throw new Error("Weather response is missing current conditions");
    }

    const weather = {
      temperature: Math.round(current.temperature_2m),
      code: Number(current.weather_code),
      isDay: Number(current.is_day) === 1,
      updatedAt: Date.now(),
    };

    localStorage.setItem(getCacheKey(location), JSON.stringify(weather));
    renderWeather(location, elements, weather);
  } catch (error) {
    const hasReading = elements.temperature.textContent !== "--";
    if (!hasReading) {
      elements.description.textContent = "weather unavailable";
      elements.status.textContent = `Current weather for ${location.displayName} is temporarily unavailable.`;
    }
    console.warn(`Could not refresh ${location.displayName} weather:`, error);
  } finally {
    window.clearTimeout(timeout);
    elements.root.setAttribute("aria-busy", "false");
  }
}

function getCacheKey(location) {
  return `${location.id}-weather-current-v1`;
}

function loadCachedWeather(location, elements) {
  try {
    const weather = JSON.parse(localStorage.getItem(getCacheKey(location)));
    const isRecent = Date.now() - weather.updatedAt < 3 * 60 * 60 * 1000;
    if (isRecent && Number.isFinite(weather.temperature)) {
      renderWeather(location, elements, weather);
    }
  } catch {
    // A missing or malformed cache should never prevent a fresh request.
  }
}

function renderWeather(location, elements, weather) {
  const condition = getCondition(weather.code);
  elements.temperature.textContent = weather.temperature;
  elements.description.textContent = condition.description;
  elements.status.textContent = `${weather.temperature} degrees Celsius and ${condition.description} in ${location.displayName}.`;
  renderIcon(elements.icon, condition.icon, weather.isDay);
  elements.root.dataset.ready = "true";
}

function getCondition(code) {
  if (code === 0) return { description: "clear sky", icon: "clear" };
  if (code === 1) return { description: "mainly clear", icon: "partly-cloudy" };
  if (code === 2) return { description: "partly cloudy", icon: "partly-cloudy" };
  if (code === 3) return { description: "overcast clouds", icon: "cloud" };
  if (code === 45 || code === 48) return { description: "fog", icon: "fog" };
  if ([51, 53, 56].includes(code)) return { description: "light drizzle", icon: "rain" };
  if ([55, 57].includes(code)) return { description: "heavy drizzle", icon: "rain" };
  if ([61, 66, 80].includes(code)) return { description: "light rain", icon: "rain" };
  if ([63, 81].includes(code)) return { description: "rain", icon: "rain" };
  if ([65, 67, 82].includes(code)) return { description: "heavy rain", icon: "rain" };
  if ([71, 77, 85].includes(code)) return { description: "light snow", icon: "snow" };
  if ([73, 86].includes(code)) return { description: "snow", icon: "snow" };
  if (code === 75) return { description: "heavy snow", icon: "snow" };
  if ([95, 96, 99].includes(code)) return { description: "thunderstorm", icon: "storm" };
  return { description: "current weather", icon: "cloud" };
}

function renderIcon(iconElement, type, isDay) {
  const sunOrMoon = isDay
    ? '<circle cx="19" cy="18" r="7.2" fill="#FFC84D" stroke="#FFFFFF" stroke-width="1.5"/><g class="sun-rays" stroke="#FFC84D" stroke-width="2" stroke-linecap="round"><path d="M19 5.5v3"/><path d="M19 27.5v3"/><path d="M6.5 18h3"/><path d="M28.5 18h3"/><path d="m10.2 9.2 2.1 2.1"/><path d="m25.7 24.7 2.1 2.1"/><path d="m27.8 9.2-2.1 2.1"/></g>'
    : '<path d="M25.5 8.2a10 10 0 1 0 8.1 15.9 10.5 10.5 0 0 1-8.1-15.9Z" fill="#8EBBFF" stroke="#FFFFFF" stroke-width="1.5"/>';

  const cloudBack = '<g class="cloud-back"><g transform="translate(13 6.5) scale(0.5)"><path d="M19 29.5h14.5a5.5 5.5 0 0 0 .2-11 7.2 7.2 0 0 0-13.7-1.7 6.1 6.1 0 0 0-1 12.7Z" fill="#91C0F8" stroke="#FFFFFF" stroke-width="1.2" stroke-linejoin="round"/></g></g>';
  const cloudFront = '<g class="cloud-front"><g transform="translate(4.6 5.3) scale(0.82)"><path d="M14.5 37h21.8a6.8 6.8 0 0 0 .2-13.6 8.6 8.6 0 0 0-16.4-2.1A7.3 7.3 0 0 0 14.5 37Z" fill="#57A0EE" stroke="#FFFFFF" stroke-width="1.2" stroke-linejoin="round"/></g></g>';
  const cloud = `${cloudBack}${cloudFront}`;

  let drawing = cloud;
  if (type === "clear") drawing = sunOrMoon;
  if (type === "partly-cloudy") drawing = `${sunOrMoon}${cloudFront}`;
  if (type === "rain") {
    drawing = `${cloud}<g class="rain-drops" stroke="#69B9FF" stroke-width="2.2" stroke-linecap="round"><path d="m17 40-2 4"/><path d="m27 40-2 4"/><path d="m37 40-2 4"/></g>`;
  }
  if (type === "snow") {
    drawing = `${cloud}<g class="snow-flakes" fill="#BDE7FF"><circle cx="16" cy="43" r="1.7"/><circle cx="26" cy="43" r="1.7"/><circle cx="36" cy="43" r="1.7"/></g>`;
  }
  if (type === "storm") {
    drawing = `${cloud}<path class="lightning" d="M28 37h-6l3 4h-4l6 7 1-6h4Z" fill="#FFD14D" stroke="#FFFFFF" stroke-width=".7" stroke-linejoin="round"/>`;
  }
  if (type === "fog") {
    drawing = `${cloud}<g class="fog-lines" stroke="#A8B8C8" stroke-width="2" stroke-linecap="round"><path d="M10 41h29"/><path d="M15 46h20"/></g>`;
  }

  iconElement.innerHTML = `
    <svg viewBox="0 0 50 50">
      ${drawing}
    </svg>`;
}
