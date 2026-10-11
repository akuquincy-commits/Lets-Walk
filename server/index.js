import express from 'express'
import cors from 'cors'

const app = express()
const port = process.env.PORT || 3001
const valhallaUrl = (process.env.VALHALLA_URL || 'https://valhalla1.openstreetmap.de').replace(/\/+$/, '')
const overpassUrl = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter'

app.use(cors())
app.use(express.json())

const LOOP_START_TOLERANCE_METERS = 150
const AVERAGE_WALKING_SPEED_METERS_PER_MINUTE = 75
const SCENIC_FEATURE_SEARCH_RADIUS_METERS = 100
const MAX_SCENIC_QUERY_POINTS = 120
const MAX_SCENIC_FEATURES = 300

function round(value, digits = 2) {
  return Number(value.toFixed(digits))
}

function distanceBetween([lat1, lon1], [lat2, lon2]) {
  const R = 6371000
  const toRad = (value) => (value * Math.PI) / 180

  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function destinationPoint(origin, distanceMeters, bearingDegrees) {
  const earthRadiusMeters = 6371000
  const bearing = bearingDegrees * Math.PI / 180
  const latitude = origin.lat * Math.PI / 180
  const longitude = origin.lon * Math.PI / 180
  const angularDistance = distanceMeters / earthRadiusMeters
  const targetLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
    Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  )
  const targetLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(targetLatitude),
  )

  return {
    lat: targetLatitude * 180 / Math.PI,
    lon: ((targetLongitude * 180 / Math.PI + 540) % 360) - 180,
  }
}

function buildLoopCandidates(origin, targetDurationMinutes) {
  const estimatedLoopDistanceMeters = targetDurationMinutes * AVERAGE_WALKING_SPEED_METERS_PER_MINUTE
  const waypointDistanceMeters = estimatedLoopDistanceMeters / 2

  return [0, 90, 180, 270].map((bearing, index) => ({
    id: `walking-loop-${index + 1}`,
    name: `Walking loop option ${index + 1}`,
    waypoint: destinationPoint(origin, waypointDistanceMeters, bearing),
  }))
}

