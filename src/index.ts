import { createClient } from "@supabase/supabase-js";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";

const SUPABASE_URL = "https://hvafjlqhichtfcwcmkfj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2YWZqbHFoaWNodGZjd2Nta2ZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxODU3NzEsImV4cCI6MjA4NDc2MTc3MX0.f99YTmFSNRNgBqFOsNU-WZlXAb0OYDAkfyZ8f-YEHbM";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


/* ================= MAPA ================= */
const map = L.map("map").setView([49.8175, 15.473], 7);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

/* ================= AUTH ================= */
const AUTH_KEY = "isAuthenticated";
let isAuthenticated = localStorage.getItem(AUTH_KEY) === "true";
const ADMIN_PASSWORD = "tajne-heslo";

/* ================= PREVIEW ================= */
let previewMarker: L.Marker | null = null;
let previewLatLng: { lat: number; lng: number } | null = null;

const previewIcon = L.divIcon({
  className: "",
  html: `<div class="preview-marker"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8], // střed
});

/* ================= LOGIN UI ================= */
function login(password: string) {
  if (password === ADMIN_PASSWORD) {
    isAuthenticated = true;
    localStorage.setItem(AUTH_KEY, "true");
    renderAuthUI();
  } else {
    alert("Nesprávné heslo");
  }
}

function logout() {
  isAuthenticated = false;
  localStorage.removeItem(AUTH_KEY);
  renderAuthUI();
}

function renderAuthUI() {
  const authDiv = document.getElementById("auth")!;
  const adminPanel = document.getElementById("admin-panel")!;

  authDiv.innerHTML = "";

  if (!isAuthenticated) {
    adminPanel.style.display = "none";
    authDiv.innerHTML = `
      <h3>Přihlášení</h3>
      <input type="password" id="password" placeholder="Heslo" />
      <button id="login-btn">Přihlásit</button>
    `;
    document.getElementById("login-btn")!.onclick = () => {
      const pwd = (document.getElementById("password") as HTMLInputElement)
        .value;
      login(pwd);
    };
  } else {
    adminPanel.style.display = "block";
    authDiv.innerHTML = `
      <p><strong>Přihlášen</strong></p>
      <button id="logout-btn">Odhlásit</button>
    `;
    document.getElementById("logout-btn")!.onclick = logout;
  }
}

/* ================= GEO ================= */
async function geocodeCity(city: string) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    city
  )}`;

  const res = await fetch(url, { headers: { "Accept-Language": "cs" } });
  const data = await res.json();
  if (!data.length) return null;

  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
  };
}

/* ================= KAPELY ================= */
type Band =
  | "Kupodivu"
  | "Big Band Lanškroun"
  | "Homoguru"
  | "Poletíme?"
  | "The People"
  | "Ostatní";

const bands: Band[] = [
  "Kupodivu",
  "Big Band Lanškroun",
  "Homoguru",
  "Poletíme?",
  "The People",
  "Ostatní",
];

const bandColors: Record<Band, string> = {
  Kupodivu: "#1e88e5",
  "Big Band Lanškroun": "#d32f2f",
  Homoguru: "#388e3c",
  "Poletíme?": "#f57c00",
  "The People": "#ff6582",
  Ostatní: "#616161",
};

/* ================= DATA ================= */
type Concert = {
  id: string;
  band: Band;
  lat: number;
  lng: number;
};

let concerts: Concert[] = [];

async function loadConcertsFromDB(): Promise<Concert[]> {
  const { data, error } = await supabase
    .from("concerts")
    .select("id, band, lat, lng");

  if (error) {
    console.error("Supabase load error:", error);
    alert("Nepodařilo se načíst koncerty z databáze. Detaily v konzoli.");
    return [];
  }

  return data as Concert[];
}

async function insertConcertToDB(concert: Concert): Promise<boolean> {
  const { error } = await supabase.from("concerts").insert({
    id: concert.id,
    band: concert.band,
    lat: concert.lat,
    lng: concert.lng,
  });

  if (error) {
    console.error("Supabase insert error:", error);
    alert("Koncert se nepodařilo uložit. Detaily v konzoli.");
    return false;
  }
  return true;
}

async function deleteConcertFromDB(id: string): Promise<boolean> {
  const { error } = await supabase.from("concerts").delete().eq("id", id);

  if (error) {
    console.error("Supabase delete error:", error);
    alert("Koncert se nepodařilo smazat. Detaily v konzoli.");
    return false;
  }
  return true;
}

/* ================= MARKERY ================= */
const markersByBand: Record<Band, L.CircleMarker[]> = {
  Kupodivu: [],
  "Big Band Lanškroun": [],
  Homoguru: [],
  "Poletíme?": [],
  "The People": [],
  Ostatní: [],
};

const activeBands: Record<Band, boolean> = {
  Kupodivu: true,
  "Big Band Lanškroun": true,
  Homoguru: true,
  "Poletíme?": true,
  "The People": true,
  Ostatní: true,
};

/* ================= CREATE ================= */
async function createConcert(band: Band, lat: number, lng: number) {
  const concert: Concert = {
    id: crypto.randomUUID(),
    band,
    lat,
    lng,
  };

  // Nejdřív zápis do DB, až po úspěchu lokální stav + marker
  const ok = await insertConcertToDB(concert);
  if (!ok) return;

  concerts.push(concert);
  addConcertMarker(concert);
  renderLegend();
}

/* ================= MARKER ================= */
const deletePopup = L.popup();

