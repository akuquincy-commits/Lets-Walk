# Let’s Walk

Let’s Walk is a local, honest walking companion that helps a user plan a scenic pedestrian loop based on location, time, scenery preferences, and mood.

The app uses browser geolocation, real pedestrian routing from Valhalla, nearby map-based scenery checks from OpenStreetMap, and a local Gemma model through Ollama. It does not invent route geometry or scenic features. When data is missing or a service is unavailable, it tells the user clearly instead of pretending everything is confirmed.

## What the app does

- Uses browser geolocation or a manual starting location
- Lets the user choose a walk length of 15, 30, or 45 minutes
- Lets the user select scenery preferences like greenery, parks, gardens, water, and quiet streets
- Uses Valhalla’s pedestrian routing to request a real walking loop
- Validates that the route is a proper loop and close to the requested duration
- Pulls nearby scenic map features from OpenStreetMap where available
- Ranks routes using measured timing and available evidence
- Explains the route using a local Gemma model through Ollama
- Shows three walking reflection prompts for the user to follow on the walk
- Offers a walking mode with timer and prompt reminders
- Shows honest fallback messaging when a route, data source, or AI service is unavailable

## Project status

This project is built as a local prototype and learning project for the Hacktoberfest Open-Source AI Challenge. It is intended for local use and demonstration, not for production-scale public deployment without additional service review and infrastructure hardening.

## Local setup

1. Install dependencies:
   npm install
2. Start the backend and frontend together:
   npm run dev
3. Open the Vite app in your browser.
4. If you want the backend running separately, use:
   npm run server

## Environment variables

Copy `.env.example` to `.env` if you want to override defaults.

- `VITE_API_BASE_URL=http://localhost:3001`
- `OLLAMA_MODEL=gemma2:2b`
- `VALHALLA_URL=https://valhalla1.openstreetmap.de`
- `OVERPASS_URL=https://overpass-api.de/api/interpreter`

## Important limitations and honesty policy

This app is intentionally conservative:

- Nearby map features are evidence of nearby mapped places, not proof that the route passes through them.
- If no suitable route is found, the app says so instead of inventing one.
- If Ollama is unavailable, it falls back to safe explanatory text and prompts.
- If no parks, gardens, water, or greenery are found in the map data, the app says that clearly.

## Local AI setup

Before using the AI explanation flow, install Ollama and pull the model:

1. Install Ollama from the official site for your platform.
2. In a terminal, run:
   ollama pull gemma2:2b
3. Start the local server if needed:
   ollama serve
4. Confirm the model is available:
   ollama list

The default model used by the app is `gemma2:2b`.

## Data and attribution

- Map tiles: OpenStreetMap
- Route engine: Valhalla, using its pedestrian routing profile
- Local model runner: Ollama
- Model: Gemma 2 (local, open-weight model)
- Map and feature data: OpenStreetMap contributors

OpenStreetMap tiles and data require attribution and are subject to their own licence and usage conditions. This project is not claiming that all components are MIT-licensed simply because the repository includes an MIT License file. Third-party services, datasets, and model licences should be reviewed separately.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.

## Submission notes

This project is designed as a working local MVP for the challenge. The strongest parts are:

- a real pedestrian route search using Valhalla
- honest handling of missing data and unavailable services
- a local AI explanation with real usage guardrails
- a clean frontend for planning and walking prompts

The biggest remaining limitation is that public map and routing services are run outside this project and may be rate-limited or unavailable without notice. The app handles that gracefully and explains the limitation to the user instead of fabricating a route.
