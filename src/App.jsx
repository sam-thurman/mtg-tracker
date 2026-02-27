import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

// ─── CONFIG — fill these in after following SETUP.md ─────────────────────────
const SHEETS_CONFIG = {
  spreadsheetId: import.meta.env.VITE_SPREADSHEET_ID,
  apiKey: import.meta.env.VITE_API_KEY,
  clientId: import.meta.env.VITE_CLIENT_ID,
};

// ─── Google Sheets API helpers ────────────────────────────────────────────────
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

async function sheetsGet(range) {
  const { spreadsheetId, apiKey } = SHEETS_CONFIG;
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`Sheets read failed: ${r.status} — ${body?.error?.message || ""}`);
  }
  const d = await r.json();
  return d.values || [];
}

async function sheetsUpdate(range, values, token) {
  const { spreadsheetId } = SHEETS_CONFIG;
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const r = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ range, majorDimension: "ROWS", values })
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`Sheets write failed: ${r.status} — ${body?.error?.message || ""}`);
  }
}

async function sheetsClear(range, token) {
  const { spreadsheetId } = SHEETS_CONFIG;
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`Sheets clear failed: ${r.status} — ${body?.error?.message || ""}`);
  }
}

// --- OAuth2 — redirect flow (works on desktop + mobile) ---
const OAUTH_TOKEN_KEY = "mtg_oauth_token";
const OAUTH_EXPIRY_KEY = "mtg_oauth_expiry";
const PENDING_SAVE_KEY = "mtg_pending_save";

function getStoredToken() {
  const token = sessionStorage.getItem(OAUTH_TOKEN_KEY);
  const expiry = sessionStorage.getItem(OAUTH_EXPIRY_KEY);
  if (!token || !expiry) return null;
  if (Date.now() > parseInt(expiry)) {
    sessionStorage.removeItem(OAUTH_TOKEN_KEY);
    sessionStorage.removeItem(OAUTH_EXPIRY_KEY);
    return null;
  }
  return token;
}

function storeToken(token, expiresIn = 3600) {
  sessionStorage.setItem(OAUTH_TOKEN_KEY, token);
  sessionStorage.setItem(OAUTH_EXPIRY_KEY, String(Date.now() + expiresIn * 1000));
}