function addConcertMarker(concert: Concert) {
  const marker = L.circleMarker([concert.lat, concert.lng], {
    radius: 8,
    color: bandColors[concert.band],
    fillColor: bandColors[concert.band],
    fillOpacity: 0.9,
  }).addTo(map);

  markersByBand[concert.band].push(marker);

  marker.on("contextmenu", (e: any) => {
    if (!isAuthenticated) return;
    L.DomEvent.stop(e);
    deletePopup
      .setLatLng(e.latlng)
      .setContent(`<button id="del">Smazat bod</button>`)
      .openOn(map);

    setTimeout(() => {
      document.getElementById("del")!.onclick = async () => {
        // Nejdřív DB, až po úspěchu odstraníme z mapy a stavu
        const ok = await deleteConcertFromDB(concert.id);
        if (!ok) return;

        map.removeLayer(marker);
        markersByBand[concert.band] = markersByBand[concert.band].filter(
          (m) => m !== marker
        );
        concerts = concerts.filter((c) => c.id !== concert.id);
        renderLegend();
        map.closePopup();
      };
    }, 0);
  });
}

/* ================= LEGENDA ================= */
const legend = L.control({ position: "topright" });
let legendContainer: HTMLDivElement;

legend.onAdd = () => {
  legendContainer = L.DomUtil.create("div");
  legendContainer.style.background = "white";
  legendContainer.style.padding = "8px";
  legendContainer.style.borderRadius = "4px";
  legendContainer.style.boxShadow = "0 0 6px rgba(0,0,0,0.2)";
  legendContainer.style.fontSize = "14px";
  renderLegend();
  return legendContainer;
};

legend.addTo(map);

function renderLegend() {
  if (!legendContainer) return;
  legendContainer.innerHTML = "";
  bands.forEach((band) => {
    const count = concerts.filter((c) => c.band === band).length;
    const item = document.createElement("div");
    item.style.opacity = activeBands[band] ? "1" : "0.4";
    item.style.cursor = "pointer";
    item.innerHTML = `
      <span style="display:flex;align-items:center;">
        <span style="width:12px;height:12px;background:${bandColors[band]};
        border-radius:50%;margin-right:6px;"></span>
        ${band} <strong>(${count})</strong>
      </span>`;
    item.onclick = () => {
      activeBands[band] = !activeBands[band];
      markersByBand[band].forEach((m) =>
        activeBands[band] ? m.addTo(map) : map.removeLayer(m)
      );
      renderLegend();
    };
    legendContainer.appendChild(item);
  });
}

/* ================= MAP RIGHT CLICK ================= */
const bandMenuPopup = L.popup();

map.on("contextmenu", (e: any) => {
  if (!isAuthenticated) return;

  const html = `
    <div style="display:flex;flex-direction:column;gap:6px;">
      ${bands
        .map(
          (b) => `
            <button data-band="${b}" style="
              background:${bandColors[b]};
              color:white;border:none;border-radius:4px;
              padding:6px;cursor:pointer;text-align:left;">
              ${b}
            </button>`
        )
        .join("")}
    </div>
  `;

  bandMenuPopup.setLatLng(e.latlng).setContent(html).openOn(map);

  setTimeout(() => {
    document.querySelectorAll("[data-band]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const band = (btn as HTMLElement).dataset.band as Band;
        createConcert(band, e.latlng.lat, e.latlng.lng);
        map.closePopup();
      })
    );
  }, 0);
});

/* ================= SIDEBAR GEO ================= */
document.getElementById("find-place")?.addEventListener("click", async () => {
  if (!isAuthenticated) return;

  const city = (
    document.getElementById("sidebar-city") as HTMLInputElement
  ).value.trim();
  if (!city) return alert("Zadej město");

  const result = await geocodeCity(city);
  if (!result) return alert("Město nenalezeno");

  if (previewMarker) map.removeLayer(previewMarker);

  previewLatLng = { lat: result.lat, lng: result.lng };

  previewMarker = L.marker([result.lat, result.lng], {
    draggable: true,
    icon: previewIcon,
  }).addTo(map);

  map.setView([result.lat, result.lng], 11);

  // při tahu aktualizujeme uloženou pozici
  previewMarker.on("drag", (e) => {
    const pos = (e.target as L.Marker).getLatLng();
    previewLatLng = { lat: pos.lat, lng: pos.lng };
  });

  // zobraz potvrzovací panel
  (document.getElementById("confirm-panel") as HTMLElement).style.display =
    "block";
});

/* ================= CONFIRM / CANCEL ================= */
document.getElementById("confirm-concert")?.addEventListener("click", async () => {
  if (!previewLatLng) return;

  const band = (document.getElementById("sidebar-band") as HTMLSelectElement)
    .value as Band;

  await createConcert(band, previewLatLng.lat, previewLatLng.lng);

  cleanupPreview();
});

document
  .getElementById("cancel-concert")
  ?.addEventListener("click", cleanupPreview);

function cleanupPreview() {
  if (previewMarker) map.removeLayer(previewMarker);
  previewMarker = null;
  previewLatLng = null;
  (document.getElementById("confirm-panel") as HTMLElement).style.display =
    "none";
}

/* ================= INIT ================= */

async function initApp() {
  // POZOR: přiřazujeme do GLOBÁLNÍ `concerts`, žádné `const concerts = ...`
  concerts = await loadConcertsFromDB();

  concerts.forEach(addConcertMarker);
  renderLegend();
  renderAuthUI();
}

initApp();