async function geocodePlace(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`

  const response = await fetch(url, {
    headers: {
      'Accept-Language': 'en',
      'User-Agent': 'LetsWalk/1.0',
    },
  })

  if (!response.ok) {
    throw new Error('Location lookup failed')
  }

  const data = await response.json()

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`No coordinates found for “${query}”`)
  }

  const place = data[0]

  return {
    lat: Number(place.lat),
    lon: Number(place.lon),
    displayName: place.display_name,
  }
}

function decodePolyline(encoded, precision = 6) {
  const coordinates = []
  const factor = 10 ** precision
  let index = 0
  let latitude = 0
  let longitude = 0

  while (index < encoded.length) {
    const deltas = []

    for (let coordinate = 0; coordinate < 2; coordinate += 1) {
      let result = 0
      let shift = 0
      let byte

      do {
        if (index >= encoded.length) {
          throw new Error('Valhalla returned an incomplete route shape.')
        }
        byte = encoded.charCodeAt(index) - 63
        index += 1
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)

      deltas.push(result & 1 ? ~(result >> 1) : result >> 1)
    }

    latitude += deltas[0]
    longitude += deltas[1]
    coordinates.push([latitude / factor, longitude / factor])
  }

  if (coordinates.length < 2) {
    throw new Error('Valhalla returned a route without usable geometry.')
  }

  return coordinates
}

async function fetchPedestrianLoop(start, waypoint) {
  const request = {
    locations: [
      { lat: start.lat, lon: start.lon, type: 'break' },
      { lat: waypoint.lat, lon: waypoint.lon, type: 'break' },
      { lat: start.lat, lon: start.lon, type: 'break' },
    ],
    costing: 'pedestrian',
    units: 'kilometers',
    shape_format: 'polyline6',
    directions_options: { units: 'kilometers' },
  }
  const url = new URL(`${valhallaUrl}/route`)
  url.searchParams.set('json', JSON.stringify(request))

  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20000) })
  } catch (error) {
    throw new Error(`Valhalla pedestrian routing request failed: ${error.message}`, { cause: error })
  }

  if (response.status === 400) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Valhalla pedestrian routing service returned HTTP ${response.status}.`)
  }

  const payload = await response.json()
  const trip = payload.trip
  if (!trip || trip.status !== 0 || !Array.isArray(trip.legs) || trip.legs.length !== 2) {
    return null
  }

  const routeGeometry = trip.legs.reduce((points, leg) => {
    if (typeof leg.shape !== 'string' || !leg.summary) {
      throw new Error('Valhalla returned a leg without route geometry or measured metrics.')
    }

    const legPoints = decodePolyline(leg.shape)
    return points.length > 0 ? points.concat(legPoints.slice(1)) : legPoints
  }, [])
  const firstPoint = routeGeometry[0]
  const lastPoint = routeGeometry[routeGeometry.length - 1]
  const firstSnap = trip.locations?.[0]
  const lastSnap = trip.locations?.[trip.locations.length - 1]
  const startSnapsMatch = firstSnap && lastSnap &&
    distanceBetween([firstSnap.lat, firstSnap.lon], [start.lat, start.lon]) <= LOOP_START_TOLERANCE_METERS &&
    distanceBetween([lastSnap.lat, lastSnap.lon], [start.lat, start.lon]) <= LOOP_START_TOLERANCE_METERS
  const geometryClosesLoop = distanceBetween(firstPoint, [start.lat, start.lon]) <= LOOP_START_TOLERANCE_METERS &&
    distanceBetween(lastPoint, [start.lat, start.lon]) <= LOOP_START_TOLERANCE_METERS
  const distanceKm = trip.legs.reduce((total, leg) => total + Number(leg.summary.length), 0)
  const durationSeconds = trip.legs.reduce((total, leg) => total + Number(leg.summary.time), 0)

  if (!Number.isFinite(distanceKm) || !Number.isFinite(durationSeconds)) {
    throw new Error('Valhalla returned invalid route distance or duration metrics.')
  }

  return {
    distanceKm,
    durationSeconds,
    geometry: routeGeometry,
    loopMatchesStart: Boolean(startSnapsMatch && geometryClosesLoop),
  }
}

function scoreCandidate(route, targetDurationMinutes, sceneryPreferences, scenicEvidence, scenicEvidenceStatus) {
  const durationMinutes = route.durationSeconds / 60
  const durationDifference = Math.abs(durationMinutes - targetDurationMinutes)
  const allowedDifference = Math.max(5, targetDurationMinutes * 0.5)
  const durationScore = Math.max(0, 100 - (durationDifference / allowedDifference) * 100)
  const supportedPreferences = sceneryPreferences.filter((preference) => (
    ['greenery', 'parks', 'gardens', 'water'].includes(preference)
  ))
  const matchedPreferences = supportedPreferences.filter((preference) => (
    scenicEvidence.some((feature) => feature.categories.includes(preference))
  ))
  const sceneryScore = supportedPreferences.length > 0
    ? matchedPreferences.length / supportedPreferences.length * 100
    : null
  const canScoreScenery = scenicEvidenceStatus === 'available' && sceneryScore !== null

  return {
    durationMinutes,
    durationDifferenceMinutes: durationDifference,
    acceptable: durationDifference <= allowedDifference,
    durationScore,
    sceneryScore,
    matchedPreferences,
    unsupportedPreferences: sceneryPreferences.filter((preference) => (
      !['greenery', 'parks', 'gardens', 'water'].includes(preference)
    )),
    supportedPreferences,
    score: canScoreScenery
      ? durationScore * 0.7 + sceneryScore * 0.3
      : durationScore,
  }
}

function sampleRouteGeometry(geometry, spacingMeters = 75) {
  if (geometry.length < 2) {
    return geometry
  }

  const sampledPoints = [geometry[0]]
  let distanceSinceLastSample = 0

  for (let index = 1; index < geometry.length; index += 1) {
    distanceSinceLastSample += distanceBetween(geometry[index - 1], geometry[index])
    if (distanceSinceLastSample >= spacingMeters) {
      sampledPoints.push(geometry[index])
      distanceSinceLastSample = 0
    }
  }

  const lastPoint = geometry[geometry.length - 1]
  if (sampledPoints[sampledPoints.length - 1] !== lastPoint) {
    sampledPoints.push(lastPoint)
  }

  return sampledPoints
}

