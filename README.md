# 🍽️ Linq Food Finder

> An AI-powered restaurant concierge that lives entirely inside iMessage — no app, no download, just text.

Built for the Linq Partner API tech challenge. Powered by Yelp Fusion, Google Places, and Gemini AI.

---

## Demo

[![Demo Video](https://img.shields.io/badge/Watch%20Demo-MP4-blue?style=for-the-badge)](https://github.com/anasbaig10/Linq/releases/download/v1.0/AI-Powered.Restaurant.Reservation.System.Demo.mp4)

---

## What It Does

Text the bot like you'd text a friend. It finds restaurants, filters results using AI, fetches real photos and reviews, and can plan your entire evening — all without leaving iMessage.

```
"best halal food under $20 in Chicago"
"plan a date night in NYC"
"where can I find wagyu beef burger in Boston"
"outdoor rooftop bar with cocktails open now"
```

---

## Features

### 🔍 Smart Search
- Natural language intent parsing via Gemini — understands price, location, cuisine, vibe
- AI result validation — Gemini checks every Yelp result and removes irrelevant ones before you see them
- Specific dish search with wider 15km radius (rare dishes may be farther away)
- Neighborhood-level search ("best seafood around Newbury area, Boston")

### 📸 Rich Results
- Real photos pulled from Google Places for every result
- Attribute badges: 🏕️ Outdoor · 🍸 Cocktails · 🍷 Wine · 🌿 Vegetarian · 📅 Reservable · 🛵 Delivery · 🥡 Takeout · 🎵 Live Music · 👥 Groups
- Google editorial summaries
- Results sorted by how many requested attributes match

### 💾 Save + Insights
- Save by replying with a number (1/2/3) or reacting ❤️ to a result
- Crowd prediction on save — 🟢/🟡/🔴 based on day and time
- Google review pulled automatically with star rating and relative time
- iMessage hearts screen effect on save

### 📅 Reservation Booking
- Checks OpenTable availability for saved restaurants
- Shows available time slots as numbered options
- Generates pre-filled booking link — one tap to confirm
- If not on OpenTable: provides phone number + address to call directly

### ✨ Evening Plan (AI Agent Mode)
- Gemini designs a full 3-stop evening: dinner → dessert → drinks
- 3 Yelp searches run in parallel
- Walking distances calculated between stops using Haversine formula
- Sent as a full itinerary with iMessage sparkles effect

### 💰 Price Intelligence
- Understands dollar amounts: "under $20" → `$`, "around $30" → `$$`, "under $50" → `$$$`
- Hard filters results by Yelp price tier before AI validation
- Gemini sees price tier in listings for additional context

### 🌍 Global Coverage
- Yelp for US/Canada/UK/Australia
- Automatic fallback to Google Places when Yelp has no coverage (Mumbai, Dubai, Tokyo, anywhere)
- Same experience regardless of location

### 👥 Group Chat Voting
- Detects group chats automatically
- Members react ❤️ to vote for their pick
- Text "who's winning" to see live results
- Winner revealed with confetti screen effect

### 🧠 Contextual Q&A
- Ask questions about current results: "which one is best for a first date?"
- "which has the least wait time?" — Gemini answers based on shown results
- Carry-over search refinement: "make it cheaper" / "open now" / "further away"

---

## Architecture

```
iMessage
   ↓
Linq Partner API (webhook)
   ↓
Express server (TypeScript)
   ↓
┌─────────────────────────────────────────────┐
│              Gemini 2.5 Flash               │
│  • Parse intent from natural language       │
│  • Validate & filter search results         │
│  • Generate evening plan itinerary          │
│  • Answer contextual questions              │
│  • Crowd prediction                         │
│  • Parse booking requests                   │
└─────────────────────────────────────────────┘
   ↓
┌──────────────────┐    ┌──────────────────────┐
│   Yelp Fusion    │    │  Google Places (New)  │
│  Business search │    │  Photos, attributes   │
│  Price filters   │    │  Reviews, summaries   │
│  Open now, etc.  │    │  Fallback search      │
└──────────────────┘    └──────────────────────┘
   ↓
┌──────────────────┐
│    OpenTable     │
│  Availability    │
│  Booking links   │
└──────────────────┘
   ↓
Linq Partner API (send message)
   ↓
iMessage
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + TypeScript (ESM) |
| Framework | Express |
| AI | Google Gemini 2.5 Flash |
| Restaurant data | Yelp Fusion API |
| Places / Photos | Google Places API (New) |
| Reservations | OpenTable |
| Messaging | Linq Partner API v3 |
| Tunnel (dev) | Cloudflare Tunnel |

---

## Getting Started

### 1. Clone & Install

```bash
git clone https://github.com/anasbaig10/Linq.git
cd Linq
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Fill in your API keys in `.env`:

| Key | Where to get it |
|---|---|
| `LINQ_API_TOKEN` | [linqapp.com/developers](https://linqapp.com/developers) |
| `YELP_API_KEY` | [docs.developer.yelp.com](https://docs.developer.yelp.com) |
| `GOOGLE_PLACES_API_KEY` | [Google Cloud Console](https://console.cloud.google.com) → Enable "Places API (New)" |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) |

### 3. Run

```bash
npm run dev
```

### 4. Expose via Tunnel

```bash
npx cloudflared tunnel --url http://localhost:3000
```

Copy the `https://xxxx.trycloudflare.com` URL and set it as your webhook in the Linq dashboard:
```
https://xxxx.trycloudflare.com/webhook
```

---

## Project Structure

```
src/
├── index.ts              # Webhook router + event dispatcher
├── ai/
│   ├── gemini.ts         # Gemini API client
│   ├── intent.ts         # Natural language → structured intent
│   ├── validate.ts       # AI result relevance filtering
│   ├── plan.ts           # Evening itinerary generator
│   ├── crowd.ts          # Crowd prediction
│   ├── booking.ts        # Booking request parser
│   ├── refine.ts         # Search refinement (carry-over context)
│   ├── compare.ts        # Compare saved restaurants
│   ├── ask.ts            # Contextual Q&A about results
│   └── fallback.ts       # Auto-fallback suggestions
├── restaurant/
│   ├── handler.ts        # Main message handler + booking flow
│   ├── browse.ts         # Result card formatting
│   ├── evening.ts        # Evening plan orchestrator
│   ├── group.ts          # Group chat + voting
│   └── state.ts          # Session state management
├── booking/
│   └── opentable.ts      # OpenTable search + availability
├── google/
│   └── places.ts         # Google Places client
├── yelp/
│   └── client.ts         # Yelp Fusion client
├── linq/
│   └── client.ts         # Linq Partner API client
├── onboarding/
│   └── flow.ts           # New user onboarding
└── state/
    └── store.ts          # Subscriber store
```

---

## Webhook Events

| Event | Handler |
|---|---|
| `message.received` (inbound) | Intent parse → search / save / plan |
| `reaction.added` | Save restaurant (1:1) or cast vote (group) |

---

## Example Conversations

**Basic search:**
```
You:  best sushi in Boston
Bot:  Searching for sushi in Boston... 🔍
      [photo] 1. O Ya · ⭐4.7 · Japanese · 📅 Reservable
      [photo] 2. Oishii Boston · ⭐4.5 · Japanese
      [photo] 3. Uni · ⭐4.4 · Japanese · 🍸 Cocktails
```

**Evening plan:**
```
You:  plan a date night in Chicago
Bot:  ✨ Planning your evening in River North...
      🍽️ DINNER — Monteverde [photo]
      🍨 DESSERT — Black Dog Gelato [photo] · 0.4km walk
      🍸 DRINKS  — Raised Bar [photo] · 0.6km walk
```

**International:**
```
You:  best biryani in Mumbai
Bot:  [Google Places fallback, automatic]
      [photo] 1. Jaffer Bhai's Delhi Darbar · ⭐4.5
```
