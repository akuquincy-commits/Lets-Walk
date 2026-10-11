# Let's Walk

Let's Walk is a local, honest walking companion that helps you plan a scenic pedestrian loop based on location, time, scenery preferences, and mood.

The app uses browser geolocation, real pedestrian routing from Valhalla, nearby map-based scenery checks from OpenStreetMap, and a local Gemma model through Ollama. It does not invent route geometry—if a good route isn't available, it says so.

## What the app does

- Uses browser geolocation or a manual starting location
- Lets you choose a walk length of 15, 30, or 45 minutes
- Lets you select scenery preferences like greenery, parks, gardens, water, and quiet streets
- Uses Valhalla's pedestrian routing to request a real walking loop
- Validates that the route is a proper loop and close to the requested duration
- Pulls nearby scenic map features from OpenStreetMap where available
- Ranks routes using measured timing and available evidence
- Explains the route using a local Gemma model through Ollama
- Shows three walking reflection prompts for you to follow on the walk
- Offers a walking mode with timer and prompt reminders
- Shows honest fallback messaging when a route, data source, or AI service is unavailable

## Project status

This project is built as a local prototype and learning project for the Hacktoberfest Open-Source AI Challenge. It is intended for local use and demonstration, not for production-scale public deployment.

## Prerequisites

Before running this project, make sure you have:

- **Node.js** (v16 or higher) and **npm**
- **Ollama** (for local AI explanations) — [Install here](https://ollama.ai)
- Modern web browser with geolocation support

## Quick start

### 1. Install dependencies:
```bash
npm install
```

### 2. Set up Ollama (optional but recommended):
Before using the AI explanation flow, install and configure Ollama:

```bash
# Install Ollama from https://ollama.ai
# Then pull the default model in a terminal:
ollama pull gemma2:2b

# Start the Ollama server (if not running automatically):
ollama serve

# Verify the model is available:
ollama list
```

### 3. Run the app:

**Option A: Development mode (frontend + backend together):**
```bash
npm run dev
```
Then open the Vite app in your browser (usually `http://localhost:5173`).

**Option B: Run backend separately:**
```bash
npm run server
```
Then start the frontend in another terminal and open it in your browser.

## Environment variables

Copy `.env.example` to `.env` if you want to override defaults:

```env
VITE_API_BASE_URL=http://localhost:3001
OLLAMA_MODEL=gemma2:2b
VALHALLA_URL=https://valhalla1.openstreetmap.de
OVERPASS_URL=https://overpass-api.de/api/interpreter
```

### What each variable does:
- **VITE_API_BASE_URL** — Backend API server address
- **OLLAMA_MODEL** — Local model for route explanations (default: gemma2:2b)
- **VALHALLA_URL** — Pedestrian routing service (uses FOSSGIS public demo by default)
- **OVERPASS_URL** — OpenStreetMap feature lookup service

## External services used

This app relies on public services that may occasionally be rate-limited or unavailable:

- **Valhalla** — Pedestrian routing (FOSSGIS-hosted public demo)
- **OpenStreetMap** — Map tiles and feature data
- **Overpass API** — Bounded OSM feature lookups near routes

The app gracefully handles service outages and clearly reports when data is unavailable.

## Important limitations and honesty policy

This app is intentionally conservative:

- Nearby map features are evidence of nearby mapped places, not proof that the route passes through them.
- If no suitable route is found, the app says so instead of inventing one.
- If Ollama is unavailable, it falls back to safe explanatory text and prompts.
- If no parks, gardens, water, or greenery are found in the map data, the app says that clearly.

## Data and attribution

- **Map tiles & data:** OpenStreetMap
- **Route engine:** Valhalla (pedestrian routing profile)
- **Local model runner:** Ollama
- **Model:** Gemma 2 (local, open-weight model)

OpenStreetMap tiles and data require attribution and are subject to their own licence and usage conditions. See the [OSM license](https://www.openstreetmap.org/copyright) for details.

Spoken walking prompts use the browser's built-in speech synthesis. Test audio before starting, since speech availability and background playback depend on the browser and device.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.

## Built with

- **Frontend:** JavaScript, CSS, HTML (77% JS, 22% CSS, 0.7% HTML)
- **Backend:** Node.js
- **Routing:** Valhalla
- **AI:** Ollama + Gemma 2
- **Maps:** OpenStreetMap + Overpass API

## Submission notes

This project is designed as a working local MVP for the challenge. The strongest parts are:

- Real pedestrian route search using Valhalla
- Honest handling of missing data and unavailable services
- Local AI explanation with real usage guardrails
- Clean frontend for planning and walking prompts

The biggest remaining limitation is that public map and routing services are run outside this project and may be rate-limited or unavailable without notice. The app handles that gracefully and explains what happened.
