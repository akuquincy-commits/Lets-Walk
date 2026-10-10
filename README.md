# Let’s Walk

Let’s Walk is a walking planner that helps people discover a pedestrian loop using their start location, preferred duration, scenery choices, and mood. The app combines browser geolocation, pedestrian routing from Valhalla, and a local AI explanation and prompt generator through Ollama.

## What this app does

- Uses browser geolocation or a manually entered location.
- Lets the user choose a walking duration of 15, 30, or 45 minutes.
- Allows scenery preferences such as greenery, parks, gardens, water, and quiet streets.
- Uses Valhalla's pedestrian costing model to request real walking routes.
- Validates that the route loops back to the original start point.
- Retrieves nearby OpenStreetMap scenery evidence and ranks validated routes by measured duration and evidence-backed scenery matches.
- Displays the route on an interactive map.
- Shows mapped scenery features and links to their OpenStreetMap records; nearby does not mean the route passes through a feature.
- Uses Gemma via Ollama for the route explanation and three walking prompts, with clearly labelled fallback content if Ollama is unavailable.
- Offers a walking mode that reads prompts aloud at a selectable 5-, 10-, or 15-minute interval, with pause and resume controls.
- Reports when scenery lookup is unavailable or when supported features were not found; quiet-street ambience is not inferred from map data.

## Local setup

1. Install dependencies:
   npm install
2. Start the app and API server:
   npm run dev
3. Open the application in a browser on the Vite localhost port.

## Environment variables

Copy `.env.example` to `.env` if you want to override defaults.

- `VITE_API_BASE_URL=http://localhost:3001`
- `OLLAMA_MODEL=gemma2:2b`
- `VALHALLA_URL=https://valhalla1.openstreetmap.de`
- `OVERPASS_URL=https://overpass-api.de/api/interpreter`

The default Valhalla URL is the FOSSGIS-hosted public demo, linked by the [Valhalla API documentation](https://valhalla.github.io/valhalla/api/route/api-reference/). Its API provides pedestrian costing, but a fair-use quota or production SLA was not found in the published API documentation. Use this endpoint only for low-volume development; use a self-hosted Valhalla instance or another provider with explicit service terms before deploying for public or sustained use. The app submits up to four pedestrian route requests for each route-planning request.

The default `OVERPASS_URL` queries OpenStreetMap features near route geometries. It is a bounded, best-effort development lookup and can be unavailable or rate-limited; on failure, the app reports that scenery could not be checked and ranks routes by duration alone. Do not build a production service around the public Overpass instance without reviewing its [usage guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) and choosing an appropriate hosted or self-managed data service. Scenic features are sourced from OpenStreetMap and linked to their OSM records. Feature proximity is evidence of nearby mapped scenery, not proof that a pedestrian path enters the feature.

If Ollama is installed locally and the model is available, the app uses it for route explanations and walking prompts. If not, it returns clearly labelled fallback content.

## Data and attribution

- Map tiles: OpenStreetMap
- Routing engine: Valhalla, using its `pedestrian` costing model
- AI model: Ollama with Gemma (if installed locally)
- Map and routing data: OpenStreetMap contributors
- Nearby scenic-feature data: OpenStreetMap contributors, queried using the Overpass API

Leaflet displays the map; Valhalla calculates routes. The public Valhalla demo and OpenStreetMap tile service are separate services with separate availability and usage policies. OpenStreetMap data is licensed under the ODbL; the public map tiles require OpenStreetMap attribution and must be used according to the tile usage policy. Valhalla is open source under the MIT License. The project MIT license does not relicense these services or datasets. This project is designed for local prototyping and educational use.

Spoken walking prompts use the browser's built-in speech synthesis. Test audio before starting, since speech availability and background playback depend on the browser and device; keep your attention on your surroundings rather than the screen.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.