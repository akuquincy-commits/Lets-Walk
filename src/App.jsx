import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

const sceneryOptions = ['Greenery', 'Parks', 'Gardens', 'Water', 'Quiet streets']
const moods = ['Relaxed', 'Reflective', 'Curious']
const fallbackWalkingPrompts = ['Notice one small detail you might usually pass by.']
const sceneryKeys = {
  Greenery: 'greenery',
  Parks: 'parks',
  Gardens: 'gardens',
  Water: 'water',
  'Quiet streets': 'quiet',
}
const sceneryLabels = {
  greenery: 'Greenery',
  parks: 'Parks',
  gardens: 'Gardens',
  water: 'Water',
  quiet: 'Quiet streets',
}

function Brand({ compact = false }) {
  return (
    <Link className={`brand${compact ? ' brand-compact' : ''}`} to="/" aria-label="Let’s Walk home">
      <span className="brand-mark" aria-hidden="true">↗</span>
      <span>Let’s Walk</span>
    </Link>
  )
}

function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  return (
    <header className="site-header">
      <Brand />
      <button
        className="menu-toggle"
        type="button"
        aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span />
        <span />
      </button>
      <nav className={menuOpen ? 'site-nav is-open' : 'site-nav'} aria-label="Main navigation">
        <Link className={location.pathname === '/' ? 'nav-active' : ''} to="/" onClick={() => setMenuOpen(false)}>Plan a walk</Link>
        {location.pathname === '/route' && <a href="#route-details" onClick={() => setMenuOpen(false)}>Route details</a>}
        {location.pathname === '/walk' && <Link to="/route" onClick={() => setMenuOpen(false)}>Your walk</Link>}
      </nav>
    </header>
  )
}