function redirectToGoogleAuth() {
  sessionStorage.setItem(PENDING_SAVE_KEY, "1");
  const params = new URLSearchParams({
    client_id: SHEETS_CONFIG.clientId,
    redirect_uri: window.location.origin + window.location.pathname,
    response_type: "token",
    scope: "https://www.googleapis.com/auth/spreadsheets",
    include_granted_scopes: "true",
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function parseTokenFromHash() {
  const hash = window.location.hash.substring(1);
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  const expiresIn = params.get("expires_in");
  if (!token) return null;
  storeToken(token, parseInt(expiresIn) || 3600);
  window.history.replaceState(null, "", window.location.pathname);
  return token;
}

function requestToken(onTokenReady) {
  const existing = getStoredToken();
  if (existing) { onTokenReady(existing); return; }
  redirectToGoogleAuth();
}

// ─── Scryfall API helpers ─────────────────────────────────────────────────────
const SF = "https://api.scryfall.com";

// Batch-fetch color_identity from Scryfall for arbitrary card names (independent of collection)
// Uses POST /cards/collection, max 75 per request
async function fetchColorIdentities(names) {
  const unique = [...new Set(names.filter(Boolean))];
  const map = {};
  for (let i = 0; i < unique.length; i += 75) {
    const batch = unique.slice(i, i + 75);
    try {
      const res = await fetch(`${SF}/cards/collection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: batch.map(name => ({ name })) }),
      });
      if (!res.ok) continue;
      const json = await res.json();
      (json.data || []).forEach(card => {
        map[card.name.toLowerCase()] = card.color_identity || [];
      });
    } catch { /* best-effort */ }
  }
  return map;
}

async function searchCards(name) {
  const r = await fetch(`${SF}/cards/search?q=${encodeURIComponent(name)}&unique=prints&order=released`);
  if (!r.ok) return [];
  const d = await r.json();
  return d.data || [];
}

function getPrice(card) {
  const p = card.prices || {};
  return parseFloat(p.usd || p.usd_foil || 0) || 0;
}

function getPriceLabel(card) {
  const p = card.prices || {};
  if (p.usd) return `$${parseFloat(p.usd).toFixed(2)}`;
  if (p.usd_foil) return `$${parseFloat(p.usd_foil).toFixed(2)} (foil)`;
  return "N/A";
}

function getImage(card) {
  if (card.image_uris) return card.image_uris.normal || card.image_uris.small;
  if (card.card_faces?.[0]?.image_uris) return card.card_faces[0].image_uris.normal;
  return null;
}

function getOracleText(card) {
  if (card.oracle_text) return card.oracle_text;
  if (card.card_faces) return card.card_faces.map(f => `[${f.name}]\n${f.oracle_text || ""}`).join("\n\n");
  return "";
}

function tcgLink(card) {
  return card.purchase_uris?.tcgplayer || `https://www.tcgplayer.com/search/magic/product?q=${encodeURIComponent(card.name)}`;
}

function ckLink(card) {
  const name = card.name?.split(" // ")[0] ?? card.name; // use front face name for DFCs
  return `https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${encodeURIComponent(name)}`;
}

// Known MTG supertypes — stripped when computing the "type permutation"
const SUPERTYPES = new Set(["Legendary", "Basic", "Snow", "World", "Token", "Elite", "Ongoing"]);

// Returns the main-type permutation for a card, e.g. "Artifact Creature", "Instant", "Land"
// Strips supertypes and everything after the "—" (subtypes).
function getTypePermutation(typeLine) {
  const superPart = (typeLine || "").split("—")[0];
  const words = superPart.trim().split(/\s+/).filter(Boolean);
  const mainTypes = words.filter(w => !SUPERTYPES.has(w));
  return mainTypes.join(" ") || "Other";
}

// Preferred display order for deck grouping sections
const TYPE_GROUP_ORDER = [
  "Creature", "Artifact Creature", "Enchantment Creature", "Artifact Enchantment Creature",
  "Planeswalker", "Battle",
  "Instant", "Sorcery",
  "Artifact", "Enchantment", "Artifact Enchantment",
  "Land", "Other",
];

// ─── Serialisation: card ↔ sheet row ─────────────────────────────────────────
// Collection sheet columns: id | name | set_name | set | collector_number | qty | prices_json | card_json
function cardToRow(card) {
  return [
    card.id,
    card.name,
    card.set_name || "",
    card.set || "",
    card.collector_number || "",
    String(card.qty || 1),
    JSON.stringify(card.prices || {}),
    JSON.stringify(card), // full card blob
  ];
}

function rowToCard(row) {
  try {
    const full = JSON.parse(row[7] || "{}");
    return { ...full, qty: parseInt(row[5]) || 1 };
  } catch { return null; }
}

// Decks sheet columns: id | name | format | commander (name) | cards_json
function deckToRow(deck, collection) {
  // Look up commander name from its collection card ID
  const commanderName = deck.commander
    ? (collection?.find(c => c.id === deck.commander)?.name || "")
    : "";
  return [deck.id, deck.name, deck.format || "", commanderName, JSON.stringify(deck.cards)];
}

function rowToDeck(row, collection) {
  try {
    // Look up commander ID from the stored name
    const commanderName = row[3] || "";
    const commanderId = commanderName
      ? (collection?.find(c => c.name === commanderName)?.id || "")
      : "";
    return { id: row[0], name: row[1], format: row[2] || "Standard", commander: commanderId, cards: JSON.parse(row[4] || "[]") };
  } catch { return null; }
}

// ─── Color helpers ────────────────────────────────────────────────────────────
const COLOR_MAP = { W: "#fffde7", U: "#1565c0", B: "#212121", R: "#b71c1c", G: "#1b5e20" };
const COLOR_LABEL = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

function ColorPip({ c }) {
  return (
    <span style={{
      display: "inline-block", width: 14, height: 14, borderRadius: "50%",
      background: COLOR_MAP[c] || "#888", border: "1px solid rgba(255,255,255,0.3)",
      marginRight: 2, verticalAlign: "middle"
    }} title={COLOR_LABEL[c] || c} />
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("search");
  const [collection, setCollection] = useState([]);
  const [decks, setDecks] = useState([]);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | loading | saving | error | unconfigured
  const [syncMsg, setSyncMsg] = useState("");
  const saveTimeout = useRef(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("mtg-theme") || "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("mtg-theme", theme);
  }, [theme]);

  const isConfigured = SHEETS_CONFIG.spreadsheetId !== "YOUR_SPREADSHEET_ID_HERE"
    && SHEETS_CONFIG.apiKey !== "YOUR_API_KEY_HERE"
    && SHEETS_CONFIG.clientId !== "YOUR_CLIENT_ID_HERE";

  // On mount: parse token from URL hash (return from OAuth redirect), then load data
  useEffect(() => {
    if (!isConfigured) { setSyncStatus("unconfigured"); return; }
    const tokenFromRedirect = parseTokenFromHash();
    const pendingSave = sessionStorage.getItem(PENDING_SAVE_KEY);
    if (tokenFromRedirect && pendingSave) {
      sessionStorage.removeItem(PENDING_SAVE_KEY);
      // Load first, then the pending save will fire via triggerSave after state updates
    }
    loadFromSheets();
  }, []);

  const loadFromSheets = async () => {
    setSyncStatus("loading");
    setSyncMsg("Loading from Google Sheets...");
    try {
      const [collRows, deckRows] = await Promise.all([
        sheetsGet("Collection!A2:H1000"),
        sheetsGet("Decks!A2:E1000"),
      ]);
      const cards = collRows.map(rowToCard).filter(Boolean);
      const dks = deckRows.map(row => rowToDeck(row, cards)).filter(Boolean);
      setCollection(cards);
      setDecks(dks);
      setSyncStatus("idle");
      setSyncMsg(`Loaded ${cards.length} cards`);
    } catch (e) {
      setSyncStatus("error");
      setSyncMsg(`Load failed: ${e.message}`);
    }
  };

  const saveToSheets = useCallback(async (col, dks) => {
    if (!isConfigured) return;
    setSyncStatus("saving");
    setSyncMsg("Saving...");
    requestToken(async (token) => {
      if (!token) {
        setSyncStatus("error");
        setSyncMsg("Sign in required to save");
        return;
      }
      try {
        // Write collection
        await sheetsClear("Collection!A2:H1000", token);
        if (col.length > 0) {
          await sheetsUpdate("Collection!A2", col.map(cardToRow), token);
        }
        // Write decks
        await sheetsClear("Decks!A2:E1000", token);
        if (dks.length > 0) {
          await sheetsUpdate("Decks!A2", dks.map(dk => deckToRow(dk, col)), token);
        }
        setSyncStatus("idle");
        setSyncMsg(`Saved ${new Date().toLocaleTimeString()}`);
      } catch (e) {
        setSyncStatus("error");
        setSyncMsg(`Save failed: ${e.message}`);
      }
    });
  }, [isConfigured]);

  // Debounced auto-save whenever collection/decks change
  const collectionRef = useRef(collection);
  const decksRef = useRef(decks);
  collectionRef.current = collection;
  decksRef.current = decks;

  const triggerSave = useCallback(() => {
    if (!isConfigured) return;
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      saveToSheets(collectionRef.current, decksRef.current);
    }, 1500);
  }, [saveToSheets, isConfigured]);

  const addToCollection = useCallback((card) => {
    setCollection(prev => {
      const next = prev.find(c => c.id === card.id)
        ? prev.map(c => c.id === card.id ? { ...c, qty: (c.qty || 1) + 1 } : c)
        : [...prev, { ...card, qty: 1, addedAt: Date.now() }];
      setTimeout(triggerSave, 0);
      return next;
    });
  }, [triggerSave]);

  const removeFromCollection = useCallback((cardId) => {
    setCollection(prev => { const n = prev.filter(c => c.id !== cardId); setTimeout(triggerSave, 0); return n; });
    setDecks(prev => { const n = prev.map(d => ({ ...d, cards: d.cards.filter(c => c.collectionId !== cardId) })); setTimeout(triggerSave, 0); return n; });
  }, [triggerSave]);

  const updateQty = useCallback((cardId, delta) => {
    setCollection(prev => { const n = prev.map(c => c.id === cardId ? { ...c, qty: Math.max(1, (c.qty || 1) + delta) } : c); setTimeout(triggerSave, 0); return n; });
  }, [triggerSave]);

  // Toggle a collection card into/out of a specific deck
  const toggleCardInDeck = useCallback((collectionCard, deckId) => {
    const editionIds = collectionCard._editionCards ? collectionCard._editionCards.map(e => e.id) : [collectionCard.id];
    setDecks(prev => prev.map(dk => {
      if (dk.id !== deckId) return dk;
      const inDeck = dk.cards.some(c => editionIds.includes(c.collectionId));
      return inDeck
        ? { ...dk, cards: dk.cards.filter(c => !editionIds.includes(c.collectionId)) }
        : { ...dk, cards: [...dk.cards, { collectionId: collectionCard.id, qty: 1 }] };
    }));
    setTimeout(triggerSave, 0);
  }, [triggerSave]);

  const totalValue = collection.reduce((sum, c) => sum + getPrice(c) * (c.qty || 1), 0);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", color: "var(--text)" }}>
      {/* Header */}
      <header className="app-header" style={{
        background: "var(--bg-header)",
        borderBottom: "1px solid var(--border-gold)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 28 }}>⚔️</span>
          <div>
            <div style={{ fontSize: 22, fontWeight: "bold", letterSpacing: 2, color: "#c8a84b", textShadow: "0 0 20px rgba(200,168,75,0.5)" }}>ARCANE LEDGER</div>
            <div style={{ fontSize: 11, color: "#888", letterSpacing: 3, textTransform: "uppercase" }}>MTG Collection Tracker</div>
          </div>
        </div>

        <div className="app-header-right">
          {/* Theme toggle */}
          <button
            className="theme-toggle"
            onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>

          {/* Sync status */}
          <div style={{ fontSize: 12, color: syncStatus === "error" ? "#e57373" : syncStatus === "saving" ? "#ffb74d" : syncStatus === "unconfigured" ? "var(--text-muted)" : "#81c784", display: "flex", alignItems: "center", gap: 6 }}>
            <span>{syncStatus === "loading" ? "⟳" : syncStatus === "saving" ? "↑" : syncStatus === "error" ? "⚠" : syncStatus === "unconfigured" ? "⚙" : "✓"}</span>
            <span>{syncMsg || (syncStatus === "unconfigured" ? "Configure Google Sheets in code" : "Ready")}</span>
            {syncStatus === "idle" && isConfigured && (
              <button onClick={loadFromSheets} style={{ marginLeft: 4, background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 12 }}>↻ Refresh</button>
            )}
          </div>

          <div style={{ fontSize: 14, color: "#c8a84b", textAlign: "right", background: "rgba(200,168,75,0.1)", padding: "6px 14px", borderRadius: 6, border: "1px solid rgba(200,168,75,0.2)" }}>
            <div style={{ fontSize: 11, color: "#888", letterSpacing: 1 }}>COLLECTION VALUE</div>
            <div style={{ fontSize: 20, fontWeight: "bold" }}>${totalValue.toFixed(2)}</div>
            <div style={{ fontSize: 11, color: "#888" }}>{collection.reduce((s, c) => s + (c.qty || 1), 0)} cards</div>
          </div>
        </div>
      </header>

      {/* Unconfigured banner */}
      {!isConfigured && (
        <div style={{ background: "rgba(200,100,0,0.15)", borderBottom: "1px solid rgba(200,100,0,0.3)", padding: "10px 24px", fontSize: 13, color: "#ffb74d" }}>
          ⚙️ <strong>Google Sheets not configured.</strong> Open <code>src/App.jsx</code> and fill in <code>SHEETS_CONFIG</code> at the top of the file. See <strong>SETUP.md</strong> for instructions. Your data will not be saved until this is done.
        </div>
      )}

      {/* Nav */}
      <nav style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        {[{ id: "search", label: "🔍 Search & Add" }, { id: "collection", label: "📚 Collection" }, { id: "decks", label: "🃏 Decks" }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: "14px 8px", border: "none", cursor: "pointer",
            background: tab === t.id ? "rgba(200,168,75,0.12)" : "transparent",
            color: tab === t.id ? "#c8a84b" : "#888",
            borderBottom: tab === t.id ? "2px solid #c8a84b" : "2px solid transparent",
            fontSize: 14, fontFamily: "inherit", letterSpacing: 1, transition: "all 0.2s"
          }}>{t.label}</button>
        ))}
      </nav>

      <main className="app-main">
        {tab === "search" && <SearchTab onAdd={addToCollection} collection={collection} decks={decks} onToggleDeck={toggleCardInDeck} />}
        {tab === "collection" && <CollectionTab collection={collection} onRemove={removeFromCollection} onQty={updateQty} decks={decks} onToggleDeck={toggleCardInDeck} />}
        {tab === "decks" && <DecksTab decks={decks} setDecks={(fn) => { setDecks(fn); setTimeout(triggerSave, 0); }} collection={collection} />}
      </main>
    </div>
  );
}

// ─── Search Tab ───────────────────────────────────────────────────────────────
function SearchTab({ onAdd, collection, decks, onToggleDeck }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [cameraMode, setCameraMode] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraError, setCameraError] = useState("");
  const { tooltip, handleMouseEnter, handleMouseMove, handleMouseLeave } = useCardTooltip();

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSelected(null);
    const cards = await searchCards(query);
    setResults(cards);
    setLoading(false);
    if (cards.length === 1) setSelected(cards[0]);
  };

  const startCamera = async () => {
    setCameraError("");
    setCameraMode(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setCameraError("Camera access denied or unavailable.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setCameraMode(false);
  };

  const captureFrame = async () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d").drawImage(videoRef.current, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg");
    stopCamera();
    setLoading(true);
    try {
      const base64 = dataUrl.split(",")[1];
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 200,
          messages: [{
            role: "user", content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
              { type: "text", text: "What is the exact name of this Magic: The Gathering card? Reply with ONLY the card name, nothing else. If you cannot identify it, reply UNKNOWN." }
            ]
          }]
        })
      });
      const data = await response.json();
      const name = data.content?.[0]?.text?.trim();
      if (name && name !== "UNKNOWN") {
        setQuery(name);
        const cards = await searchCards(name);
        setResults(cards);
        if (cards.length === 1) setSelected(cards[0]);
      } else {
        setCameraError("Could not recognize card. Please try manual entry.");
      }
    } catch { setCameraError("Recognition failed. Please try manual entry."); }
    setLoading(false);
  };

  const inCollection = selected ? collection.some(c => c.id === selected.id) : false;

  // ── Inline-action state for the results list ──────────────────────────────
  // Which card row has its deck popover open (by card.id), or null
  const [openDeckPopover, setOpenDeckPopover] = useState(null);
  // { card, deckId } when user picks a deck for a card not yet in collection
  const [pendingInlineAdd, setPendingInlineAdd] = useState(null);

  const handleInlineDeckToggle = (card, deckId) => {
    const collectionCard = collection.find(c => c.id === card.id);
    if (collectionCard) {
      // Already in collection — toggle directly
      onToggleDeck(collectionCard, deckId);
    } else {
      const deck = decks?.find(d => d.id === deckId);
      const alreadyInDeck = deck?.cards.some(c => c.collectionId === card.id);
      if (alreadyInDeck) {
        onToggleDeck({ id: card.id }, deckId);
      } else {
        // Not in collection and not yet in deck — prompt
        setPendingInlineAdd({ card, deckId });
        setOpenDeckPopover(null);
      }
    }
  };

  const handleInlinePendingConfirm = (alsoAddToCollection) => {
    const { card, deckId } = pendingInlineAdd;
    setPendingInlineAdd(null);
    if (alsoAddToCollection) onAdd(card);
    onToggleDeck({ id: card.id }, deckId);
  };

  return (
    <div>
      <div className="search-bar-row">
        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()}
          placeholder="Search card name..." style={{ padding: "12px 16px", background: "var(--input-bg)", border: "1px solid rgba(200,168,75,0.3)", borderRadius: 8, color: "var(--text)", fontSize: 16, fontFamily: "inherit", outline: "none" }} />
        <button onClick={search} style={btnStyle("#c8a84b", "#1a1200")}>Search</button>
        <button onClick={cameraMode ? stopCamera : startCamera} style={btnStyle("#4a8a6a", "#001a0d")}>{cameraMode ? "✕ Cancel" : "📷 Scan"}</button>
      </div>

      {cameraMode && (
        <div style={{ marginBottom: 16, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(200,168,75,0.3)", position: "relative" }}>
          <video ref={videoRef} autoPlay playsInline style={{ width: "100%", maxHeight: 300, objectFit: "cover", display: "block" }} />
          <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)" }}>
            <button onClick={captureFrame} style={btnStyle("#c8a84b", "#1a1200")}>📸 Capture</button>
          </div>
        </div>
      )}
      {cameraError && <div style={{ color: "#e57373", marginBottom: 12, fontSize: 13 }}>{cameraError}</div>}
      {loading && <div style={{ color: "#c8a84b", textAlign: "center", padding: 40 }}>✨ Searching the archives...</div>}

      {!loading && results.length > 1 && !selected && (
        <div>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 8, letterSpacing: 1 }}>SELECT VERSION — {results.length} printings found · click a card for full details</div>
          <div style={{ display: "grid", gap: 4, maxHeight: 480, overflowY: "auto" }}>
            {results.map(card => {
              const inColl = collection.some(c => c.id === card.id);
              const collectionCard = collection.find(c => c.id === card.id);
              const hasDeckPopoverOpen = openDeckPopover === card.id;
              return (
                <div key={card.id}
                  style={{
                    background: "var(--card-row-bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    overflow: "visible",
                    position: "relative",
                    zIndex: hasDeckPopoverOpen ? 10 : 1
                  }}>

                  {/* ── Clickable info area: navigates to CardDetail ── */}
                  <button
                    onClick={() => { setSelected(card); handleMouseLeave(); setOpenDeckPopover(null); }}
                    onMouseEnter={e => handleMouseEnter(card, e)}
                    onMouseMove={e => handleMouseMove(card, e)}
                    onMouseLeave={handleMouseLeave}
                    style={{ flex: 1, background: "none", border: "none", cursor: "pointer", color: "var(--text)", display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", textAlign: "left", fontFamily: "inherit", minWidth: 0 }}>
                    <img src={card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small} style={{ width: 36, borderRadius: 3, flexShrink: 0 }} alt="" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: "bold", fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.name}</div>
                      <div style={{ fontSize: 12, color: "#888", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.set_name} ({card.set?.toUpperCase()}) · {card.collector_number}</div>
                    </div>
                    <div style={{ color: "#c8a84b", fontWeight: "bold", flexShrink: 0, fontSize: 13 }}>{getPriceLabel(card)}</div>
                  </button>

                  {/* ── Inline action buttons ── */}
                  <div style={{ display: "flex", gap: 6, paddingRight: 10, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    {/* Add to Collection */}
                    <button
                      onClick={() => onAdd(card)}
                      title={inColl ? "Add another copy to collection" : "Add to collection"}
                      style={{
                        padding: "5px 10px", borderRadius: 6, border: `1px solid ${inColl ? "rgba(74,170,74,0.5)" : "rgba(200,168,75,0.4)"}`,
                        background: inColl ? "rgba(74,170,74,0.1)" : "rgba(200,168,75,0.08)",
                        color: inColl ? "#81c784" : "#c8a84b", cursor: "pointer", fontSize: 12,
                        fontFamily: "inherit", whiteSpace: "nowrap", transition: "all 0.15s",
                      }}>
                      {inColl ? "✓" : "+"} {inColl ? "In Collection" : "Collection"}
                    </button>

                    {/* Add to Deck — only if decks exist */}
                    {decks && decks.length > 0 && (
                      <div style={{ position: "relative" }}>
                        <button
                          id={`deck-btn-${card.id}`}
                          onClick={() => { setOpenDeckPopover(hasDeckPopoverOpen ? null : card.id); handleMouseLeave(); }}
                          title="Add to a deck"
                          style={{
                            padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(168,85,247,0.4)",
                            background: hasDeckPopoverOpen ? "rgba(168,85,247,0.15)" : "rgba(168,85,247,0.07)",
                            color: "#c084fc", cursor: "pointer", fontSize: 12,
                            fontFamily: "inherit", whiteSpace: "nowrap", transition: "all 0.15s",
                          }}>
                          🃏 Deck {hasDeckPopoverOpen ? "▲" : "▾"}
                        </button>
                        {hasDeckPopoverOpen && (
                          <DeckSelector
                            card={collectionCard || card}
                            decks={decks}
                            onToggle={(deckId) => handleInlineDeckToggle(card, deckId)}
                            onClose={() => setOpenDeckPopover(null)}
                            anchorEl={document.getElementById(`deck-btn-${card.id}`)}
                            alignRight
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && selected && <CardDetail card={selected} onAdd={onAdd} inCollection={inCollection} onBack={() => setSelected(null)} decks={decks} onToggleDeck={onToggleDeck} collection={collection} />}
      {/* Suppress tooltip when any modal or popover is active, or a card is selected */}
      {!selected && !openDeckPopover && !pendingInlineAdd && (
        <CardTooltip card={tooltip?.card} x={tooltip?.x} y={tooltip?.y} />
      )}

      {/* Inline AddToCollectionPrompt for results list */}
      {pendingInlineAdd && (
        <AddToCollectionPrompt
          cardName={pendingInlineAdd.card.name}
          onYes={() => handleInlinePendingConfirm(true)}
          onNo={() => handleInlinePendingConfirm(false)}
        />
      )}
    </div>
  );
}
function CardDetail({ card, onAdd, inCollection, onBack, decks, onToggleDeck, collection }) {
  const [showFull, setShowFull] = useState(false);
  const [deckSelectorOpen, setDeckSelectorOpen] = useState(false);
  const [pendingDeckId, setPendingDeckId] = useState(null); // deck awaiting collection prompt
  const img = getImage(card);

  // Find the collection entry for this Scryfall card (matched by Scryfall id)
  const collectionCard = collection?.find(c => c.id === card.id);

  const handleDeckToggle = (deckId) => {
    if (collectionCard) {
      // Already in collection — toggle directly
      onToggleDeck(collectionCard, deckId);
    } else {
      // Not in collection — check if we're removing (it could already be in deck via a prior add)
      // If card is being added (not yet in deck), prompt to add to collection
      const deck = decks?.find(d => d.id === deckId);
      const alreadyInDeck = deck?.cards.some(c => c.collectionId === card.id);
      if (alreadyInDeck) {
        // Just remove — use card.id directly as a pseudo-collectionId
        onToggleDeck({ id: card.id }, deckId);
      } else {
        // Adding to deck — show collection prompt first
        setPendingDeckId(deckId);
      }
    }
  };

  const handleAddToDeckWithCollection = (alsoAddToCollection) => {
    const deckId = pendingDeckId;
    setPendingDeckId(null);
    if (alsoAddToCollection) onAdd(card);
    // Use the card's Scryfall id as the collectionId (onAdd will create it with this id)
    onToggleDeck({ id: card.id }, deckId);
  };
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(200,168,75,0.2)", borderRadius: 12 }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>← Back to results</button>
      </div>
      <div className="card-detail-grid">
        <div className="card-detail-img-col" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          {img ? (
            <div>
              <img src={img} alt={card.name} style={{ width: 200, borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.6)", cursor: "pointer" }} onClick={() => setShowFull(true)} />
              <div style={{ fontSize: 10, color: "#666", textAlign: "center", marginTop: 4 }}>click to enlarge</div>
            </div>
          ) : <div style={{ width: 200, height: 280, background: "rgba(255,255,255,0.05)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: "#555" }}>No image</div>}
          <a href={tcgLink(card)} target="_blank" rel="noreferrer" style={linkStyle("#2a6a99")}>TCGPlayer</a>
          <a href={ckLink(card)} target="_blank" rel="noreferrer" style={linkStyle("#8b6914")}>Card Kingdom</a>
        </div>
        <div className="card-detail-info-col" style={{ padding: "20px 20px 20px 0" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
            <h2 style={{ margin: 0, fontSize: 22, color: "var(--text)", fontStyle: "italic" }}>{card.name}</h2>
            <div style={{ fontSize: 24, color: "#c8a84b", fontWeight: "bold" }}>{getPriceLabel(card)}</div>
          </div>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>{card.set_name} · {card.set?.toUpperCase()} #{card.collector_number}</div>
          {card.colors?.length > 0 && <div style={{ marginBottom: 8 }}>{card.colors.map(c => <ColorPip key={c} c={c} />)}</div>}
          <div style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: "#aaa" }}>{card.type_line}</span>
            {card.power != null && <span style={{ fontSize: 13, color: "#c8a84b", marginLeft: 12 }}>{card.power}/{card.toughness}</span>}
          </div>
          {card.mana_cost && <div style={{ fontSize: 13, color: "#888", marginBottom: 10 }}>Mana Cost: {card.mana_cost}</div>}
          <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "12px 14px", marginBottom: 12, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "#d0c8b8", fontStyle: "italic" }}>
            {getOracleText(card) || "No oracle text"}
          </div>
          {card.flavor_text && <div style={{ fontSize: 13, color: "#666", fontStyle: "italic", marginBottom: 12 }}>"{card.flavor_text}"</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => onAdd(card)} style={{ ...btnStyle(inCollection ? "#4a6a4a" : "#c8a84b", inCollection ? "#001a00" : "#1a1200"), fontSize: 15, padding: "12px 24px" }}>
              {inCollection ? "✓ Add Another Copy" : "+ Add to Collection"}
            </button>
            {decks && decks.length > 0 && (
              <div style={{ position: "relative" }}>
                <button
                  id="detail-deck-btn"
                  onClick={() => setDeckSelectorOpen(o => !o)}
                  style={{ ...btnStyle("#3b2d6e", "#c084fc"), fontSize: 14, padding: "12px 18px" }}>
                  🃏 Add to Deck ▾
                </button>
                {deckSelectorOpen && (
                  <DeckSelector
                    card={collectionCard || card}
                    decks={decks}
                    onToggle={handleDeckToggle}
                    onClose={() => setDeckSelectorOpen(false)}
                    anchorEl={document.getElementById("detail-deck-btn")}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {showFull && (
        <div onClick={() => setShowFull(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <img src={card.image_uris?.large || img} alt={card.name} style={{ maxHeight: "90vh", maxWidth: "90vw", borderRadius: 14 }} />
        </div>
      )}
      {pendingDeckId && (
        <AddToCollectionPrompt
          cardName={card.name}
          onYes={() => handleAddToDeckWithCollection(true)}
          onNo={() => handleAddToDeckWithCollection(false)}
        />
      )}
    </div>
  );
}

// ─── Shared deck-management components ───────────────────────────────────────

// Floating popover: list of decks with checkmarks.
// card: the collection card (has .id used as collectionId).
// onToggle(deckId) is called when user clicks a row.
function DeckSelector({ card, decks, onToggle, onClose, alignRight, anchorEl }) {
  const ref = useRef(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target) && !anchorEl?.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorEl]);

  useEffect(() => {
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      setCoords({
        top: rect.bottom + window.scrollY + 6,
        left: alignRight ? rect.right + window.scrollX - 220 : rect.left + window.scrollX
      });
    }
  }, [anchorEl, alignRight]);

  const content = (
    <div ref={ref} style={{
      position: "absolute",
      top: coords.top,
      left: coords.left,
      zIndex: 2000,
      background: "#1a1a20", border: "1px solid rgba(168,85,247,0.3)",
      borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
      minWidth: 220, maxHeight: 320, overflowY: "auto", padding: 6,
    }}>
      <div style={{ fontSize: 10, letterSpacing: 1, color: "#666", padding: "4px 8px 6px" }}>ADD / REMOVE FROM DECK</div>
      {decks.length === 0 && <div style={{ padding: "8px 10px", fontSize: 13, color: "#555" }}>No decks yet.</div>}
      {decks.map(dk => {
        const editionIds = card._editionCards ? card._editionCards.map(e => e.id) : [card.id];
        const inDeck = dk.cards.some(c => editionIds.includes(c.collectionId));
        return (
          <div key={dk.id} onClick={() => onToggle(dk.id)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
              borderRadius: 6, cursor: "pointer", marginBottom: 2,
              background: inDeck ? "rgba(168,85,247,0.12)" : "rgba(255,255,255,0.02)",
            }}>
            <div style={{
              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
              border: `1.5px solid ${inDeck ? "#a855f7" : "rgba(255,255,255,0.2)"}`,
              background: inDeck ? "rgba(168,85,247,0.3)" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {inDeck && <span style={{ fontSize: 10, color: "#c084fc" }}>✓</span>}
            </div>
            <div style={{ flex: 1, fontSize: 13, color: inDeck ? "#c084fc" : "#e8e0d0" }}>{dk.name}</div>
            <span style={{
              fontSize: 9, fontWeight: "bold", padding: "1px 5px", borderRadius: 3,
              background: dk.format === "Commander" ? "rgba(138,43,226,0.2)" : "rgba(200,168,75,0.1)",
              color: dk.format === "Commander" ? "#c084fc" : "#c8a84b",
            }}>{dk.format === "Commander" ? "CMD" : "STD"}</span>
          </div>
        );
      })}
    </div>
  );

  return createPortal(content, document.body);
}

// Modal: "Add this card to your collection too?"
function AddToCollectionPrompt({ cardName, onYes, onNo }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#1a1a20", border: "1px solid rgba(200,168,75,0.3)", borderRadius: 14, padding: "28px 32px", maxWidth: 360, textAlign: "center", boxShadow: "0 12px 40px rgba(0,0,0,0.8)" }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>📚</div>
        <div style={{ fontSize: 16, fontWeight: "bold", color: "var(--text)", marginBottom: 8 }}>{cardName}</div>
        <div style={{ fontSize: 14, color: "#888", marginBottom: 24, lineHeight: 1.5 }}>
          This card isn't in your collection yet.<br />Add it to your collection too?
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button onClick={onNo} style={{ ...btnStyle("rgba(255,255,255,0.08)", "#aaa"), padding: "10px 20px" }}>Deck only</button>
          <button onClick={onYes} style={{ ...btnStyle("#c8a84b", "#1a1200"), padding: "10px 20px" }}>+ Add to both</button>
        </div>
      </div>
    </div>
  );
}

// ─── Collection Tab ───────────────────────────────────────────────────────────
function CollectionTab({ collection, onRemove, onQty, decks, onToggleDeck }) {
  const [search, setSearch] = useState("");
  const [filterColor, setFilterColor] = useState("all");
  const [filterSupertypes, setFilterSupertypes] = useState(new Set()); // supertype multi-select
  const [filterTypes, setFilterTypes] = useState(new Set()); // type multi-select
  const [filterSubtype, setFilterSubtype] = useState("");    // subtype autocomplete
  const [filterMV, setFilterMV] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [viewMode, setViewMode] = useState("all"); // "all" | "unique"
  const [superMenuOpen, setSuperMenuOpen] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const superMenuRef = useRef(null);
  const typeMenuRef = useRef(null);

  // Derive unique keywords (words left of "—") split into supertypes and main types
  const superPartWords = collection.flatMap(c => (c.type_line || "").split("—")[0].trim().split(/\s+/).filter(Boolean));

  const allSupertypes = [...new Set(
    superPartWords.filter(w => SUPERTYPES.has(w))
  )].sort();

  const allTypeKeywords = [...new Set(
    superPartWords.filter(w => !SUPERTYPES.has(w))
  )].sort();

  // Exact type permutations (full combo, e.g. "Artifact Creature") — only multi-word ones
  const allTypePermutations = [...new Set(
    collection.map(c => getTypePermutation(c.type_line)).filter(p => p && p.includes(" "))
  )].sort();

  const allSubtypes = [...new Set(
    collection.flatMap(c => {
      const after = (c.type_line || "").split("—")[1];
      return after ? after.trim().split(/\s+/).filter(Boolean) : [];
    })
  )].sort();

  // Close menus on outside click
  useEffect(() => {
    const handler = e => {
      if (typeMenuRef.current && !typeMenuRef.current.contains(e.target)) setTypeMenuOpen(false);
      if (superMenuRef.current && !superMenuRef.current.contains(e.target)) setSuperMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  let cards = [...collection];
  if (search) { const q = search.toLowerCase(); cards = cards.filter(c => c.name.toLowerCase().includes(q) || (c.oracle_text || "").toLowerCase().includes(q) || (c.type_line || "").toLowerCase().includes(q)); }
  if (filterColor !== "all") cards = cards.filter(c => c.colors?.includes(filterColor));
  if (filterSupertypes.size > 0) cards = cards.filter(c => {
    const words = (c.type_line || "").split("—")[0].split(/\s+/);
    return [...filterSupertypes].some(s => words.includes(s));
  });
  if (filterTypes.size > 0) cards = cards.filter(c => {
    const perm = getTypePermutation(c.type_line);
    return [...filterTypes].some(selected => {
      if (selected.includes(" ")) return perm === selected;
      return perm.split(/\s+/).includes(selected);
    });
  });
  if (filterSubtype) { const q = filterSubtype.toLowerCase(); cards = cards.filter(c => ((c.type_line || "").split("—")[1] || "").toLowerCase().includes(q)); }
  if (filterMV !== "") cards = cards.filter(c => c.cmc === parseInt(filterMV));
  if (sortBy === "name") cards.sort((a, b) => a.name.localeCompare(b.name));
  if (sortBy === "price") cards.sort((a, b) => getPrice(b) - getPrice(a));
  if (sortBy === "color") cards.sort((a, b) => (a.colors?.[0] || "Z").localeCompare(b.colors?.[0] || "Z"));
  if (sortBy === "mv") cards.sort((a, b) => (a.cmc || 0) - (b.cmc || 0));

  // Unique names mode: collapse editions into a single row per card name
  let displayCards = cards;
  if (viewMode === "unique") {
    const byName = new Map();
    cards.forEach(c => {
      if (!byName.has(c.name)) {
        byName.set(c.name, { ...c, _totalQty: c.qty || 1, _editions: 1, _editionCards: [c] });
      } else {
        const existing = byName.get(c.name);
        existing._totalQty += (c.qty || 1);
        existing._editions += 1;
        existing._editionCards.push(c);
      }
    });
    displayCards = [...byName.values()].map(c => ({ ...c, qty: c._totalQty }));
  }

  const totalValue = collection.reduce((s, c) => s + getPrice(c) * (c.qty || 1), 0);

  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        {[{ label: "Total Cards", value: collection.reduce((s, c) => s + (c.qty || 1), 0) }, { label: "Unique Cards", value: collection.length }, { label: "Total Value", value: `$${totalValue.toFixed(2)}` }].map(s => (
          <div key={s.label} style={{ flex: 1, minWidth: 120, background: "rgba(200,168,75,0.08)", border: "1px solid rgba(200,168,75,0.2)", borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: "#888", letterSpacing: 1 }}>{s.label.toUpperCase()}</div>
            <div style={{ fontSize: 20, fontWeight: "bold", color: "#c8a84b" }}>{s.value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, text, type..." style={filterInputStyle} />
        <select value={filterColor} onChange={e => setFilterColor(e.target.value)} style={filterInputStyle}>
          <option value="all">All Colors</option>
          <option value="W">White</option><option value="U">Blue</option>
          <option value="B">Black</option><option value="R">Red</option><option value="G">Green</option>
        </select>

        {/* Supertype multi-select dropdown */}
        <div ref={superMenuRef} style={{ position: "relative" }}>
          <button onClick={() => setSuperMenuOpen(o => !o)} style={{
            ...filterInputStyle, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
            borderColor: filterSupertypes.size > 0 ? "rgba(200,168,75,0.5)" : undefined,
            color: filterSupertypes.size > 0 ? "#c8a84b" : "#888",
          }}>
            {filterSupertypes.size === 0 ? "Supertype" : [...filterSupertypes].join(", ")}
            {filterSupertypes.size > 0 && (
              <span onClick={e => { e.stopPropagation(); setFilterSupertypes(new Set()); }}
                style={{ marginLeft: 4, color: "#e57373", fontWeight: "bold", lineHeight: 1 }}>×</span>
            )}
            <span style={{ marginLeft: "auto", fontSize: 10, opacity: 0.5 }}>{superMenuOpen ? "▲" : "▼"}</span>
          </button>
          {superMenuOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
              background: "#1a1a20", border: "1px solid rgba(200,168,75,0.2)",
              borderRadius: 8, padding: 6, minWidth: 160, maxHeight: 280, overflowY: "auto",
              boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
            }}>
              {allSupertypes.map(t => {
                const active = filterSupertypes.has(t);
                return (
                  <div key={t} onClick={() => setFilterSupertypes(prev => {
                    const next = new Set(prev);
                    active ? next.delete(t) : next.add(t);
                    return next;
                  })} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
                    borderRadius: 5, cursor: "pointer", marginBottom: 2,
                    background: active ? "rgba(200,168,75,0.12)" : "rgba(255,255,255,0.02)",
                  }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                      border: `1.5px solid ${active ? "#c8a84b" : "rgba(255,255,255,0.2)"}`,
                      background: active ? "rgba(200,168,75,0.3)" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>{active && <span style={{ fontSize: 9, color: "#c8a84b" }}>✓</span>}</div>
                    <span style={{ fontSize: 13, color: active ? "#c8a84b" : "#e8e0d0" }}>{t}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {/* Type multi-select dropdown */}
        <div ref={typeMenuRef} style={{ position: "relative" }}>
          <button onClick={() => setTypeMenuOpen(o => !o)} style={{
            ...filterInputStyle, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
            borderColor: filterTypes.size > 0 ? "rgba(200,168,75,0.5)" : undefined,
            color: filterTypes.size > 0 ? "#c8a84b" : "#888",
          }}>
            {filterTypes.size === 0 ? "Type" : [...filterTypes].join(", ")}
            {filterTypes.size > 0 && (
              <span onClick={e => { e.stopPropagation(); setFilterTypes(new Set()); }}
                style={{ marginLeft: 4, color: "#e57373", fontWeight: "bold", lineHeight: 1 }}>×</span>
            )}
            <span style={{ marginLeft: "auto", fontSize: 10, opacity: 0.5 }}>{typeMenuOpen ? "▲" : "▼"}</span>
          </button>
          {typeMenuOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
              background: "#1a1a20", border: "1px solid rgba(200,168,75,0.2)",
              borderRadius: 8, padding: "8px 6px", minWidth: 200, maxHeight: 350, overflowY: "auto",
              boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
            }}>
              <div style={{ fontSize: 10, color: "#666", padding: "4px 8px", letterSpacing: 1 }}>KEYWORDS</div>
              {allTypeKeywords.map(t => {
                const active = filterTypes.has(t);
                return (
                  <div key={t} onClick={() => setFilterTypes(prev => {
                    const next = new Set(prev);
                    active ? next.delete(t) : next.add(t);
                    return next;
                  })} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
                    borderRadius: 5, cursor: "pointer", marginBottom: 2,
                    background: active ? "rgba(200,168,75,0.12)" : "rgba(255,255,255,0.02)",
                  }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                      border: `1.5px solid ${active ? "#c8a84b" : "rgba(255,255,255,0.2)"}`,
                      background: active ? "rgba(200,168,75,0.3)" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>{active && <span style={{ fontSize: 9, color: "#c8a84b" }}>✓</span>}</div>
                    <span style={{ fontSize: 13, color: active ? "#c8a84b" : "#e8e0d0" }}>{t}</span>
                  </div>
                );
              })}
              {allTypePermutations.length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: "#666", padding: "12px 8px 4px", letterSpacing: 1, borderTop: "1px solid rgba(255,255,255,0.05)", marginTop: 4 }}>PERMUTATIONS</div>
                  {allTypePermutations.map(t => {
                    const active = filterTypes.has(t);
                    return (
                      <div key={t} onClick={() => setFilterTypes(prev => {
                        const next = new Set(prev);
                        active ? next.delete(t) : next.add(t);
                        return next;
                      })} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
                        borderRadius: 5, cursor: "pointer", marginBottom: 2,
                        background: active ? "rgba(200,168,75,0.12)" : "rgba(255,255,255,0.02)",
                      }}>
                        <div style={{
                          width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                          border: `1.5px solid ${active ? "#c8a84b" : "rgba(255,255,255,0.2)"}`,
                          background: active ? "rgba(200,168,75,0.3)" : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>{active && <span style={{ fontSize: 9, color: "#c8a84b" }}>✓</span>}</div>
                        <span style={{ fontSize: 13, color: active ? "#c8a84b" : "#e8e0d0" }}>{t}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
        {/* Subtype autocomplete */}
        <div style={{ position: "relative" }}>
          <input
            id="subtype-search"
            value={filterSubtype}
            onChange={e => setFilterSubtype(e.target.value)}
            placeholder="Subtype..."
            list="subtype-list"
            style={{ ...filterInputStyle, minWidth: 140 }}
          />
          <datalist id="subtype-list">
            {allSubtypes
              .filter(s => !filterSubtype || s.toLowerCase().startsWith(filterSubtype.toLowerCase()))
              .map(s => <option key={s} value={s} />)}
          </datalist>
        </div>
        <input value={filterMV} onChange={e => setFilterMV(e.target.value)} placeholder="Mana Value" type="number" min="0" style={{ ...filterInputStyle, width: 100 }} />
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={filterInputStyle}>
          <option value="name">Sort: Name</option><option value="price">Sort: Price</option>
          <option value="color">Sort: Color</option><option value="mv">Sort: Mana Value</option>
        </select>
        {/* View mode toggle */}
        <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)", marginLeft: "auto", flexShrink: 0 }}>
          {[{ id: "all", label: "All Editions" }, { id: "unique", label: "Unique Names" }].map(v => (
            <button key={v.id} onClick={() => setViewMode(v.id)} style={{
              padding: "6px 12px", border: "none", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
              background: viewMode === v.id ? "rgba(200,168,75,0.2)" : "rgba(255,255,255,0.03)",
              color: viewMode === v.id ? "#c8a84b" : "#666",
              fontWeight: viewMode === v.id ? "bold" : "normal",
            }}>{v.label}</button>
          ))}
        </div>
      </div>
      {collection.length === 0
        ? <div style={{ textAlign: "center", padding: 60, color: "#555" }}><div style={{ fontSize: 48, marginBottom: 12 }}>📜</div><div>Your collection is empty.</div></div>
        : <div style={{ display: "grid", gap: 4 }}>{displayCards.map(card => <CollectionRow key={card.id} card={card} onRemove={onRemove} onQty={onQty} decks={decks} onToggleDeck={onToggleDeck} readOnly={viewMode === "unique"} />)}</div>
      }
    </div>
  );
}

function CollectionRow({ card, onRemove, onQty, decks, onToggleDeck, readOnly }) {
  const [expanded, setExpanded] = useState(false);
  const [deckSelectorOpen, setDeckSelectorOpen] = useState(false);
  const img = getImage(card);
  const { tooltip, handleMouseEnter, handleMouseMove, handleMouseLeave } = useCardTooltip();
  const editionIds = card._editionCards ? card._editionCards.map(e => e.id) : [card.id];
  const decksWithCard = decks ? decks.filter(d => d.cards.some(c => editionIds.includes(c.collectionId))).length : 0;
  const editions = card._editions || 1;
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, borderLeft: `3px solid ${card.colors?.[0] ? COLOR_MAP[card.colors[0]] : "#555"}`, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}>
        {/* Image + name: tooltip fires here only, not on buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}
          onMouseEnter={e => { if (!e.target.closest("button")) handleMouseEnter(card, e); }}
          onMouseMove={e => { if (!e.target.closest("button")) handleMouseMove(card, e); else handleMouseLeave(); }}
          onMouseLeave={handleMouseLeave}>
          {img && <img src={img} style={{ width: 40, borderRadius: 4 }} alt="" />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: "bold", fontSize: 14 }}>{card.name}</div>
            <div style={{ fontSize: 12, color: "#666" }}>
              {card.type_line}
              {readOnly && editions > 1
                ? <span style={{ marginLeft: 6, fontSize: 11, color: "#a855f7", background: "rgba(168,85,247,0.12)", padding: "1px 6px", borderRadius: 3 }}>{editions} editions</span>
                : <span> · {card.set_name}</span>}
            </div>
          </div>
        </div>
        <div className="coll-row-meta" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {card.colors?.map(c => <ColorPip key={c} c={c} />)}
          <span style={{ fontSize: 12, color: "#888" }}>CMC {card.cmc || 0}</span>
        </div>
        <div style={{ color: "#c8a84b", fontWeight: "bold", minWidth: 60, textAlign: "right" }}>{getPriceLabel(card)}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {readOnly ? (
            <span style={{ minWidth: 40, textAlign: "center", fontSize: 14, color: "var(--text)" }}>{card.qty || 1}×</span>
          ) : (
            <>
              <button onClick={e => { e.stopPropagation(); onQty(card.id, -1); }} style={qtyBtn}>−</button>
              <span style={{ minWidth: 24, textAlign: "center", fontSize: 14 }}>{card.qty || 1}</span>
              <button onClick={e => { e.stopPropagation(); onQty(card.id, 1); }} style={qtyBtn}>+</button>
            </>
          )}
        </div>
        {/* Deck selector button */}
        {decks && decks.length > 0 && (
          <div style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setDeckSelectorOpen(o => !o)}
              title={`In ${decksWithCard} deck${decksWithCard !== 1 ? 's' : ''}`}
              style={{
                ...qtyBtn, width: "auto", padding: "0 8px", fontSize: 13,
                color: decksWithCard > 0 ? "#c084fc" : "#666",
                borderColor: decksWithCard > 0 ? "rgba(168,85,247,0.4)" : "rgba(255,255,255,0.1)"
              }}>
              🃏{decksWithCard > 0 ? ` ${decksWithCard}` : ""}
            </button>
            {deckSelectorOpen && (
              <DeckSelector
                card={card}
                decks={decks}
                onToggle={(deckId) => onToggleDeck(card, deckId)}
                onClose={() => setDeckSelectorOpen(false)}
                alignRight
              />
            )}
          </div>
        )}
        <div className="coll-row-subtotal" style={{ color: "#888", fontSize: 13, minWidth: 60, textAlign: "right" }}>${(getPrice(card) * (card.qty || 1)).toFixed(2)}</div>
        {!readOnly && <button onClick={e => { e.stopPropagation(); onRemove(card.id); }} style={{ background: "none", border: "none", color: "#e57373", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>✕</button>}
      </div>
      {expanded && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          {readOnly && card._editionCards?.length > 0 ? (
            // Two-column layout: editions list left, oracle text right
            <div style={{ display: "flex", gap: 0 }}>
              {/* Editions panel */}
              <div style={{ minWidth: 220, maxWidth: 260, padding: "10px 14px", borderRight: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ fontSize: 10, letterSpacing: 1, color: "#666", marginBottom: 8 }}>OWNED EDITIONS</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {card._editionCards.map(ed => (
                    <div key={ed.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", background: "rgba(255,255,255,0.03)", borderRadius: 5 }}>
                      {getImage(ed) && <img src={getImage(ed)} style={{ width: 28, borderRadius: 3, flexShrink: 0 }} alt="" />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ed.set_name}</div>
                        <div style={{ fontSize: 10, color: "#666" }}>#{ed.collector_number}</div>
                      </div>
                      <span style={{ fontSize: 12, color: "#c8a84b", flexShrink: 0 }}>{ed.qty || 1}×</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Oracle text */}
              <div style={{ flex: 1, padding: "10px 14px" }}>
                <div style={{ fontSize: 13, color: "#d0c8b8", whiteSpace: "pre-wrap", fontStyle: "italic", lineHeight: 1.6 }}>{getOracleText(card)}</div>
                {card.flavor_text && <div style={{ fontSize: 12, color: "#555", fontStyle: "italic", marginTop: 6 }}>"{card.flavor_text}"</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <a href={tcgLink(card)} target="_blank" rel="noreferrer" style={linkStyle("#2a6a99")}>TCGPlayer</a>
                  <a href={ckLink(card)} target="_blank" rel="noreferrer" style={linkStyle("#8b6914")}>Card Kingdom</a>
                </div>
              </div>
            </div>
          ) : (
            // Normal single-column expanded view
            <div style={{ padding: "0 14px 14px 66px" }}>
              <div style={{ paddingTop: 10, fontSize: 13, color: "#d0c8b8", whiteSpace: "pre-wrap", fontStyle: "italic", lineHeight: 1.6 }}>{getOracleText(card)}</div>
              {card.flavor_text && <div style={{ fontSize: 12, color: "#555", fontStyle: "italic", marginTop: 6 }}>"{card.flavor_text}"</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <a href={tcgLink(card)} target="_blank" rel="noreferrer" style={linkStyle("#2a6a99")}>TCGPlayer</a>
                <a href={ckLink(card)} target="_blank" rel="noreferrer" style={linkStyle("#8b6914")}>Card Kingdom</a>
              </div>
            </div>
          )}
        </div>
      )}
      <CardTooltip card={tooltip?.card} x={tooltip?.x} y={tooltip?.y} />
    </div>
  );
}

// ─── Decks Tab ────────────────────────────────────────────────────────────────
function DecksTab({ decks, setDecks, collection }) {
  const [activeDeck, setActiveDeck] = useState(null);
  const [newDeckName, setNewDeckName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, name }

  const createDeck = () => {
    if (!newDeckName.trim()) return;
    const deck = { id: Date.now().toString(), name: newDeckName.trim(), cards: [], format: "Standard", commander: "" };
    setDecks(d => [...d, deck]);
    setNewDeckName("");
    setActiveDeck(deck.id);
  };

  const deleteDeck = (id) => { setDecks(d => d.filter(dk => dk.id !== id)); if (activeDeck === id) setActiveDeck(null); };

  const updateDeck = (deckId, updater) => setDecks(d => d.map(dk => dk.id === deckId ? updater(dk) : dk));

  const currentDeck = decks.find(d => d.id === activeDeck);

  return (
    <div className="decks-grid">
      <div>
        <div style={{ marginBottom: 12 }}>
          <input value={newDeckName} onChange={e => setNewDeckName(e.target.value)} onKeyDown={e => e.key === "Enter" && createDeck()} placeholder="New deck name..." style={{ ...filterInputStyle, width: "100%", marginBottom: 6, boxSizing: "border-box" }} />
          <button onClick={createDeck} style={{ ...btnStyle("#c8a84b", "#1a1200"), width: "100%", boxSizing: "border-box" }}>+ Create Deck</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {decks.map(dk => {
            const deckTotal = dk.cards.reduce((s, c) => { const col = collection.find(col => col.id === c.collectionId); return s + (col ? getPrice(col) * c.qty : 0); }, 0);
            return (
              <div key={dk.id} onClick={() => setActiveDeck(dk.id)} style={{ padding: "10px 12px", borderRadius: 8, cursor: "pointer", background: activeDeck === dk.id ? "rgba(200,168,75,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${activeDeck === dk.id ? "rgba(200,168,75,0.3)" : "rgba(255,255,255,0.06)"}`, position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <div style={{ fontWeight: "bold", fontSize: 14 }}>{dk.name}</div>
                  <span style={{
                    fontSize: 9, fontWeight: "bold", letterSpacing: 1, padding: "1px 5px", borderRadius: 3,
                    background: dk.format === "Commander" ? "rgba(138,43,226,0.25)" : "rgba(200,168,75,0.15)",
                    color: dk.format === "Commander" ? "#c084fc" : "#c8a84b",
                    border: dk.format === "Commander" ? "1px solid rgba(138,43,226,0.4)" : "1px solid rgba(200,168,75,0.3)"
                  }}>{dk.format || "Standard"}</span>
                </div>
                {dk.format === "Commander" && dk.commander && (() => {
                  const cmdCard = collection.find(c => c.id === dk.commander);
                  return cmdCard ? <div style={{ fontSize: 11, color: "#a855f7", marginBottom: 2 }}>⚔ {cmdCard.name}</div> : null;
                })()}
                <div style={{ fontSize: 12, color: "#888" }}>{dk.cards.reduce((s, c) => s + c.qty, 0)} cards · ${deckTotal.toFixed(2)}</div>
                <button onClick={e => { e.stopPropagation(); setConfirmDelete({ id: dk.id, name: dk.name }); }} style={{ position: "absolute", top: 6, right: 8, background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 14 }}>✕</button>
              </div>
            );
          })}
          {decks.length === 0 && <div style={{ color: "#555", fontSize: 13, padding: 12 }}>No decks yet</div>}
        </div>
      </div>

      {currentDeck ? (
        <DeckEditor
          deck={currentDeck}
          collection={collection}
          onUpdate={updater => updateDeck(currentDeck.id, updater)}
          onAdd={cardId => updateDeck(currentDeck.id, dk => {
            const existing = dk.cards.find(c => c.collectionId === cardId);
            return existing
              ? { ...dk, cards: dk.cards.map(c => c.collectionId === cardId ? { ...c, qty: c.qty + 1 } : c) }
              : { ...dk, cards: [...dk.cards, { collectionId: cardId, qty: 1 }] };
          })}
          onRemove={cardId => updateDeck(currentDeck.id, dk => ({ ...dk, cards: dk.cards.filter(c => c.collectionId !== cardId) }))}
          onQty={(cardId, delta) => updateDeck(currentDeck.id, dk => ({
            ...dk, cards: dk.cards.map(c => c.collectionId !== cardId ? c : { ...c, qty: Math.max(0, c.qty + delta) }).filter(c => c.qty > 0)
          }))}
        />
      ) : (
        <div style={{ textAlign: "center", padding: 60, color: "#555" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🃏</div>
          <div>Select or create a deck</div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 500,
          background: "rgba(0,0,0,0.7)",
          display: "flex", alignItems: "center", justifyContent: "center"
        }} onClick={() => setConfirmDelete(null)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "var(--bg)", border: "1px solid rgba(200,168,75,0.3)",
              borderRadius: 14, padding: "32px 36px", maxWidth: 360, width: "90%",
              textAlign: "center", boxShadow: "0 16px 48px rgba(0,0,0,0.8)"
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 12 }}>&#x1F5D1;</div>
            <div style={{ fontSize: 17, fontWeight: "bold", color: "var(--text)", marginBottom: 8 }}>
              Delete &ldquo;{confirmDelete.name}&rdquo;?
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 28, lineHeight: 1.5 }}>
              This will permanently remove the deck and all its card assignments.
              Your actual card collection will not be affected.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                onClick={() => setConfirmDelete(null)}
                style={{
                  padding: "9px 22px", borderRadius: 8, border: "1px solid var(--border)",
                  background: "var(--surface-mid)", color: "var(--text-muted)",
                  cursor: "pointer", fontFamily: "inherit", fontSize: 14
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => { deleteDeck(confirmDelete.id); setConfirmDelete(null); }}
                style={{
                  padding: "9px 22px", borderRadius: 8, border: "1px solid rgba(229,115,115,0.4)",
                  background: "rgba(229,115,115,0.15)", color: "#ef9a9a",
                  cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: "bold"
                }}
              >
                Delete Deck
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared card-hover tooltip hook ─────────────────────────────────────────
function useCardTooltip() {
  const [tooltip, setTooltip] = useState(null);
  const timer = useRef(null);
  const handleMouseEnter = (card, e) => {
    clearTimeout(timer.current);
    const { clientX: x, clientY: y } = e;
    timer.current = setTimeout(() => setTooltip({ card, x, y }), 500);
  };
  const handleMouseMove = (card, e) => {
    setTooltip(t => (t && t.card.id === card.id) ? { ...t, x: e.clientX, y: e.clientY } : t);
  };
  const handleMouseLeave = () => { clearTimeout(timer.current); setTooltip(null); };
  return { tooltip, handleMouseEnter, handleMouseMove, handleMouseLeave };
}

// ─── Card Hover Tooltip ──────────────────────────────────────────────────────
function CardTooltip({ card, x, y }) {
  if (!card) return null;
  const img = getImage(card);
  if (!img) return null;
  // Flip to left side if near right edge
  const flipLeft = x > window.innerWidth - 290;
  return (
    <div style={{
      position: "fixed",
      top: Math.min(y - 20, window.innerHeight - 420),
      left: flipLeft ? x - 270 : x + 16,
      zIndex: 2000,
      width: 260,
      borderRadius: 12,
      boxShadow: "0 12px 40px rgba(0,0,0,0.85)",
      pointerEvents: "none",
      animation: "tooltipFadeIn 0.12s ease",
    }}>
      <img src={img} alt={card.name} style={{ width: "100%", borderRadius: 12, display: "block" }} />
    </div>
  );
}

function DeckEditor({ deck, collection, onUpdate, onAdd, onRemove, onQty }) {
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState("deck"); // "deck" | "combos"
  const { tooltip, handleMouseEnter, handleMouseMove, handleMouseLeave } = useCardTooltip();
  const deckCards = deck.cards.map(c => ({ ...collection.find(col => col.id === c.collectionId), deckQty: c.qty })).filter(c => c.id);
  const totalCards = deck.cards.reduce((s, c) => s + c.qty, 0);
  // Commander card — needed early for color identity computation
  const commanderCard = deck.commander ? collection.find(c => c.id === deck.commander) : null;
  // Color identity:
  //   Commander format → use ONLY the commander's color_identity
  //   Standard format  → union of all deck card color_identity arrays
  const deckColorIdentity = (() => {
    const s = new Set();
    if (deck.format === "Commander" && commanderCard) {
      (commanderCard.color_identity || []).forEach(ci => s.add(ci));
    } else {
      deckCards.forEach(c => (c.color_identity || []).forEach(ci => s.add(ci)));
    }
    return s;
  })();
  const totalValue = deckCards.reduce((s, c) => s + getPrice(c) * (c.deckQty || 0), 0);
  const typeCounts = {};
  deckCards.forEach(c => {
    const t = getTypePermutation(c.type_line);
    typeCounts[t] = (typeCounts[t] || 0) + (c.deckQty || 0);
  });

  // Group cards by their main-type permutation (e.g. "Artifact Creature")
  const groupedCards = {};
  deckCards.forEach(c => {
    const t = getTypePermutation(c.type_line);
    if (!groupedCards[t]) groupedCards[t] = [];
    groupedCards[t].push(c);
  });

  // Sort groups by the predefined display order
  const sortedTypes = Object.keys(groupedCards).sort((a, b) => {
    const ia = TYPE_GROUP_ORDER.indexOf(a);
    const ib = TYPE_GROUP_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  const available = collection.filter(c => { const q = search.toLowerCase(); return !q || c.name.toLowerCase().includes(q) || (c.type_line || "").toLowerCase().includes(q); });

  // Commander: cards in deck that are Legendary Creatures
  const legendaryCreatures = deckCards.filter(c => (c.type_line || "").includes("Legendary") && (c.type_line || "").includes("Creature"));

  return (
    <div>
      {/* Deck header: name + stats + format picker */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, color: "#c8a84b", fontStyle: "italic" }}>{deck.name}</h2>
        <div style={{ fontSize: 13, color: "#888" }}>{totalCards} cards · ${totalValue.toFixed(2)}</div>
        <div style={{ fontSize: 12, color: "#666" }}>{Object.entries(typeCounts).map(([t, n]) => `${t}(${n})`).join(" · ")}</div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {/* View mode tabs */}
          {[{ id: "deck", label: "📋 Deck" }, { id: "combos", label: "⚡ Combos" }, ...(deck.format === "Commander" ? [{ id: "synergies", label: "🧬 Commander Synergies" }] : [])].map(v => (
            <button key={v.id} onClick={() => setViewMode(v.id)} style={{
              padding: "5px 12px", borderRadius: 6, border: "1px solid", cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: "bold",
              background: viewMode === v.id ? "rgba(200,168,75,0.15)" : "rgba(255,255,255,0.04)",
              color: viewMode === v.id ? "#c8a84b" : "#666",
              borderColor: viewMode === v.id ? "rgba(200,168,75,0.4)" : "rgba(255,255,255,0.1)",
            }}>{v.label}</button>
          ))}
          <span style={{ width: 1, background: "rgba(255,255,255,0.1)", alignSelf: "stretch", margin: "0 4px" }} />
          <span style={{ fontSize: 11, color: "#888", letterSpacing: 1 }}>FORMAT</span>
          {["Standard", "Commander"].map(fmt => (
            <button key={fmt} onClick={() => onUpdate(dk => ({ ...dk, format: fmt, commander: fmt === "Standard" ? "" : dk.commander }))}
              style={{
                padding: "5px 12px", borderRadius: 6, border: "1px solid", cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: "bold", letterSpacing: 0.5,
                background: deck.format === fmt ? (fmt === "Commander" ? "rgba(138,43,226,0.25)" : "rgba(200,168,75,0.2)") : "rgba(255,255,255,0.04)",
                color: deck.format === fmt ? (fmt === "Commander" ? "#c084fc" : "#c8a84b") : "#666",
                borderColor: deck.format === fmt ? (fmt === "Commander" ? "rgba(138,43,226,0.5)" : "rgba(200,168,75,0.45)") : "rgba(255,255,255,0.1)",
              }}>{fmt}</button>
          ))}
        </div>
      </div>

      {/* Commander selector — only shown for Commander format */}
      {deck.format === "Commander" && (
        <div style={{ marginBottom: 16, padding: "12px 16px", background: "rgba(138,43,226,0.08)", border: "1px solid rgba(138,43,226,0.25)", borderRadius: 10 }}>
          <div style={{ fontSize: 11, letterSpacing: 1, color: "#a855f7", marginBottom: 8 }}>COMMANDER</div>
          {commanderCard ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {getImage(commanderCard) && <img src={getImage(commanderCard)} style={{ width: 36, borderRadius: 4 }} alt="" />}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: "bold", fontSize: 14, color: "var(--text)" }}>{commanderCard.name}</div>
                <div style={{ fontSize: 11, color: "#a855f7" }}>{commanderCard.type_line}</div>
              </div>
              <button onClick={() => onUpdate(dk => ({ ...dk, commander: "" }))} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 14 }}>✕</button>
            </div>
          ) : (
            legendaryCreatures.length > 0 ? (
              <div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>Select a Legendary Creature from your deck:</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {legendaryCreatures.map(card => (
                    <button key={card.id} onClick={() => onUpdate(dk => ({ ...dk, commander: card.id }))}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "rgba(138,43,226,0.1)", border: "1px solid rgba(138,43,226,0.2)", borderRadius: 6, cursor: "pointer", color: "var(--text)", fontFamily: "inherit", textAlign: "left" }}>
                      {getImage(card) && <img src={getImage(card)} style={{ width: 28, borderRadius: 3 }} alt="" />}
                      <div style={{ flex: 1, fontSize: 13 }}>{card.name}</div>
                      <div style={{ fontSize: 11, color: "#888" }}>{card.type_line?.split("—")[0].trim()}</div>
                      <span style={{ fontSize: 12, color: "#a855f7" }}>→ Set as Commander</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#666", fontStyle: "italic" }}>Add a Legendary Creature to your deck to set as Commander.</div>
            )
          )}
        </div>
      )}
      {viewMode === "deck" ? (
        <div className="deck-editor-grid">
          <div>
            <div style={{ fontSize: 11, letterSpacing: 1, color: "#888", marginBottom: 6 }}>DECK CONTENTS</div>
            {deckCards.length === 0
              ? <div style={{ color: "#555", fontSize: 13, padding: 16 }}>Add cards from your collection →</div>
              : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {sortedTypes.map(type => (
                  <div key={type}>
                    <div style={{ fontSize: 10, fontWeight: "bold", letterSpacing: 1, color: "#666", marginBottom: 4, paddingLeft: 4 }}>
                      {type.toUpperCase()} ({groupedCards[type].reduce((s, c) => s + c.deckQty, 0)})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {groupedCards[type].map(card => {
                        const isCommander = deck.format === "Commander" && card.id === deck.commander;
                        return (
                          <div key={card.id}
                            onMouseEnter={e => handleMouseEnter(card, e)}
                            onMouseMove={e => handleMouseMove(card, e)}
                            onMouseLeave={handleMouseLeave}
                            style={{
                              display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                              background: isCommander ? "rgba(138,43,226,0.12)" : "rgba(255,255,255,0.03)",
                              borderRadius: 6,
                              borderLeft: isCommander ? "2px solid #a855f7" : `2px solid ${card.colors?.[0] ? COLOR_MAP[card.colors[0]] : "#555"}`,
                              cursor: "default",
                              position: "relative"
                            }}>
                            {isCommander && <span style={{ fontSize: 12, color: "#a855f7", marginRight: 2 }} title="Commander">★</span>}
                            <div style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>{card.name}</div>
                            <div style={{ fontSize: 11, color: "#666" }}>{getPriceLabel(card)}</div>
                            <button onClick={() => onQty(card.id, -1)} style={qtyBtn}>−</button>
                            <span style={{ minWidth: 20, textAlign: "center", fontSize: 13 }}>{card.deckQty}</span>
                            <button onClick={() => onQty(card.id, 1)} style={qtyBtn}>+</button>
                            <button onClick={() => onRemove(card.id)} style={{ background: "none", border: "none", color: "#e57373", cursor: "pointer" }}>✕</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            }
          </div>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 1, color: "#888", marginBottom: 6 }}>ADD FROM COLLECTION</div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter collection..." style={{ ...filterInputStyle, width: "100%", marginBottom: 8, boxSizing: "border-box" }} />
            <div style={{ maxHeight: 400, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
              {available.map(card => {
                const inDeck = deck.cards.find(c => c.collectionId === card.id);
                return (
                  <button key={card.id} onClick={() => onAdd(card.id)}
                    onMouseEnter={e => handleMouseEnter(card, e)}
                    onMouseMove={e => handleMouseMove(card, e)}
                    onMouseLeave={handleMouseLeave}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: inDeck ? "rgba(200,168,75,0.08)" : "var(--card-row-bg)", border: `1px solid ${inDeck ? "rgba(200,168,75,0.3)" : "var(--border)"}`, borderRadius: 6, cursor: "pointer", color: "var(--text)", fontFamily: "inherit", textAlign: "left" }}>
                    <div style={{ flex: 1, fontSize: 13 }}>{card.name}</div>
                    <div style={{ fontSize: 11, color: "#666" }}>{card.type_line?.split("—")[0].trim()}</div>
                    {inDeck && <span style={{ fontSize: 11, color: "#c8a84b" }}>×{inDeck.qty}</span>}
                    <span style={{ fontSize: 13, color: "#c8a84b" }}>+</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : viewMode === "synergies" ? (
        <CommanderSynergies commanderCard={commanderCard} deckCards={deckCards} collection={collection} deckColorIdentity={deckColorIdentity} />
      ) : (
        <DeckCombos deckCards={deckCards} collection={collection} deckColorIdentity={deckColorIdentity} commanderName={commanderCard?.name || ""} isCommander={deck.format === "Commander"} />
      )}
      <CardTooltip card={tooltip?.card} x={tooltip?.x} y={tooltip?.y} />
    </div>
  );
}

// ─── Deck Combo Finder ──────────────────────────────────────────────────────
const CSB_BASE = "/api/spellbook";

// Concurrency-limited runner: runs async tasks N at a time
async function pool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let index = 0;
  async function runner() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, runner));
  return results;
}

// Fetch all combos for a single card name with optional color identity pre-filter
// Correct Spellbook syntax: coloridentity<=bg (lowercase, no colon/space before <=)
async function fetchCombosForCard(cardName, ciFilter = "") {
  const qStr = ciFilter ? `card="${cardName}" coloridentity<=${ciFilter}` : `card="${cardName}"`;
  const q = encodeURIComponent(qStr);
  const results = [];
  let url = `${CSB_BASE}?q=${q}`;
  while (url) {
    const r = await fetch(url);
    if (!r.ok) {
      const text = await r.text().catch(() => "Unknown error");
      throw new Error(`API error (${r.status}): ${text.substring(0, 100)}`);
    }
    const d = await r.json();
    results.push(...(d.results || []));
    // Follow pagination via d.next — strip domain, rewrite to our proxy path
    if (d.next) {
      try { const nextUrl = new URL(d.next); url = `${CSB_BASE}${nextUrl.search}`; }
      catch { url = null; }
    } else { url = null; }
  }
  return results;
}

function DeckCombos({ deckCards, collection, deckColorIdentity: propDeckCI, commanderName = "", isCommander = false }) {
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [errorMsg, setErrorMsg] = useState("");
  const [combos, setCombos] = useState([]);
  const [expanded, setExpanded] = useState({}); // variantId -> bool
  const { tooltip, handleMouseEnter, handleMouseMove, handleMouseLeave } = useCardTooltip();

  const [colorOnly, setColorOnly] = useState(true);
  const [effectiveDeckCI, setEffectiveDeckCI] = useState(propDeckCI);
  const deckNames = new Set(deckCards.map(c => c.name?.toLowerCase()));
  const collectionNames = new Set((collection || []).map(c => c.name?.toLowerCase()));

  const findCombos = async () => {
    if (deckCards.length === 0) return;
    setStatus("loading");
    setErrorMsg("");
    setCombos([]);
    try {
      // Fetch Spellbook combos AND Scryfall deck color identities in parallel (no extra latency)
      const names = [...new Set(deckCards.map(c => c.name).filter(Boolean))].slice(0, 60);
      // Resolve deck color identity from Scryfall — reliable regardless of Sheets data format
      // Commander format: look up ONLY the commander's CI (avoids off-color cards in the deck)
      // Standard format: union of all deck card CIs from Scryfall
      const ciLookupNames = isCommander && commanderName ? [commanderName] : names;
      const deckCiMap = await fetchColorIdentities(ciLookupNames);
      const resolvedCI = (() => {
        // Start from prop if already has data (fast path); merge Scryfall to fill any gaps
        const s = new Set(propDeckCI.size > 0 && !(isCommander) ? propDeckCI : []);
        Object.values(deckCiMap).forEach(ci => ci.forEach(c => s.add(c)));
        return s;
      })();

      // coloridentity<=bg tells Spellbook to only return combos legal for the deck's colors
      const ciFilter = colorOnly && resolvedCI.size > 0
        ? [...resolvedCI].map(c => c.toLowerCase()).sort().join("")
        : "";

      const batchResults = await pool(names.map(name => () => fetchCombosForCard(name, ciFilter)), 3);
      // Deduplicate by variant id
      const seen = new Set();
      const all = [];
      batchResults.flat().forEach(v => { if (!seen.has(v.id)) { seen.add(v.id); all.push(v); } });
      // Score: how many cards in this combo are owned in the deck
      const scored = all.map(v => {
        const comboNames = v.uses.map(u => u.card.name.toLowerCase());
        const owned = comboNames.filter(n => deckNames.has(n)).length;
        return { ...v, _owned: owned, _total: comboNames.length };
      });
      // Sort: fully-owned combos first, then by coverage desc, then popularity desc
      scored.sort((a, b) =>
        b._owned - a._owned || (b._owned / b._total) - (a._owned / a._total) || b.popularity - a.popularity
      );
      // No per-combo Scryfall lookup needed — Spellbook returns variant.identity (e.g. "BG")
      setEffectiveDeckCI(resolvedCI);
      setCombos(scored);
      setStatus("done");
    } catch (e) {
      console.error("Combo fetch error:", e);
      setErrorMsg(e.message);
      setStatus("error");
    }
  };

  if (status === "idle") return (
    <div style={{ textAlign: "center", padding: "40px 20px" }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
      <div style={{ color: "#888", fontSize: 14, marginBottom: 20 }}>Scan your deck for known combos via Commander Spellbook</div>
      <button onClick={findCombos} style={btnStyle("#c8a84b", "#1a1200")}>Find Combos</button>
    </div>
  );

  if (status === "loading") return (
    <div style={{ textAlign: "center", padding: 40, color: "#c8a84b" }}>⟳ Scanning {deckCards.length} cards...</div>
  );

  if (status === "error") return (
    <div style={{ textAlign: "center", padding: 40, color: "#e57373" }}>
      <div>Failed to fetch combos.</div>
      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>{errorMsg}</div>
      <button onClick={() => setStatus("idle")} style={{ marginTop: 12, background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#888", cursor: "pointer", padding: "4px 12px", fontSize: 13 }}>Try again</button>
    </div>
  );

  // Color identity filter: variant.identity is a string like "BG" from the Spellbook API
  // (variant.colorIdentity is always [] — the actual field is "identity")
  const isColorLegal = (variant) => {
    if (!colorOnly || effectiveDeckCI.size === 0) return true;
    return [...(variant.identity || "")].every(c => effectiveDeckCI.has(c.toUpperCase()));
  };
  const filteredCombos = combos.filter(isColorLegal);
  const fullCombos = filteredCombos.filter(c => c._owned === c._total);
  const partialCombos = filteredCombos.filter(c => c._owned > 0 && c._owned < c._total);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "#888" }}>
          {combos.length} combos found ·
          <span style={{ color: "#4ade80", marginLeft: 6 }}>{fullCombos.length} complete</span>
          <span style={{ color: "#c8a84b", marginLeft: 6 }}>{partialCombos.length} partial</span>
        </div>
        {effectiveDeckCI && effectiveDeckCI.size > 0 && (
          <button onClick={() => setColorOnly(v => !v)} style={{
            background: colorOnly ? "rgba(200,168,75,0.15)" : "none",
            border: `1px solid ${colorOnly ? "rgba(200,168,75,0.5)" : "rgba(255,255,255,0.1)"}`,
            borderRadius: 6, color: colorOnly ? "#c8a84b" : "#888",
            cursor: "pointer", fontSize: 12, padding: "4px 10px", fontFamily: "inherit",
            display: "flex", alignItems: "center", gap: 5
          }}>
            {colorOnly ? "🎨 Color Legal" : "🎨 All Colors"}
          </button>
        )}
        <button onClick={() => setStatus("idle")} style={{ marginLeft: "auto", background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#888", cursor: "pointer", fontSize: 12, padding: "4px 10px", fontFamily: "inherit" }}>↺ Rescan</button>
      </div>

      {combos.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#555" }}>No combos found for this deck.</div>
      )}

      {[{ label: "✅ Complete Combos", list: fullCombos, accent: "#4ade80" },
      { label: "⚡ Partial Combos (missing cards)", list: partialCombos, accent: "#c8a84b" }]
        .map(({ label, list, accent }) => list.length === 0 ? null : (
          <div key={label} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, letterSpacing: 1, color: accent, marginBottom: 8 }}>{label.toUpperCase()}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {list.map(variant => {
                const isOpen = expanded[variant.id];
                return (
                  <div key={variant.id} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${variant._owned === variant._total ? "rgba(74,222,128,0.2)" : "rgba(200,168,75,0.15)"}`, borderRadius: 8, overflow: "hidden" }}>
                    {/* Header row */}
                    <div onClick={() => setExpanded(e => ({ ...e, [variant.id]: !e[variant.id] }))}
                      style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", cursor: "pointer" }}>
                      {/* Card thumbnails */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, flex: 1 }}>
                        {variant.uses.map(u => {
                          const lc = u.card.name.toLowerCase();
                          const owned = collectionNames.has(lc);
                          const inDeck = deckNames.has(lc);
                          // Normalize the Spellbook card object so CardTooltip can use it
                          const tooltipCard = { id: String(u.card.id), name: u.card.name, image_uris: { normal: u.card.imageUriFrontNormal } };
                          // Border: purple > green > default (in-deck takes visual priority)
                          const borderColor = inDeck ? "rgba(168,85,247,0.5)" : owned ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.1)";
                          const bgColor = inDeck ? "rgba(168,85,247,0.15)" : owned ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.05)";
                          const textColor = inDeck ? "#c084fc" : owned ? "#86efac" : "#888";
                          return (
                            <span key={u.card.id}
                              onMouseEnter={e => handleMouseEnter(tooltipCard, e)}
                              onMouseMove={e => handleMouseMove(tooltipCard, e)}
                              onMouseLeave={handleMouseLeave}
                              style={{
                                fontSize: 12, padding: "2px 7px", borderRadius: 4, cursor: "default",
                                background: bgColor, border: `1px solid ${borderColor}`, color: textColor
                              }}>
                              {inDeck ? "⧓ " : owned ? "✓ " : ""}{u.card.name}
                            </span>
                          );
                        })}
                      </div>
                      {/* Results */}
                      <div style={{ minWidth: 120, textAlign: "right" }}>
                        {variant.produces.slice(0, 2).map(p => (
                          <div key={p.feature.id} style={{ fontSize: 11, color: "#a855f7" }}>{p.feature.name}</div>
                        ))}
                        {variant.produces.length > 2 && <div style={{ fontSize: 10, color: "#666" }}>+{variant.produces.length - 2} more</div>}
                      </div>
                      <span style={{ color: "#555", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                    </div>
                    {/* Expanded detail */}
                    {isOpen && (
                      <div style={{ padding: "0 14px 14px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                        {variant.notablePrerequisites && (
                          <div style={{ marginTop: 10, marginBottom: 8 }}>
                            <div style={{ fontSize: 10, color: "#888", letterSpacing: 1, marginBottom: 4 }}>PREREQUISITES</div>
                            <div style={{ fontSize: 12, color: "#ffb74d", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{variant.notablePrerequisites}</div>
                          </div>
                        )}
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 10, color: "#888", letterSpacing: 1, marginBottom: 4 }}>STEPS</div>
                          <div style={{ fontSize: 12, color: "#d0c8b8", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{variant.description}</div>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                          {variant.produces.map(p => (
                            <span key={p.feature.id} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)", color: "#c084fc" }}>{p.feature.name}</span>
                          ))}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 11, color: "#555" }}>Popularity: {variant.popularity} · {variant._owned}/{variant._total} cards owned</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      }
      <CardTooltip card={tooltip?.card} x={tooltip?.x} y={tooltip?.y} />
    </div>
  );
}

// ─── Commander Synergies (EDHREC) ─────────────────────────────────────────────────────
// Convert a card name to an EDHREC slug: "Atraxa, Praetors' Voice" -> "atraxa-praetors-voice"
function toEdhrecSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // strip apostrophes, commas, etc.
    .trim()
    .replace(/\s+/g, "-");
}

// Category display config
const EDHREC_CATEGORIES = [
  { tag: "highsynergycards", label: "High Synergy", accent: "#a855f7" },
  { tag: "newcards", label: "New Cards", accent: "#38bdf8" },
  { tag: "topcards", label: "Top Cards", accent: "#c8a84b" },
  { tag: "creatures", label: "Creatures", accent: "#4ade80" },
  { tag: "instants", label: "Instants", accent: "#60a5fa" },
  { tag: "sorceries", label: "Sorceries", accent: "#f472b6" },
  { tag: "enchantments", label: "Enchantments", accent: "#facc15" },
  { tag: "utilityartifacts", label: "Artifacts", accent: "#94a3b8" },
  { tag: "planeswalkers", label: "Planeswalkers", accent: "#fb923c" },
  { tag: "manaartifacts", label: "Mana Artifacts", accent: "#78716c" },
  { tag: "utilitylands", label: "Utility Lands", accent: "#a16207" },
];

function CommanderSynergies({ commanderCard, deckCards, collection, deckColorIdentity }) {
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [data, setData] = useState(null);
  const [openCats, setOpenCats] = useState({ highsynergycards: true, newcards: true, topcards: true });
  const [filter, setFilter] = useState("");
  const [colorOnly, setColorOnly] = useState(true);
  const [colorIdentityMap, setColorIdentityMap] = useState({}); // cardName.lower -> color_identity[]
  const { tooltip, handleMouseEnter, handleMouseMove, handleMouseLeave } = useCardTooltip();

  const deckNames = new Set(deckCards.map(c => c.name?.toLowerCase()));
  const collectionNames = new Set((collection || []).map(c => c.name?.toLowerCase()));

  const load = async () => {
    if (!commanderCard) return;
    setStatus("loading");
    try {
      const slug = toEdhrecSlug(commanderCard.name);
      const res = await fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`);
      if (!res.ok) throw new Error(res.status);
      const json = await res.json();
      // Batch-fetch color identities for all EDHREC cards from Scryfall BEFORE rendering
      const allCardlists = json?.container?.json_dict?.cardlists || [];
      const allNames = [...new Set(allCardlists.flatMap(cl => (cl.cardviews || []).map(cv => cv.name)))];
      const ciMap = await fetchColorIdentities(allNames);
      // React 18 batches these together — commits in a single render with filter already applied
      setColorIdentityMap(ciMap);
      setData(json);
      setStatus("done");
    } catch (e) {
      setStatus("error");
    }
  };

  if (!commanderCard) return (
    <div style={{ textAlign: "center", padding: 40, color: "#555" }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>🧬</div>
      <div>Set a Commander on this deck to view EDHREC synergy recommendations.</div>
    </div>
  );

  if (status === "idle") return (
    <div style={{ textAlign: "center", padding: "40px 20px" }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>🧬</div>
      <div style={{ color: "#888", fontSize: 14, marginBottom: 6 }}>Load EDHREC recommendations for</div>
      <div style={{ fontWeight: "bold", fontSize: 16, color: "var(--text)", marginBottom: 20 }}>{commanderCard.name}</div>
      <button onClick={load} style={btnStyle("#a855f7", "#fff")}>Load Synergies</button>
    </div>
  );

  if (status === "loading") return (
    <div style={{ textAlign: "center", padding: 40, color: "#a855f7" }}>⟳ Loading EDHREC data...</div>
  );

  if (status === "error") return (
    <div style={{ textAlign: "center", padding: 40, color: "#e57373" }}>
      Failed to load EDHREC data. Commander name may not match EDHREC's format.
      <button onClick={() => setStatus("idle")} style={{ display: "block", margin: "12px auto 0", background: "none", border: "none", color: "#888", cursor: "pointer" }}>Try again</button>
    </div>
  );

  const cardlists = data?.container?.json_dict?.cardlists || [];
  const edhrecNum = data?.num_decks_avg || 0;

  // Build a map: tag -> cardviews
  const byTag = {};
  cardlists.forEach(cl => { byTag[cl.tag] = cl.cardviews || []; });

  const q = filter.toLowerCase();

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "#888" }}>EDHREC data for <span style={{ color: "#a855f7", fontWeight: "bold" }}>{commanderCard.name}</span> · ~{edhrecNum.toLocaleString()} decks</div>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter cards..." style={{ ...filterInputStyle, marginLeft: "auto", width: 180 }} />
        {deckColorIdentity && deckColorIdentity.size > 0 && (
          <button onClick={() => setColorOnly(v => !v)} style={{
            background: colorOnly ? "rgba(200,168,75,0.15)" : "none",
            border: `1px solid ${colorOnly ? "rgba(200,168,75,0.5)" : "rgba(255,255,255,0.1)"}`,
            borderRadius: 6, color: colorOnly ? "#c8a84b" : "#888",
            cursor: "pointer", fontSize: 12, padding: "4px 10px", fontFamily: "inherit",
            display: "flex", alignItems: "center", gap: 5
          }}>
            {colorOnly ? "🎨 Color Legal" : "🎨 All Colors"}
          </button>
        )}
        <button onClick={() => setStatus("idle")} style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#888", cursor: "pointer", fontSize: 12, padding: "4px 10px", fontFamily: "inherit" }}>↺ Reload</button>
      </div>
      {/* Column legend */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 16, marginBottom: 6, paddingRight: 10 }}>
        <span style={{ fontSize: 10, color: "#555" }} title="How much more (or less) often this card is played with this commander compared to other decks of the same colors">syn% = synergy with commander</span>
        <span style={{ fontSize: 10, color: "#555" }} title="Percentage of eligible EDHREC decks that include this card">% = overall inclusion rate</span>
      </div>

      {EDHREC_CATEGORIES.map(cat => {
        const cards = (byTag[cat.tag] || []).filter(c => {
          if (q && !c.name.toLowerCase().includes(q)) return false;
          if (colorOnly && deckColorIdentity && deckColorIdentity.size > 0) {
            const ci = colorIdentityMap[c.name.toLowerCase()];
            if (ci && !ci.every(x => deckColorIdentity.has(x))) return false;
          }
          return true;
        });
        if (cards.length === 0) return null;
        const isOpen = openCats[cat.tag];
        const ownedCount = cards.filter(c => collectionNames.has(c.name.toLowerCase())).length;
        const inDeckCount = cards.filter(c => deckNames.has(c.name.toLowerCase())).length;
        return (
          <div key={cat.tag} style={{ marginBottom: 10 }}>
            {/* Section header */}
            <div onClick={() => setOpenCats(o => ({ ...o, [cat.tag]: !o[cat.tag] }))}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 6, cursor: "pointer", marginBottom: isOpen ? 4 : 0 }}>
              <span style={{ fontSize: 11, fontWeight: "bold", letterSpacing: 1, color: cat.accent }}>{cat.label.toUpperCase()}</span>
              <span style={{ fontSize: 11, color: "#555" }}>{cards.length} cards</span>
              {ownedCount > 0 && <span style={{ fontSize: 11, color: "#4ade80" }}>✓ {ownedCount} owned</span>}
              {inDeckCount > 0 && <span style={{ fontSize: 11, color: "#c084fc" }}>⧓ {inDeckCount} in deck</span>}
              <span style={{ marginLeft: "auto", color: "#555", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
            </div>
            {isOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {cards.map(card => {
                  const lc = card.name.toLowerCase();
                  const owned = collectionNames.has(lc);
                  const inDeck = deckNames.has(lc);
                  const synPct = card.synergy != null ? (card.synergy * 100).toFixed(0) : null;
                  const inclPct = card.potential_decks > 0 ? ((card.num_decks / card.potential_decks) * 100).toFixed(0) : 0;
                  // Visual priority: in-deck (purple) > owned (green) > default
                  const rowBg = inDeck ? "rgba(168,85,247,0.08)" : owned ? "rgba(74,222,128,0.06)" : "rgba(255,255,255,0.02)";
                  const rowBorder = inDeck ? "#a855f7" : owned ? "#4ade80" : "rgba(255,255,255,0.06)";
                  const nameColor = inDeck ? "#c084fc" : owned ? "#86efac" : "#e8e0d0";
                  return (
                    <div key={card.id}
                      onMouseEnter={e => handleMouseEnter({ id: card.id, name: card.name, image_uris: { normal: `https://cards.scryfall.io/normal/front/${card.id[0]}/${card.id[1]}/${card.id}.jpg` } }, e)}
                      onMouseMove={e => handleMouseMove({ id: card.id, name: card.name, image_uris: { normal: `https://cards.scryfall.io/normal/front/${card.id[0]}/${card.id[1]}/${card.id}.jpg` } }, e)}
                      onMouseLeave={handleMouseLeave}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "5px 10px",
                        background: rowBg, borderRadius: 5,
                        borderLeft: `2px solid ${rowBorder}`, cursor: "default"
                      }}>
                      {inDeck && <span style={{ fontSize: 11, color: "#c084fc", flexShrink: 0 }} title="In deck">⧓</span>}
                      {!inDeck && owned && <span style={{ fontSize: 11, color: "#4ade80", flexShrink: 0 }} title="In collection">✓</span>}
                      <div style={{ flex: 1, fontSize: 13, color: nameColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.name}</div>
                      {synPct !== null && (
                        <span style={{
                          fontSize: 10, padding: "1px 6px", borderRadius: 3, flexShrink: 0,
                          background: card.synergy > 0.15 ? "rgba(168,85,247,0.2)" : card.synergy > 0 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                          color: card.synergy > 0.15 ? "#c084fc" : card.synergy > 0 ? "#888" : "#555",
                        }}>{synPct > 0 ? "+" : ""}{synPct}% syn</span>
                      )}
                      <span style={{ fontSize: 10, color: "#555", flexShrink: 0, minWidth: 36, textAlign: "right" }}>{inclPct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <CardTooltip card={tooltip?.card} x={tooltip?.x} y={tooltip?.y} />
    </div>
  );
}

// ─── Style helpers ────────────────────────────────────────────────────────────
function btnStyle(bg, textColor) {
  return { padding: "10px 18px", background: bg, color: textColor, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: "bold", fontSize: 13, letterSpacing: 0.5, whiteSpace: "nowrap" };
}
function linkStyle(bg) {
  return { display: "inline-block", padding: "6px 14px", background: bg, color: "#fff", borderRadius: 6, textDecoration: "none", fontSize: 12, fontWeight: "bold", letterSpacing: 0.5 };
}
const filterInputStyle = { padding: "8px 12px", background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: 6, color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" };
const qtyBtn = { background: "var(--surface-mid)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", cursor: "pointer", width: 22, height: 22, padding: 0, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" };