function limitRouteSamples(points, limit) {
  if (points.length <= limit) {
    return points
  }

  return Array.from({ length: limit }, (_, index) => (
    points[Math.round(index * (points.length - 1) / (limit - 1))]
  ))
}

function distanceToRouteMeters(point, geometry) {
  if (geometry.length < 2) {
    return geometry.length === 1 ? distanceBetween(point, geometry[0]) : Infinity
  }

  const latitudeScale = 111320
  const longitudeScale = latitudeScale * Math.cos(point[0] * Math.PI / 180)
  let nearestDistance = Infinity
  for (let index = 1; index < geometry.length; index += 1) {
    const previous = geometry[index - 1]
    const current = geometry[index]
    const startX = (previous[1] - point[1]) * longitudeScale
    const startY = (previous[0] - point[0]) * latitudeScale
    const endX = (current[1] - point[1]) * longitudeScale
    const endY = (current[0] - point[0]) * latitudeScale
    const segmentX = endX - startX
    const segmentY = endY - startY
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY
    const projection = segmentLengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(startX * segmentX + startY * segmentY) / segmentLengthSquared))
    const nearestX = startX + projection * segmentX
    const nearestY = startY + projection * segmentY
    nearestDistance = Math.min(nearestDistance, Math.hypot(nearestX, nearestY))
  }

  return nearestDistance
}

function scenicCategory(tags) {
  const categories = new Set()
  if (['park', 'garden', 'nature_reserve'].includes(tags.leisure) ||
      ['grass', 'forest', 'meadow'].includes(tags.landuse) ||
      ['wood', 'grassland', 'scrub'].includes(tags.natural)) {
    categories.add('greenery')
  }
  if (tags.leisure === 'park') categories.add('parks')
  if (tags.leisure === 'garden') categories.add('gardens')
  if (tags.natural === 'water' || tags.natural === 'wetland' ||
      ['river', 'stream', 'canal'].includes(tags.waterway) ||
      tags.landuse === 'reservoir' || tags.water) {
    categories.add('water')
  }
  return [...categories]
}

function describeScenicFeature(element, routeGeometry) {
  const point = element.type === 'node' && Number.isFinite(element.lat) && Number.isFinite(element.lon)
    ? [element.lat, element.lon]
    : Number.isFinite(element.center?.lat) && Number.isFinite(element.center?.lon)
      ? [element.center.lat, element.center.lon]
      : null
  if (!point) {
    return null
  }

  const nearestDistance = distanceToRouteMeters(point, routeGeometry)
  if (nearestDistance > SCENIC_FEATURE_SEARCH_RADIUS_METERS) {
    return null
  }

  const tags = element.tags || {}
  const categories = scenicCategory(tags)
  if (categories.length === 0) {
    return null
  }

  const objectType = element.type
  const name = typeof tags.name === 'string' && tags.name.trim()
    ? tags.name.trim()
    : categories.includes('parks')
      ? 'Unnamed park'
      : categories.includes('gardens')
        ? 'Unnamed garden'
        : categories.includes('water')
          ? 'Unnamed water feature'
          : 'Unnamed green space'

  return {
    id: `${objectType}/${element.id}`,
    name,
    categories,
    distanceMeters: Math.round(nearestDistance),
    latitude: point[0],
    longitude: point[1],
    osmType: objectType,
    osmId: element.id,
    url: `https://www.openstreetmap.org/${objectType}/${element.id}`,
  }
}

