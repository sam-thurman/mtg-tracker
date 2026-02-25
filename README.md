# ⚔️ Arcane Ledger — MTG Collection Tracker

A personal Magic: The Gathering collection tracker that stores your cards and decks in your own Google Sheet. Built with React + Vite, powered by the [Scryfall API](https://scryfall.com/docs/api) for live card data, prices, and images.

**[Live Demo](https://mtg-tracker-seven.vercel.app/)**

---

## Features

- 🔍 Search any card by name — select from all printings/editions
- 📷 Camera scan to identify cards (uses AI vision)
- 💰 Live prices pulled from Scryfall (TCGPlayer & Card Kingdom links)
- 📜 Full official oracle text — no summaries or hallucinations
- 🖼️ Full card images
- 📚 Collection management with quantity tracking and total value
- 🃏 Deck builder — create decks as subsets of your collection
- 🔎 Filter by color, type, mana value, and card text
- ☁️ All data saved to **your own Google Sheet** — visible and editable directly

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
2. Name it `MTG Collection` (or anything you like)
3. Create two tabs at the bottom:
   - Rename `Sheet1` → **`Collection`**
   - Click **+** to add a second sheet → rename it **`Decks`**
4. In the `Collection` tab, add these headers in Row 1:
   ```
   A1: id   B1: name   C1: set_name   D1: set   E1: collector_number   F1: qty   G1: prices   H1: card_data
   ```
5. In the `Decks` tab, add these headers in Row 1:
   ```
   A1: id   B1: name   C1: cards
   ```
6. **Make the sheet readable:** Click **Share → Change to anyone with the link → Viewer → Done**
7. **Copy your Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_IS_YOUR_ID/edit
   ```

---

### 3. Set up Google Cloud

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. `MTG Tracker`)
3. Go to **APIs & Services → Library**, search for **Google Sheets API**, and enable it

#### Get an API Key (for reading)
1. Go to **APIs & Services → Credentials → + Create Credentials → API Key**
2. Copy the key
3. Click **Edit** on the key → restrict it to **Google Sheets API**

#### Get an OAuth Client ID (for writing)
1. Go to **APIs & Services → Credentials → + Create Credentials → OAuth client ID**
2. If prompted, configure the consent screen first:
   - Choose **External**
   - Fill in app name and your email, save through all steps
   - Under **Audience**, add yourself as a test user
3. Back in Credentials, create the OAuth client:
   - Application type: **Web application**
   - Under **Authorized JavaScript origins**, add:
     - `http://localhost:5173` (for local dev)
     - Your deployed URL if applicable (e.g. `https://your-app.vercel.app`)
4. Copy the **Client ID**

---

### 4. Configure environment variables

Create a `.env.local` file in the project root:

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

Open [http://localhost:5173](http://localhost:5173) in your browser.

The first time you add a card, a Google Sign-In popup will appear — sign in with the account that owns your sheet.

---

## Deploy to Vercel (optional)

1. Push your repo to GitHub
2. Go to [vercel.com](https://vercel.com), import your repo
3. Under **Project Settings → Environment Variables**, add your three `VITE_*` variables with their values
4. Deploy — you'll get a URL like `https://your-app.vercel.app`
5. Add that URL to your OAuth client's **Authorized JavaScript origins** in Google Cloud Console
6. Redeploy so the env vars take effect

Every future `git push` will auto-redeploy.

---

## How data is stored

Your Google Sheet has two tabs:

- **Collection** — one row per unique card. The `card_data` column stores full Scryfall card info as JSON. All other columns (`name`, `qty`, `prices`, etc.) are human-readable.
- **Decks** — one row per deck, with card references stored as JSON.

You can edit quantities, add notes columns, or export the sheet anytime — the app only reads/writes columns A–H on Collection and A–C on Decks.

---

## Tech stack

- [React](https://react.dev) + [Vite](https://vitejs.dev)
- [Scryfall API](https://scryfall.com/docs/api) — card data, images, prices
- [Google Sheets API](https://developers.google.com/sheets/api) — persistent storage
- [Google Identity Services](https://developers.google.com/identity) — OAuth for writes