function App() {
  const [form, setForm] = useState({
    location: '',
    coordinates: null,
    duration: 30,
    scenery: ['Greenery', 'Parks'],
    mood: 'Relaxed',
  })
  const [routeResult, setRouteResult] = useState(null)
  const [requestError, setRequestError] = useState('')
  const [prompts, setPrompts] = useState([])

  const toggleScenery = (option) => {
    setForm((current) => ({
      ...current,
      scenery: current.scenery.includes(option)
        ? current.scenery.filter((item) => item !== option)
        : [...current.scenery, option],
    }))
  }

  const setLocationFromBrowser = () => {
    setRequestError('')
    if (!navigator.geolocation) {
      setRequestError('Location access is not available in this browser. You can enter a place manually.')
      return
    }

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const query = new URLSearchParams({
            format: 'jsonv2',
            lat: String(coords.latitude),
            lon: String(coords.longitude),
          })
          const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${query}`)
          if (!response.ok) {
            throw new Error('The location name service is unavailable.')
          }
          const place = await response.json()
          const address = place.address || {}
          const label = address.city || address.town || address.village || address.suburb || place.display_name
          if (!label) {
            throw new Error('We could not find a place name for your current location.')
          }
          setForm((current) => ({
            ...current,
            location: label,
            coordinates: { lat: coords.latitude, lon: coords.longitude },
          }))
        } catch (error) {
          setRequestError(error.message || 'We could not find a place name for your current location. Enter a place manually.')
        }
      },
      () => setRequestError('We could not access your location. Enter a place manually or check your browser permission.'),
      { timeout: 10000 },
    )
  }

  const generateRoute = async (event, navigate) => {
    event.preventDefault()
    const trimmedLocation = form.location.trim()

    if (!trimmedLocation) {
      setRequestError('Please enter a starting location before planning your walk.')
      return
    }

    if (trimmedLocation.length < 2) {
      setRequestError('Please enter a more specific starting point so we can find a nearby walk.')
      return
    }

    setRequestError('')
    navigate('/finding')

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/plan-route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: trimmedLocation,
          originCoordinates: form.coordinates,
          duration: form.duration,
          scenery: form.scenery.map((item) => sceneryKeys[item]),
          mood: form.mood.toLowerCase(),
        }),
      })
      const data = await response.json()
      if (!response.ok || data.error) {
        throw new Error(data.error || 'We could not find a suitable walk for that starting point. Please try another location.')
      }
      if (data.fallback) {
        throw new Error(data.message || 'We could not find a walking loop that matched your timing and starting point. Try another area or use your current location.')
      }
      setRouteResult(data)
      setPrompts(Array.isArray(data.summary?.prompts) ? data.summary.prompts : [])
      navigate('/route')
    } catch (error) {
      setRequestError(error.message || 'We could not find a route for that location. Please try again.')
      navigate('/')
    }
  }

  return (
    <BrowserRouter>
      <div className="app-shell">
        <SiteHeader />
        <Routes>
          <Route
            path="/"
            element={
              <PlannerPage
                form={form}
                setForm={setForm}
                toggleScenery={toggleScenery}
                onLocate={setLocationFromBrowser}
                error={requestError}
                onSubmit={generateRoute}
              />
            }
          />
          <Route path="/finding" element={<FindingPage />} />
          <Route
            path="/route"
            element={routeResult
              ? <RoutePage result={routeResult} prompts={prompts} />
              : <Navigate to="/" replace />}
          />
          <Route
            path="/walk"
            element={routeResult
              ? (
                <WalkPage
                  prompts={prompts}
                  durationMinutes={routeResult.route.durationMinutes}
                  promptSource={routeResult.summary?.source}
                  promptModel={routeResult.summary?.model}
                />
              )
              : <Navigate to="/" replace />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

function PlannerPage({ form, setForm, toggleScenery, onLocate, error, onSubmit }) {
  const navigate = useNavigate()

  return (
    <main className="page planner-page">
      <section className="intro">
        <span className="eyebrow">A little more outside</span>
        <h1>Discover scenic<br className="desktop-break" /> walking routes</h1>
        <p>Tell us what kind of walk you need. We’ll look for a real pedestrian loop that fits your time and mood.</p>
      </section>

      <form className="planner-card" onSubmit={(event) => onSubmit(event, navigate)}>
        <fieldset className="form-section">
          <legend><span className="step-number">1</span> Your starting location</legend>
          <label className="sr-only" htmlFor="start-location">Enter a place or your current location</label>
          <input
            id="start-location"
            className="location-input"
            type="text"
            value={form.location}
            onChange={(event) => setForm((current) => ({
              ...current,
              location: event.target.value,
              coordinates: null,
            }))}
            placeholder="Enter a place or postcode"
            autoComplete="street-address"
            required
          />
          <button className="location-button" type="button" onClick={onLocate}>
            <span aria-hidden="true">⌖</span> Use my current location
          </button>
          <p className="field-note">Your location is only used to find a route for this request.</p>
        </fieldset>

        <fieldset className="form-section">
          <legend><span className="step-number">2</span> Walking duration</legend>
          <div className="choice-grid duration-options" role="group" aria-label="Walking duration">
            {[15, 30, 45].map((minutes) => (
              <button
                key={minutes}
                type="button"
                className={`choice-button${form.duration === minutes ? ' is-selected' : ''}`}
                aria-pressed={form.duration === minutes}
                onClick={() => setForm((current) => ({ ...current, duration: minutes }))}
              >
                {minutes} min
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend><span className="step-number">3</span> Scenery preferences</legend>
          <div className="choice-grid scenery-options">
            {sceneryOptions.map((option) => (
              <label className={`check-option${form.scenery.includes(option) ? ' is-checked' : ''}`} key={option}>
                <input
                  type="checkbox"
                  checked={form.scenery.includes(option)}
                  onChange={() => toggleScenery(option)}
                />
                <span className="custom-check" aria-hidden="true" />
                {option}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend><span className="step-number">4</span> Pick a mood</legend>
          <div className="choice-grid mood-options" role="group" aria-label="Walking mood">
            {moods.map((mood) => (
              <button
                key={mood}
                type="button"
                className={`choice-button${form.mood === mood ? ' is-selected' : ''}`}
                aria-pressed={form.mood === mood}
                onClick={() => setForm((current) => ({ ...current, mood }))}
              >
                {mood}
              </button>
            ))}
          </div>
        </fieldset>

        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={!form.location.trim()}>
          Find my walk <span aria-hidden="true">→</span>
        </button>
      </form>
      <p className="safety-note">Take care out there. Stay aware of traffic, your surroundings, and the weather.</p>
    </main>
  )
}

function FindingPage() {
  return (
    <main className="page status-page" aria-live="polite">
      <div className="search-illustration" aria-hidden="true">
        <span className="search-pin">⌕</span>
        <span className="search-hill" />
      </div>
      <span className="eyebrow">One moment</span>
      <h1>Finding your next walk</h1>
      <p>We’re checking for a real pedestrian loop that fits your preferences.</p>
      <ol className="progress-list">
        <li className="complete"><span>✓</span> Checking local walking routes</li>
        <li className="complete"><span>✓</span> Looking for suitable route features</li>
        <li className="active"><span>◌</span> Finding the best fit</li>
        <li><span>○</span> Preparing your walk</li>
      </ol>
      <p className="honesty-note">We only show routes that are returned by the routing service. If none fit, we’ll let you know.</p>
    </main>
  )
}

function getPromptSourceLabel(source, model) {
  if (source === 'ollama') {
    return `Walking prompts generated by ${model || 'Gemma via Ollama'}`
  }

  return 'Using fallback prompts because Gemma via Ollama did not return valid prompts.'
}

function RoutePage({ result, prompts }) {
  const route = result.route
  const geometry = Array.isArray(route.geometry) ? route.geometry : []
  const scenicEvidence = Array.isArray(route.scenicEvidence) ? route.scenicEvidence : []
  const validation = route.validation || {}
  const matchedSceneryPreferences = Array.isArray(validation.matchedSceneryPreferences)
    ? validation.matchedSceneryPreferences
    : []
  const supportedSceneryPreferences = Array.isArray(validation.supportedSceneryPreferences)
    ? validation.supportedSceneryPreferences
    : []
  const unmatchedSceneryPreferences = supportedSceneryPreferences
    .filter((key) => !matchedSceneryPreferences.includes(key))
  const center = geometry[0] || [route.start.lat, route.start.lon]
  const navigate = useNavigate()
  const sceneryStatusMessage = route.scenicEvidenceStatus === 'unavailable'
    ? 'We could not check the nearby map data for parks, gardens, greenery, or water on this route.'
    : route.scenicEvidenceStatus === 'no_features'
      ? 'We looked for parks, gardens, greenery, and water near this route, but nothing matching those categories was mapped close by.'
      : 'We checked the nearby map data and did not find parks, gardens, greenery, or water close to this route.'

  return (
    <main className="page route-page" id="route-details">
      <div className="route-title-row">
        <div>
          <span className="eyebrow">Your walk</span>
          <h1>{route.name}</h1>
          <p className="route-subtitle">
            Calculated by {route.routingEngine || 'Valhalla'} using pedestrian routing.
            {scenicEvidence.length ? ' We found nearby map features that match the route area.' : ' We did not find any nearby parks, gardens, greenery, or water features in the map data we checked.'}
          </p>
        </div>
        <button className="text-button" type="button" onClick={() => navigate('/')}>Edit preferences</button>
      </div>
      <section className="route-map-card" aria-label="Interactive route map">
        {geometry.length > 1 ? (
          <MapContainer key={route.id} center={center} zoom={15} scrollWheelZoom className="route-map">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Polyline positions={geometry} pathOptions={{ color: '#16735b', weight: 5 }} />
            <Circle center={center} radius={30} pathOptions={{ color: '#16735b', fillColor: '#3da27f', fillOpacity: 0.45 }} />
            <Marker position={center}><Popup>Route start</Popup></Marker>
            {scenicEvidence.map((feature) => (
              <Marker key={feature.id} position={[feature.latitude, feature.longitude]}>
                <Popup>
                  <strong>{feature.name}</strong>
                  <br />
                  Mapped point about {feature.distanceMeters} m from the route
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        ) : (
          <div className="map-unavailable">Route map data was not returned.</div>
        )}
        <div className="map-legend"><span /> Route preview</div>
      </section>

      <div className="route-metrics">
        <Metric icon="↔" value={`${route.distanceKm} km`} label="Distance" />
        <Metric icon="◷" value={`${route.durationMinutes} min`} label="Estimated time" />
        <Metric icon="⌁" value={route.validation?.loopMatchesStart ? 'Loop' : 'Route'} label="Route type" />
      </div>

      <section className="route-card explanation-card">
        <span className="card-icon" aria-hidden="true">✳</span>
        <div>
          <h2>Why this walk fits</h2>
          <p>{result.summary?.explanation || 'No route explanation was provided.'}</p>
        </div>
      </section>
      <section className="route-card evidence-card">
        <h2>Nearby scenery evidence</h2>
        <p className="evidence-disclaimer">
          These are nearby map features, not proof that the route passes through them. We list them as nearby points only, and the distance is measured from the route to each mapped feature.
        </p>
        {scenicEvidence.length > 0
          ? (
            <ul className="evidence-list">
              {scenicEvidence.map((feature) => (
                <li key={feature.id}>
                  <span aria-hidden="true">✓</span>
                  <div>
                    <a href={feature.url} target="_blank" rel="noreferrer">{feature.name}</a>
                    <small>
                      {feature.categories.map((category) => sceneryLabels[category] || category).join(', ')}
                      {' · '}
                      {feature.distanceMeters} m from route
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )
          : <p>{sceneryStatusMessage}</p>}
        {route.scenicEvidenceStatus === 'available' && matchedSceneryPreferences.length > 0 && (
          <p className="evidence-status">
            Mapped evidence matches: {matchedSceneryPreferences.map((key) => sceneryLabels[key] || key).join(', ')}.
          </p>
        )}
        {route.scenicEvidenceStatus === 'available' && unmatchedSceneryPreferences.length > 0 && (
          <p className="evidence-status">
            No nearby mapped match found for: {unmatchedSceneryPreferences
              .map((key) => sceneryLabels[key] || key)
              .join(', ')}.
          </p>
        )}
        {validation.unverifiedSceneryPreferences?.length > 0 && (
          <p className="evidence-status">
            Not verified by this lookup: {validation.unverifiedSceneryPreferences
              .map((key) => sceneryLabels[key] || key)
              .join(', ')}.
          </p>
        )}
      </section>
      {prompts.length > 0 && (
        <section className="route-card prompts-card">
          <h2>Prompts for the path</h2>
          <p className="prompt-origin">{getPromptSourceLabel(result.summary?.source, result.summary?.model)}</p>
          <ol>{prompts.slice(0, 3).map((prompt, index) => <li key={`${index}-${prompt}`}>{prompt}</li>)}</ol>
        </section>
      )}
      <p className="safety-note">Keep your phone away while walking, and stay aware of traffic, your surroundings, and the weather.</p>
      <button className="primary-button start-button" type="button" onClick={() => navigate('/walk')}>
        Start my walk <span aria-hidden="true">→</span>
      </button>
    </main>
  )
}

function Metric({ icon, value, label }) {
  return (
    <div className="metric">
      <span className="metric-icon" aria-hidden="true">{icon}</span>
      <span className="metric-copy"><strong>{value}</strong><small>{label}</small></span>
    </div>
  )
}

function WalkPage({ prompts, durationMinutes, promptSource, promptModel }) {
  const navigate = useNavigate()
  const [currentPrompt, setCurrentPrompt] = useState(0)
  const [intervalMinutes, setIntervalMinutes] = useState(5)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [isWalking, setIsWalking] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [walkComplete, setWalkComplete] = useState(false)
  const [speechMessage, setSpeechMessage] = useState('')
  const [spokenPromptIndex, setSpokenPromptIndex] = useState(-1)
  const [nextReminderAtSeconds, setNextReminderAtSeconds] = useState(null)
  const visiblePrompts = prompts.length ? prompts : fallbackWalkingPrompts
  const totalDurationSeconds = Number.isFinite(Number(durationMinutes)) && Number(durationMinutes) > 0
    ? Math.round(Number(durationMinutes) * 60)
    : 0
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
  const elapsedBeforeStart = useRef(0)
  const startedAt = useRef(0)
  const nextReminderAt = useRef(null)
  const lastPromptIndex = useRef(0)
  const completionHandled = useRef(false)

  const speak = useCallback((text) => {
    if (!supported) {
      setSpeechMessage('Spoken prompts are not supported by this browser. The prompts will still appear here.')
      return false
    }

    window.speechSynthesis.cancel()
    const utterance = new window.SpeechSynthesisUtterance(text)
    utterance.rate = 0.9
    utterance.onerror = (event) => {
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        setSpeechMessage('Your device could not read the prompt aloud. Check its speech settings.')
      }
    }
    window.speechSynthesis.speak(utterance)
    const matchingPromptIndex = visiblePrompts.indexOf(text)
    if (matchingPromptIndex >= 0) {
      setSpokenPromptIndex(matchingPromptIndex)
    }
    setSpeechMessage('')
    return true
  }, [supported, visiblePrompts])

  useEffect(() => {
    if (!isWalking) {
      return undefined
    }

    const timer = window.setInterval(() => {
      const elapsed = Math.min(
        totalDurationSeconds,
        elapsedBeforeStart.current + Math.floor((Date.now() - startedAt.current) / 1000),
      )
      setElapsedSeconds(elapsed)

      if (elapsed >= totalDurationSeconds) {
        if (completionHandled.current) {
          return
        }

        completionHandled.current = true
        elapsedBeforeStart.current = totalDurationSeconds
        setIsWalking(false)
        setWalkComplete(true)
        if (supported) {
          window.speechSynthesis.cancel()
        }
        speak('Your planned walk time is complete. Stay aware of your surroundings as you finish your walk.')
        return
      }

      if (nextReminderAt.current !== null && elapsed >= nextReminderAt.current) {
        const promptIndex = (lastPromptIndex.current + 1) % visiblePrompts.length
        lastPromptIndex.current = promptIndex
        const nextReminder = elapsed + intervalMinutes * 60
        nextReminderAt.current = nextReminder
        setNextReminderAtSeconds(nextReminder)
        setCurrentPrompt(promptIndex)
        speak(visiblePrompts[promptIndex])
      }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [intervalMinutes, isWalking, speak, supported, totalDurationSeconds, visiblePrompts])

  useEffect(() => () => {
    if (supported) {
      window.speechSynthesis.cancel()
    }
  }, [supported])

  const startWalk = () => {
    if (!supported) {
      setSpeechMessage('Spoken prompts are not supported by this browser. You can still use the on-screen prompts.')
    }
    if (!hasStarted) {
      lastPromptIndex.current = currentPrompt
      const nextReminder = elapsedBeforeStart.current + intervalMinutes * 60
      nextReminderAt.current = nextReminder
      setNextReminderAtSeconds(nextReminder)
      completionHandled.current = false
      if (supported) {
        speak(visiblePrompts[currentPrompt])
      }
    } else if (nextReminderAt.current === null) {
      const nextReminder = elapsedBeforeStart.current + intervalMinutes * 60
      nextReminderAt.current = nextReminder
      setNextReminderAtSeconds(nextReminder)
    }
    startedAt.current = Date.now()
    setIsWalking(true)
    setHasStarted(true)
    setWalkComplete(false)
  }

  const pauseWalk = () => {
    const elapsed = Math.min(
      totalDurationSeconds,
      elapsedBeforeStart.current + Math.floor((Date.now() - startedAt.current) / 1000),
    )
    elapsedBeforeStart.current = elapsed
    setElapsedSeconds(elapsed)
    setIsWalking(false)
    if (supported) {
      window.speechSynthesis.cancel()
    }
  }

  const finishWalk = () => {
    pauseWalk()
    setWalkComplete(true)
    if (supported) {
      window.speechSynthesis.cancel()
    }
    navigate('/route')
  }

  const movePrompt = (direction) => {
    const nextIndex = (currentPrompt + direction + visiblePrompts.length) % visiblePrompts.length
    setCurrentPrompt(nextIndex)
    setSpokenPromptIndex(-1)
    lastPromptIndex.current = nextIndex
  }

  const changeInterval = (minutes) => {
    setIntervalMinutes(minutes)

    if (hasStarted && !walkComplete) {
      const nextReminder = elapsedSeconds + minutes * 60
      nextReminderAt.current = nextReminder
      setNextReminderAtSeconds(nextReminder)
    }
  }

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
  }

  const nextReminderSeconds = nextReminderAtSeconds === null
    ? intervalMinutes * 60
    : Math.max(0, nextReminderAtSeconds - elapsedSeconds)
  const nextReminderMessage = walkComplete
    ? 'All scheduled prompts are complete.'
    : nextReminderAtSeconds !== null && nextReminderAtSeconds >= totalDurationSeconds
      ? 'No more reminders are scheduled before the planned walk ends.'
      : hasStarted
        ? `Next prompt in ${formatTime(nextReminderSeconds)}.`
        : `Your first prompt plays when you start; then every ${intervalMinutes} minutes.`

  return (
    <main className="page walking-page">
      <div className="walking-topline">
        <button className="text-button" type="button" onClick={() => navigate('/route')}>← Route details</button>
        <span className="walking-label">WALKING MODE</span>
        <button className="text-button" type="button" onClick={finishWalk}>Finish</button>
      </div>
      <div className="walking-content">
        <div className="walker-icon" aria-hidden="true">♟</div>
        <span className="eyebrow">Take it at your own pace</span>
        <h1>{walkComplete ? 'Walk time complete' : isWalking ? 'Keep going!' : hasStarted ? 'Walk paused' : 'Ready when you are'}</h1>
        <p className="walking-subtitle">
          {walkComplete
            ? 'Your planned walk time is up. Finish safely at your own pace.'
            : isWalking
              ? 'Prompts will be read aloud at your selected interval.'
              : hasStarted
                ? 'Your timer is paused. Resume whenever you’re ready.'
                : 'Choose how often you’d like to hear a prompt, then start your walk.'}
        </p>
        <section className="speech-settings" aria-label="Spoken prompt settings">
          <span className="settings-label">Read a prompt every</span>
          <div className="interval-options" role="group" aria-label="Prompt interval">
            {[5, 10, 15].map((minutes) => (
              <button
                key={minutes}
                className={`choice-button${intervalMinutes === minutes ? ' is-selected' : ''}`}
                type="button"
                aria-pressed={intervalMinutes === minutes}
                disabled={walkComplete || !totalDurationSeconds}
                onClick={() => changeInterval(minutes)}
              >
                {minutes} min
              </button>
            ))}
          </div>
          <span className="walk-clock" role="timer" aria-live="off">
            {formatTime(elapsedSeconds)}{totalDurationSeconds ? ` / ${formatTime(totalDurationSeconds)}` : ''}
          </span>
          {!totalDurationSeconds && (
            <span className="settings-help">A route duration is not available, so the walk timer cannot start.</span>
          )}
          {totalDurationSeconds > 0 && (
            <span className="settings-help" aria-live="polite">{nextReminderMessage}</span>
          )}
        </section>
        <section className="current-prompt" aria-live="polite">
          <h2><span aria-hidden="true">▣</span> Current prompt</h2>
          <p><span className="prompt-number">{currentPrompt + 1}</span>{visiblePrompts[currentPrompt]}</p>
        </section>
        {supported && (
          <p className="spoken-status" role="status" aria-live="polite">
            {spokenPromptIndex === currentPrompt ? 'This prompt has been read aloud.' : 'This prompt has not been read aloud yet.'}
          </p>
        )}
        <p className="prompt-origin walking-prompt-origin">
          {getPromptSourceLabel(promptSource, promptModel)}
        </p>
        {speechMessage && <p className="speech-message" role="status">{speechMessage}</p>}
        <div className="walk-controls">
          {!isWalking && !walkComplete && (
            <button className="primary-button" type="button" onClick={startWalk} disabled={!totalDurationSeconds}>
              {hasStarted ? 'Resume walk' : supported ? 'Start walk & audio prompts' : 'Start walk'} <span aria-hidden="true">▶</span>
            </button>
          )}
          {isWalking && (
            <button className="primary-button" type="button" onClick={pauseWalk}>
              Pause walk <span aria-hidden="true">Ⅱ</span>
            </button>
          )}
          {!isWalking && !walkComplete && (
            <button className="text-button audio-test-button" type="button" onClick={() => speak(visiblePrompts[currentPrompt])}>
              Test spoken prompt
            </button>
          )}
          {walkComplete && (
            <button className="primary-button" type="button" onClick={() => navigate('/route')}>
              Return to route details <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
        <div className="prompt-navigation">
          <button className="text-button" type="button" disabled={isWalking} onClick={() => movePrompt(-1)}>← Previous</button>
          <span>{currentPrompt + 1} / {visiblePrompts.length}</span>
          <button className="text-button" type="button" disabled={isWalking} onClick={() => movePrompt(1)}>Next →</button>
        </div>
        <p className="walking-reminder">
          Stay aware of traffic and your surroundings. Some browsers may pause speech when the screen is locked; test audio before setting off.
        </p>
      </div>
    </main>
  )
}

export default App