async function fetchScenicEvidence(routes) {
  const maxSamplesPerRoute = Math.max(2, Math.floor(MAX_SCENIC_QUERY_POINTS / routes.length))
  const routeSamples = new Map(
    routes.map((candidate) => [
      candidate.id,
      limitRouteSamples(sampleRouteGeometry(candidate.route.geometry), maxSamplesPerRoute),
    ]),
  )
  const uniquePoints = new Map()
  for (const points of routeSamples.values()) {
    for (const [lat, lon] of points) {
      uniquePoints.set(`${lat.toFixed(5)},${lon.toFixed(5)}`, [lat, lon])
    }
  }

  const points = [...uniquePoints.values()]
  const emptyEvidence = Object.fromEntries(routes.map(({ id }) => [id, []]))
  if (points.length === 0) {
    return { status: 'unavailable', evidenceByRoute: emptyEvidence }
  }

  const locations = points.map(([lat, lon]) => `${lat},${lon}`).join(',')
  const featureSelectors = [
    `nwr(around:${SCENIC_FEATURE_SEARCH_RADIUS_METERS},${locations})[leisure~"^(park|garden|nature_reserve)$"];`,
    `nwr(around:${SCENIC_FEATURE_SEARCH_RADIUS_METERS},${locations})[landuse~"^(grass|forest|meadow|reservoir)$"];`,
    `nwr(around:${SCENIC_FEATURE_SEARCH_RADIUS_METERS},${locations})[natural~"^(wood|grassland|scrub|water|wetland)$"];`,
    `nwr(around:${SCENIC_FEATURE_SEARCH_RADIUS_METERS},${locations})[waterway~"^(river|stream|canal)$"];`,
    `nwr(around:${SCENIC_FEATURE_SEARCH_RADIUS_METERS},${locations})[water];`,
  ]
  const query = `[out:json][timeout:20][maxsize:67108864];(${featureSelectors.join('')});out center tags;`

  try {
    const response = await fetch(overpassUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json',
        'User-Agent': 'LetsWalk/1.0 (local educational project)',
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(25000),
    })
    if (!response.ok) {
      console.warn(`OpenStreetMap scenic-feature lookup returned HTTP ${response.status}.`)
      return { status: 'unavailable', evidenceByRoute: emptyEvidence }
    }

    const payload = await response.json()
    if (!Array.isArray(payload.elements)) {
      return { status: 'unavailable', evidenceByRoute: emptyEvidence }
    }

    if (payload.elements.length > MAX_SCENIC_FEATURES) {
      console.warn(`OpenStreetMap scenic-feature lookup returned more than ${MAX_SCENIC_FEATURES} features.`)
      return { status: 'unavailable', evidenceByRoute: emptyEvidence }
    }

    const elements = payload.elements
    const evidenceByRoute = Object.fromEntries(routes.map(({ id }) => [id, []]))
    for (const candidate of routes) {
      const matched = new Map()
      for (const element of elements) {
        const feature = describeScenicFeature(element, candidate.route.geometry)
        if (feature) {
          matched.set(feature.id, feature)
        }
      }
      evidenceByRoute[candidate.id] = [...matched.values()]
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
    }

    return {
      status: elements.length > 0 ? 'available' : 'no_features',
      evidenceByRoute,
    }
  } catch (error) {
    console.warn(`OpenStreetMap scenic-feature lookup failed: ${error.message}`)
    return { status: 'unavailable', evidenceByRoute: emptyEvidence }
  }
}

function parseOllamaJsonResponse(content) {
  const trimmed = String(content || '').trim()
  if (!trimmed) {
    throw new Error('Gemma returned empty output.')
  }

  const candidates = [trimmed]
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced && fenced[1]) {
    candidates.push(fenced[1].trim())
  }

  let lastError
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch (error) {
      lastError = error
      const objectMatch = candidate.match(/\{[\s\S]*\}/)
      if (objectMatch) {
        try {
          return JSON.parse(objectMatch[0])
        } catch (innerError) {
          lastError = innerError
        }
      }
    }
  }

  throw lastError || new Error('Gemma returned invalid JSON.')
}

