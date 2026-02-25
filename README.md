# ⚔️ Arcane Ledger — MTG Collection Tracker

A personal Magic: The Gathering collection tracker that stores your cards and decks in your own Google Sheet. Built with React + Vite, powered by the [Scryfall API](https://scryfall.com/docs/api) for live card data, prices, and images.

**[Live Demo](https://mtg-tracker-sam.vercel.app/)**

---

## Features

### 🔍 Search & Add
- Search any card by name — select from all printings/editions
- 📷 **Camera scan** to identify cards via AI vision
- Live prices from Scryfall with **TCGPlayer** and **Card Kingdom** links
- Full oracle text, card image (click to enlarge), mana cost, type, P/T
- **+ Add to Collection** — tracks quantity, deduplicates by Scryfall ID
- **🃏 Add to Deck** — multi-deck selector opens directly from the search result; if the card isn't in your collection yet, prompts to add it to both

### 📚 Collection
- Filter by color, **type keywords** (multi-select dropdown), **subtype** (autocomplete search), mana value, and free-text search
- Sort by name, price, color, or mana value
- **All Editions / Unique Names** toggle — Unique Names collapses all printings into one row with total quantity; expanding the row shows each owned printing with set art, name, and quantity
- Quantity controls (−/+) and per-card subtotal
- **🃏 Deck badge** on every row — shows how many decks the card is in; click to open the deck multi-selector to add/remove from any deck
- Card image hover tooltip on the name/art area

### 🃏 Decks
- Create and delete decks; **Format selector** — Standard or Commander
- **Commander selection** — designate any Legendary Creature in the deck as commander; highlighted in sidebar and card table
- Deck editor with card list — add from collection, adjust quantities, remove cards
- Per-deck total value and card count

#### ⚡ Combos tab *(in Deck Editor)*
- Queries [Commander Spellbook](https://commanderspellbook.com) for combos involving cards in the deck
- Ranks combos by completeness: **purple** = in deck, **green** = in collection, **grey** = need to buy
- Expand any combo for prerequisites, steps, and produces; hover card pills to preview images

#### 🧬 Commander Synergies tab *(Commander decks only)*
- Fetches EDHREC recommendations for the selected commander
- Grouped by category (High Synergy, Creatures, Instants, etc.) with synergy % and inclusion %
- **✓ green** = in collection, **⧓ purple** = in deck; filter across all categories at once

---

## Prerequisites

- [Node.js](https://nodejs.org) v18+
- A Google account
- A Google Cloud project (free tier is fine)

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/sam-thurman/mtg-tracker.git
cd mtg-tracker
npm install
```

---

### 2. Create your Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet
2. Create **two tabs** at the bottom:
   - Rename `Sheet1` → **`Collection`**
   - Click **+** → rename it **`Decks`**
3. In **`Collection`** — add these headers in Row 1:

   | A | B | C | D | E | F | G | H |
   |---|---|---|---|---|---|---|---|
   | id | name | set_name | set | collector_number | qty | prices | card_data |

4. In **`Decks`** — add these headers in Row 1:

   | A | B | C | D | E |
   |---|---|---|---|---|
   | id | name | format | commander | cards |

5. **Make the sheet publicly readable** (required for the read-only API key to work):
   - Click **Share** → **Change to anyone with the link** → set to **Viewer** → **Done**
6. **Copy your Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit
   ```

---

### 3. Set up Google Cloud

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. `MTG Tracker`)
3. Go to **APIs & Services → Library**, search for **Google Sheets API**, and click **Enable**

#### 3a. Create an API Key (for reading data)

1. Go to **APIs & Services → Credentials → + Create Credentials → API Key**
2. Copy the generated key
3. Click **Edit** on the key → under **API restrictions**, restrict it to **Google Sheets API** → **Save**

#### 3b. Create an OAuth Client ID (for writing data)

1. Go to **APIs & Services → Credentials → + Create Credentials → OAuth client ID**
2. If prompted to configure the consent screen:
   - Choose **External**
   - Fill in **App name** (e.g. `MTG Tracker`) and your email
   - Click through all steps to save
   - Under **Audience / Test users**, add your Google account email
3. Back in Credentials, create the OAuth client:
   - **Application type**: Web application
   - **Name**: anything (e.g. `MTG Tracker Web`)
   - Under **Authorized JavaScript origins**, add:
     - `http://localhost:5173` (local dev)
     - Your deployed URL if applicable (e.g. `https://your-app.vercel.app`)
   - Click **Create** and copy the **Client ID**

---

### 4. Configure environment variables

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
VITE_SPREADSHEET_ID=your_spreadsheet_id_here
VITE_API_KEY=your_api_key_here
VITE_CLIENT_ID=your_oauth_client_id_here.apps.googleusercontent.com
```

> ⚠️ `.env.local` is already in `.gitignore` — never commit it.

---

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

**First use:** search for a card, select it, and click **+ Add to Collection**. A Google Sign-In redirect will appear — sign in with the account that owns your sheet. After authorizing, you'll be redirected back and the card will be saved automatically.

---

## Deploy to Vercel (optional)

1. Push your repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import your repo
3. Under **Project Settings → Environment Variables**, add all three `VITE_*` variables with their values
4. Click **Deploy** — you'll get a URL like `https://your-app.vercel.app`
5. Back in Google Cloud Console, add your Vercel URL to your OAuth client's **Authorized JavaScript origins** → Save
6. Redeploy on Vercel so the env vars take effect (or just push any change)

Every future `git push` to your main branch auto-redeploys.

---

## How data is stored

| Sheet | Columns | Contents |
|-------|---------|----------|
| **Collection** | A–H | One row per unique printing. `card_data` (col H) stores full Scryfall JSON. Other columns are human-readable. |
| **Decks** | A–E | One row per deck. `commander` (col D) stores the card name. `cards` (col E) stores `[{ collectionId, qty }]` as JSON. |

You can edit quantities or add notes columns directly in the sheet — the app only reads/writes columns A–H on Collection and A–E on Decks.

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
