# ⚔️ Arcane Ledger — MTG Collection Tracker

A personal Magic: The Gathering collection tracker that stores your cards and decks in your own Google Sheet. Built with React + Vite, powered by the [Scryfall API](https://scryfall.com/docs/api) for live card data, prices, and images.

**[Live Demo](https://mtg-tracker-sam.vercel.app/)**

---

## Features

### 🔍 Search & Add
- Search any card by name — select from all printings/editions
- 📷 **Camera scan** to identify cards via AI vision
- Live prices from Scryfall with **TCGPlayer** and **Card Kingdom** links
- Full official oracle text, card image (click to enlarge), mana cost, type, P/T
- **+ Add to Collection** — tracks quantity, deduplicates by Scryfall ID
- **🃏 Add to Deck** — multi-deck selector opens directly from the search result; if the card isn't in your collection yet, prompts to add it to both

### 📚 Collection
- Filter by color, type, mana value, and free-text search (name, oracle text, type)
- Sort by name, price, color, or mana value
- Quantity controls (−/+) and per-card subtotal
- **🃏 Deck badge** on every row — shows how many decks the card is in; click to open the deck multi-selector to add/remove from any deck without leaving the collection view
- Card image hover tooltip on the name/art area (not triggered by buttons)
- Total cards, unique cards, and total collection value summary

### 🃏 Decks
- Create and delete decks
- **Format selector** — Standard or Commander, shown as a colored badge in the sidebar
- **Commander selection** — for Commander decks, designate any Legendary Creature in the deck as commander; commander is highlighted in the deck list and card table
- Deck editor with card list — add from collection, adjust quantity, remove cards
- Per-deck total value and card count

#### ⚡ Combos tab *(in Deck Editor)*
- Queries the [Commander Spellbook API](https://commanderspellbook.com) for combos involving cards in the deck
- Deduplicates and ranks results: complete combos (all cards owned) first, then partial
- Each combo shows card pills colored by status: **purple** = already in deck, **green** = in collection, **grey** = need to buy
- Expand any combo to see prerequisites, full step-by-step description, and all produces tags
- Hover any card pill to preview the card image
- Rescan button to re-fetch after deck changes

#### 🧬 Commander Synergies tab *(Commander decks only)*
- Fetches EDHREC recommendations for the selected commander
- Results grouped by category: High Synergy, New Cards, Top Cards, Creatures, Instants, Sorceries, Enchantments, Artifacts, Planeswalkers, Mana Artifacts, Utility Lands
- Each card row shows:
  - **✓ green** = in your collection, **⧓ purple** = already in the deck
  - `syn%` = how much more/less often this card appears with this commander vs. other same-color decks
  - `%` = overall inclusion rate across all eligible EDHREC decks
- Filter across all categories at once; collapse/expand sections
- Hover any card row to preview the card image

### General
- **Card image hover tooltips** throughout — search results, collection, deck editor, combos, synergies
- Responsive layout (mobile-friendly)
- All data saved to **your own Google Sheet** — readable and editable directly

---

## Google Sheet Schema

### `Collection` tab — columns A–H
| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| id | name | set_name | set | collector_number | qty | prices | card_data |

### `Decks` tab — columns A–E
| A | B | C | D | E |
|---|---|---|---|---|
| id | name | format | commander | cards |

- `commander` stores the card's **name** (human-readable)
- `cards` stores a JSON array of `{ collectionId, qty }` entries
- `format` is `"Standard"` or `"Commander"`

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/sam-thurman/mtg-tracker.git
cd mtg-tracker
npm install
```

---

### 2. Create your Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet
2. Name it anything you like (e.g. `MTG Collection`)
3. Create two tabs:
   - Rename `Sheet1` → **`Collection`**
   - Add a second sheet → rename it **`Decks`**
4. In **`Collection`** Row 1, add headers:
   ```
   id | name | set_name | set | collector_number | qty | prices | card_data
   ```
5. In **`Decks`** Row 1, add headers:
   ```
   id | name | format | commander | cards
   ```
6. **Share for reading**: Share → Change to anyone with the link → Viewer → Done
7. **Copy your Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_IS_YOUR_ID/edit
   ```

---

### 3. Set up Google Cloud

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. `MTG Tracker`)
3. Go to **APIs & Services → Library**, search **Google Sheets API**, and enable it

#### API Key (for reading)
1. **Credentials → + Create Credentials → API Key**
2. Copy the key; restrict it to Google Sheets API

#### OAuth Client ID (for writing)
1. **Credentials → + Create Credentials → OAuth client ID**
2. Configure the consent screen if prompted (External, add your email as test user)
3. Application type: **Web application**
4. Under **Authorized JavaScript origins**, add:
   - `http://localhost:5173`
   - Your deployed URL (e.g. `https://your-app.vercel.app`)
5. Copy the **Client ID**

---

### 4. Configure environment variables

Create `.env.local` in the project root:

```
VITE_SPREADSHEET_ID=your_spreadsheet_id_here
VITE_API_KEY=your_api_key_here
VITE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
```

> ⚠️ Never commit `.env.local` — it's already in `.gitignore`

---

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The first time you write data, a Google Sign-In redirect will appear — sign in with the account that owns the sheet.

---

## Deploy to Vercel (optional)

1. Push your repo to GitHub
2. Go to [vercel.com](https://vercel.com) and import the repo
3. Under **Project Settings → Environment Variables**, add your three `VITE_*` variables
4. Deploy — you'll get a URL like `https://your-app.vercel.app`
5. Add that URL to your OAuth client's **Authorized JavaScript origins** in Google Cloud Console
6. Redeploy so the env vars take effect

Every future `git push` auto-redeploys.

---

## Tech stack

| | |
|---|---|
| [React](https://react.dev) + [Vite](https://vitejs.dev) | UI framework |
| [Scryfall API](https://scryfall.com/docs/api) | Card data, images, prices |
| [Commander Spellbook API](https://commanderspellbook.com) | Combo finding |
| [EDHREC JSON API](https://edhrec.com) | Commander synergy recommendations |
| [Google Sheets API](https://developers.google.com/sheets/api) | Persistent storage |
| [Google Identity Services](https://developers.google.com/identity) | OAuth for writes |