async function generateAiSummary({ route, locationLabel, preferences, mood, targetDurationMinutes, scenicEvidence }) {
  const model = process.env.OLLAMA_MODEL || 'gemma2:2b'
  const basePrompt = `
You are a careful walking-route assistant. Use only the route and evidence supplied below.
Do not invent coordinates, distances, landmarks, or scenery that are absent from the data.
The user asked for a ${targetDurationMinutes}-minute walk with a ${mood} mood and scenery preferences: ${preferences.length ? preferences.join(', ') : 'none selected'}.
Route data (Valhalla pedestrian-costing response):
- Start location: ${locationLabel}
- Route duration: ${Math.round(route.durationSeconds / 60)} minutes
- Route distance: ${round(route.distanceKm, 2)} km
${scenicEvidence.length
    ? `- Nearby OpenStreetMap features: ${JSON.stringify(scenicEvidence)}. The distance is from the route to each mapped node or area center, not proof that the path enters or touches that feature.`
    : '- No scenic feature was verified near this route. State this clearly and do not imply that the selected scenery preferences were verified.'}
Explain briefly how the measured pedestrian route fits the requested duration and mood.
Only refer to a named feature when its name appears in the supplied evidence. Describe supplied features as nearby only; never claim that the route passes through, visits, enters, or runs beside a feature.
Do not invent directions, route characteristics, landmarks, or scenery.
Do not say that scenery preferences were verified when scenic evidence is unavailable.
Then provide exactly 3 short reflective or observation prompts that can be used on a walk.
Return valid JSON in this shape: {"explanation":"...","prompts":["...","...","..."]}
`

  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: basePrompt,
        stream: false,
        format: 'json',
      }),
    })

    if (!response.ok) {
      throw new Error('Ollama model not available')
    }

    const payload = await response.json()
    const content = payload.response || ''
    const parsed = parseOllamaJsonResponse(content)
    const explanation = typeof parsed.explanation === 'string' ? parsed.explanation.trim() : ''
    const prompts = Array.isArray(parsed.prompts)
      ? parsed.prompts.filter((prompt) => typeof prompt === 'string' && prompt.trim()).map((prompt) => prompt.trim())
      : []

    if (!explanation || prompts.length !== 3) {
      throw new Error('Gemma returned an incomplete explanation or walking prompt list.')
    }
    if (/\b(?:passes?\s+(?:directly\s+)?(?:through|across|alongside|beside)|\b(?:on|along|alongside)\s+the\s+route\b|\b(?:route|path)\s+(?:visits?|includes?|goes?\s+through|enters?)\b)/i.test(explanation)) {
      throw new Error('Gemma described nearby scenery as being on the route.')
    }

    return {
      explanation,
      prompts,
      source: 'ollama',
      model,
    }
  } catch (error) {
    console.warn(`Ollama summary generation failed; using labelled fallback prompts: ${error.message}`)
    return {
      explanation: scenicEvidence.length
        ? `This is a pedestrian route returned by Valhalla with a measured duration of ${Math.round(route.durationSeconds / 60)} minutes. We found ${scenicEvidence.length} nearby map feature${scenicEvidence.length === 1 ? '' : 's'} in the route area, but these are nearby points rather than proof that the route passes through them.`
        : `This is a pedestrian route returned by Valhalla with a measured duration of ${Math.round(route.durationSeconds / 60)} minutes. We checked for parks, gardens, greenery, and water close to the route, but nothing matching those categories was found in the map data available.`,
      prompts: [
        'What sounds or textures stand out most on this stretch?',
        'Which part of the route feels most calming or energising?',
        'What detail would you want to notice on a second lap?',
      ],
      source: 'fallback',
      model,
    }
  }
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, status: 'running' })
})

app.post('/api/plan-route', async (req, res) => {
  try {
    const { location, originCoordinates, duration, scenery, mood } = req.body || {}
    const requestedDuration = Number(duration) || 30
    const sceneryPreferences = Array.isArray(scenery) ? scenery : [scenery].filter(Boolean)
    const normalizedMood = mood || 'relaxed'

    if (typeof location !== 'string' || !location.trim()) {
      return res.status(400).json({ error: 'A start location is required.' })
    }
    if (![15, 30, 45].includes(requestedDuration)) {
      return res.status(400).json({ error: 'Walking duration must be 15, 30, or 45 minutes.' })
    }

    const hasOriginCoordinates = originCoordinates &&
      Number.isFinite(Number(originCoordinates.lat)) &&
      Number.isFinite(Number(originCoordinates.lon)) &&
      Math.abs(Number(originCoordinates.lat)) <= 90 &&
      Math.abs(Number(originCoordinates.lon)) <= 180

    let origin
    try {
      origin = hasOriginCoordinates
        ? { lat: Number(originCoordinates.lat), lon: Number(originCoordinates.lon), displayName: location }
        : await geocodePlace(location)
    } catch {
      return res.status(400).json({
        error: 'We could not find that starting location. Please try a more specific place name or use your current location.',
      })
    }

    const loopCandidates = buildLoopCandidates(origin, requestedDuration)
    const ranked = []

    for (const candidate of loopCandidates) {
      const route = await fetchPedestrianLoop(origin, candidate.waypoint)
      if (!route) {
        continue
      }

      const timing = scoreCandidate(route, requestedDuration, [], [], 'unavailable')
      const validation = {
        isPedestrian: true,
        loopMatchesStart: route.loopMatchesStart,
        durationDifferenceMinutes: timing.durationDifferenceMinutes,
        distanceKm: route.distanceKm,
        durationMinutes: timing.durationMinutes,
      }
      if (!validation.loopMatchesStart || validation.distanceKm <= 0.3 || !timing.acceptable) {
        continue
      }

      ranked.push({
        ...candidate,
        route,
        scenicEvidence: [],
        validation,
      })
    }

    if (ranked.length === 0) {
      return res.status(200).json({
        message: 'Valhalla did not return a loop close enough to the requested duration for this starting point.',
        fallback: true,
      })
    }

    const scenicLookup = await fetchScenicEvidence(ranked)
    for (const candidate of ranked) {
      candidate.scenicEvidence = scenicLookup.evidenceByRoute[candidate.id] || []
      const timing = scoreCandidate(
        candidate.route,
        requestedDuration,
        sceneryPreferences,
        candidate.scenicEvidence,
        scenicLookup.status,
      )
      candidate.score = timing.score
      candidate.validation = {
        ...candidate.validation,
        scenicEvidenceAvailable: candidate.scenicEvidence.length > 0,
        scenicEvidenceStatus: scenicLookup.status,
        matchedSceneryPreferences: timing.matchedPreferences,
        supportedSceneryPreferences: timing.supportedPreferences,
        unverifiedSceneryPreferences: timing.unsupportedPreferences,
      }
    }

    ranked.sort((a, b) => b.score - a.score)
    const selected = ranked[0]
    const aiSummary = await generateAiSummary({
      route: selected.route,
      locationLabel: origin.displayName,
      preferences: sceneryPreferences,
      mood: normalizedMood,
      targetDurationMinutes: requestedDuration,
      scenicEvidence: selected.scenicEvidence,
    })

    return res.json({
      ok: true,
      route: {
        id: selected.id,
        name: selected.name,
        routingEngine: 'Valhalla',
        costing: 'pedestrian',
        start: { lat: origin.lat, lon: origin.lon },
        waypoint: selected.waypoint,
        geometry: selected.route.geometry,
        distanceKm: round(selected.route.distanceKm, 2),
        durationMinutes: round(selected.route.durationSeconds / 60, 1),
        scenicEvidence: selected.scenicEvidence,
        scenicEvidenceStatus: scenicLookup.status,
        validation: selected.validation,
      },
      summary: {
        explanation: aiSummary.explanation,
        prompts: aiSummary.prompts,
        source: aiSummary.source,
        model: aiSummary.model,
      },
      scenicEvidenceStatus: scenicLookup.status,
      rankedCandidates: ranked.map(({ route, scenicEvidence, validation, score, name }) => ({
        name,
        score: round(score, 1),
        durationMinutes: round(route.durationSeconds / 60, 1),
        distanceKm: round(route.distanceKm, 2),
        scenicEvidence,
        validation,
      })),
    })
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Unable to generate a walking route right now.',
    })
  }
})

app.listen(port, () => {
  console.log(`Let’s Walk API running on http://localhost:${port}`)
})
