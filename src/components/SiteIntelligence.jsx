import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const BENGALURU = [12.9716, 77.5946]

const STREET_TILES =
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

const SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

function normalizeResult(item, source = 'Search') {
  const lat = Number(item.lat ?? item.location?.y)
  const lng = Number(item.lon ?? item.lng ?? item.location?.x)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  return {
    lat,
    lng,
    name:
      item.display_name ||
      item.address ||
      item.label ||
      item.name ||
      'Selected location',
    source,
  }
}

async function searchNominatim(query) {
  const url =
    'https://nominatim.openstreetmap.org/search?' +
    new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '8',
      countrycodes: 'in',
    })

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) throw new Error('Nominatim search failed')

  const data = await response.json()

  return data
    .map((item) => normalizeResult(item, 'OpenStreetMap'))
    .filter(Boolean)
}

async function searchArcGIS(query) {
  const url =
    'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?' +
    new URLSearchParams({
      SingleLine: query,
      f: 'json',
      outFields: '*',
      maxLocations: '8',
      countryCode: 'IND',
    })

  const response = await fetch(url)

  if (!response.ok) throw new Error('ArcGIS search failed')

  const data = await response.json()

  return (data.candidates || [])
    .map((item) =>
      normalizeResult(
        {
          lat: item.location?.y,
          lon: item.location?.x,
          address: item.address,
        },
        'ArcGIS'
      )
    )
    .filter(Boolean)
}

async function searchPhoton(query) {
  const url =
    'https://photon.komoot.io/api/?' +
    new URLSearchParams({
      q: query,
      limit: '8',
      lang: 'en',
    })

  const response = await fetch(url)

  if (!response.ok) throw new Error('Photon search failed')

  const data = await response.json()

  return (data.features || [])
    .map((feature) =>
      normalizeResult(
        {
          lat: feature.geometry?.coordinates?.[1],
          lon: feature.geometry?.coordinates?.[0],
          display_name: [
            feature.properties?.name,
            feature.properties?.street,
            feature.properties?.district,
            feature.properties?.city,
            feature.properties?.state,
          ]
            .filter(Boolean)
            .join(', '),
        },
        'Photon'
      )
    )
    .filter(Boolean)
}

function uniqueResults(results) {
  const seen = new Set()

  return results.filter((item) => {
    const key = `${item.lat.toFixed(6)},${item.lng.toFixed(6)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '—'
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function getHighwayWidthFt(tags = {}) {
  const explicit = Number(tags.width)

  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.round(explicit * 3.28084)
  }

  const lanes = Number(tags.lanes)

  const defaults = {
    motorway: 80,
    trunk: 60,
    primary: 50,
    secondary: 40,
    tertiary: 30,
    residential: 25,
    unclassified: 20,
    service: 15,
    living_street: 15,
  }

  const base = defaults[tags.highway] || 20

  if (Number.isFinite(lanes) && lanes >= 2) {
    return Math.round(base * Math.min(lanes / 2, 1.5))
  }

  return base
}

function classifyRoad(tags = {}) {
  const names = {
    motorway: 'Motorway',
    trunk: 'Trunk road',
    primary: 'Primary road',
    secondary: 'Secondary road',
    tertiary: 'Tertiary road',
    residential: 'Residential road',
    unclassified: 'Local road',
    service: 'Service road',
    living_street: 'Living street',
  }

  return names[tags.highway] || 'Road'
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2

  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}


function nearestFeature(elements, predicate, lat, lng) {
  return elements
    .filter(predicate)
    .map((item) => {
      const itemLat = item.center?.lat ?? item.lat
      const itemLng = item.center?.lon ?? item.lon
      return {
        id: item.id,
        name:
          item.tags?.name ||
          item.tags?.operator ||
          item.tags?.designation ||
          'Mapped feature',
        type:
          item.tags?.aeroway ||
          item.tags?.power ||
          item.tags?.military ||
          item.tags?.historic ||
          item.tags?.boundary ||
          item.tags?.leisure ||
          item.tags?.natural ||
          item.tags?.landuse ||
          'feature',
        distance:
          Number.isFinite(itemLat) && Number.isFinite(itemLng)
            ? distanceMeters(lat, lng, itemLat, itemLng)
            : Infinity,
        lat: itemLat,
        lng: itemLng,
      }
    })
    .sort((a, b) => a.distance - b.distance)[0] || null
}


async function queryOverpass(lat, lng) {
  const query = `
[out:json][timeout:30];
(
  way(around:700,${lat},${lng})["highway"];
  way(around:1500,${lat},${lng})["highway"="construction"];
  way(around:1500,${lat},${lng})["highway"="proposed"];
  way(around:1200,${lat},${lng})["waterway"];
  way(around:1500,${lat},${lng})["natural"="water"];
  way(around:1500,${lat},${lng})["landuse"="reservoir"];
  way(around:1500,${lat},${lng})["railway"];
  relation(around:1500,${lat},${lng})["railway"];
  node(around:1500,${lat},${lng})["railway"];
  node(around:1500,${lat},${lng})["station"];

  way(around:3000,${lat},${lng})["aeroway"];
  node(around:3000,${lat},${lng})["aeroway"];
  way(around:1500,${lat},${lng})["power"="line"];
  way(around:1500,${lat},${lng})["power"="minor_line"];
  way(around:1500,${lat},${lng})["power"="cable"];
  way(around:1500,${lat},${lng})["military"];
  relation(around:1500,${lat},${lng})["military"];
  way(around:1500,${lat},${lng})["historic"];
  node(around:1500,${lat},${lng})["historic"];
  way(around:1500,${lat},${lng})["boundary"="protected_area"];
  relation(around:1500,${lat},${lng})["boundary"="protected_area"];
  way(around:1500,${lat},${lng})["leisure"="nature_reserve"];
  relation(around:1500,${lat},${lng})["leisure"="nature_reserve"];
  way(around:1500,${lat},${lng})["natural"="wetland"];
  way(around:1500,${lat},${lng})["natural"="wood"];
  way(around:1500,${lat},${lng})["landuse"="forest"];
  way(around:1500,${lat},${lng})["landuse"];
  relation(around:1500,${lat},${lng})["landuse"];
  node(around:300,${lat},${lng})["natural"="tree"];
);
out center tags;
`

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ]

  let lastError = null

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
        },
        body: query,
      })

      if (!response.ok) throw new Error('Overpass request failed')

      return await response.json()
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('Nearby feature search failed')
}

export default function SiteIntelligence() {
  const mapRef = useRef(null)
  const mapContainerRef = useRef(null)
  const tileLayerRef = useRef(null)
  const locationMarkerRef = useRef(null)
  const contextLayerRef = useRef(null)

  const [tileType, setTileType] = useState('street')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [searchError, setSearchError] = useState('')
  const [selectedLocation, setSelectedLocation] = useState(null)

  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState('')

  const [locating, setLocating] = useState(false)

  const [mapReady, setMapReady] = useState(false)

  const tileAttribution =
    tileType === 'street'
      ? '&copy; OpenStreetMap contributors'
      : '&copy; Esri, Maxar, Earthstar Geographics'

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = L.map(mapContainerRef.current, {
      center: BENGALURU,
      zoom: 12,
      zoomControl: true,
      attributionControl: true,
    })

    mapRef.current = map

    tileLayerRef.current = L.tileLayer(
      STREET_TILES,
      {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }
    ).addTo(map)

    contextLayerRef.current = L.layerGroup().addTo(map)

    setMapReady(true)

    const resize = () => map.invalidateSize()

    setTimeout(resize, 100)
    setTimeout(resize, 400)

    return () => {
      map.remove()
      mapRef.current = null
      tileLayerRef.current = null
      contextLayerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!mapRef.current || !tileLayerRef.current) return

    const nextTiles =
      tileType === 'street'
        ? STREET_TILES
        : SATELLITE_TILES

    tileLayerRef.current.setUrl(nextTiles)

    tileLayerRef.current.options.attribution =
      tileAttribution
  }, [tileType, tileAttribution])

  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize()
    }, 150)

    return () => clearTimeout(timer)
  }, [mapReady])

  const selectLocation = async (location) => {
    const map = mapRef.current
    if (!map) return

    const lat = Number(location.lat)
    const lng = Number(location.lng)

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

    setSelectedLocation(location)
    setSearchResults([])
    setSearchError('')
    setAnalysis(null)
    setAnalysisError('')
    setAnalyzing(true)

    map.flyTo([lat, lng], 18, {
      duration: 1.2,
    })

    if (locationMarkerRef.current) {
      locationMarkerRef.current.remove()
    }

    const marker = L.marker([lat, lng], {
      riseOnHover: true,
      autoPan: true,
    }).addTo(map)

    marker
      .bindPopup(
        `<strong>${String(location.name).replace(
          /</g,
          '&lt;'
        )}</strong><br/>Selected site location`
      )
      .openPopup()

    locationMarkerRef.current = marker

    try {
      const data = await queryOverpass(lat, lng)
      const elements = data.elements || []

      const roads = elements
        .filter((item) => item.tags?.highway)
        .map((item) => {
          const center = item.center
          const itemLat = center?.lat
          const itemLng = center?.lon

          const distance =
            Number.isFinite(itemLat) &&
            Number.isFinite(itemLng)
              ? distanceMeters(
                  lat,
                  lng,
                  itemLat,
                  itemLng
                )
              : Infinity

          return {
            id: item.id,
            name:
              item.tags?.name ||
              classifyRoad(item.tags),
            type: classifyRoad(item.tags),
            widthFt: getHighwayWidthFt(item.tags),
            distance,
            lat: itemLat,
            lng: itemLng,
          }
        })
        .sort((a, b) => a.distance - b.distance)

      const proposedRoads = elements
        .filter(
          (item) =>
            item.tags?.highway === 'construction' ||
            item.tags?.highway === 'proposed'
        )
        .map((item) => ({
          id: item.id,
          name: item.tags?.name || 'Proposed / construction road',
          type: item.tags?.highway,
          distance: Number.isFinite(item.center?.lat)
            ? distanceMeters(
                lat,
                lng,
                item.center.lat,
                item.center.lon
              )
            : Infinity,
        }))
        .sort((a, b) => a.distance - b.distance)

      const landuseFeatures = elements
        .filter((item) => item.tags?.landuse)
        .map((item) => ({
          id: item.id,
          name: item.tags?.name || item.tags?.landuse,
          type: item.tags?.landuse,
          distance: Number.isFinite(item.center?.lat)
            ? distanceMeters(
                lat,
                lng,
                item.center.lat,
                item.center.lon
              )
            : Infinity,
        }))
        .sort((a, b) => a.distance - b.distance)

      const treeFeatures = elements.filter(
        (item) => item.tags?.natural === 'tree'
      )

      const water = elements
        .filter(
          (item) =>
            item.tags?.waterway ||
            item.tags?.natural === 'water' ||
            item.tags?.landuse === 'reservoir'
        )
        .map((item) => ({
          id: item.id,
          name:
            item.tags?.name ||
            (item.tags?.waterway
              ? 'Drain / waterway'
              : 'Water body'),
          type:
            item.tags?.waterway ||
            item.tags?.natural ||
            item.tags?.landuse ||
            'water',
          distance: Number.isFinite(item.center?.lat)
            ? distanceMeters(
                lat,
                lng,
                item.center.lat,
                item.center.lon
              )
            : Infinity,
        }))
        .sort((a, b) => a.distance - b.distance)

      const rail = elements
        .filter(
          (item) =>
            item.tags?.railway ||
            item.tags?.station
        )
        .map((item) => ({
          id: item.id,
          name:
            item.tags?.name ||
            (item.tags?.station
              ? 'Rail / Metro station'
              : 'Railway corridor'),
          type:
            item.tags?.railway ||
            item.tags?.station ||
            'railway',
          distance: Number.isFinite(item.center?.lat)
            ? distanceMeters(
                lat,
                lng,
                item.center.lat,
                item.center.lon
              )
            : Infinity,
        }))
        .sort((a, b) => a.distance - b.distance)

      const nearestRoad = roads[0] || null
      const nearestWater = water[0] || null
      const nearestRail = rail[0] || null
      const nearestProposedRoad = proposedRoads[0] || null
      const nearestLanduse = landuseFeatures[0] || null

      const nearestAirport = nearestFeature(
        elements,
        (item) => item.tags?.aeroway,
        lat,
        lng
      )
      const nearestPower = nearestFeature(
        elements,
        (item) =>
          item.tags?.power === 'line' ||
          item.tags?.power === 'minor_line' ||
          item.tags?.power === 'cable',
        lat,
        lng
      )
      const nearestMilitary = nearestFeature(
        elements,
        (item) => item.tags?.military,
        lat,
        lng
      )
      const nearestHeritage = nearestFeature(
        elements,
        (item) => item.tags?.historic,
        lat,
        lng
      )
      const nearestProtected = nearestFeature(
        elements,
        (item) =>
          item.tags?.boundary === 'protected_area' ||
          item.tags?.leisure === 'nature_reserve',
        lat,
        lng
      )
      const nearestEco = nearestFeature(
        elements,
        (item) =>
          item.tags?.natural === 'wetland' ||
          item.tags?.natural === 'wood' ||
          item.tags?.landuse === 'forest',
        lat,
        lng
      )

      const waterConcern =
        nearestWater && nearestWater.distance <= 100

      const railConcern =
        nearestRail && nearestRail.distance <= 100

      const roadConcern =
        nearestRoad && nearestRoad.widthFt < 30

      const proposedRoadConcern =
        nearestProposedRoad && nearestProposedRoad.distance <= 300

      const powerConcern =
        nearestPower && nearestPower.distance <= 50

      const airportConcern =
        nearestAirport && nearestAirport.distance <= 3000

      const militaryConcern =
        nearestMilitary && nearestMilitary.distance <= 500

      const heritageConcern =
        nearestHeritage && nearestHeritage.distance <= 100

      const protectedConcern =
        nearestProtected && nearestProtected.distance <= 500

      const ecoConcern =
        nearestEco && nearestEco.distance <= 300

      setAnalysis({
        roads,
        water,
        rail,
        nearestRoad,
        nearestWater,
        nearestRail,
        nearestProposedRoad,
        nearestLanduse,
        treeCount: treeFeatures.length,
        waterConcern,
        railConcern,
        roadWidthFt:
          nearestRoad?.widthFt || null,
        nearestAirport,
        nearestPower,
        nearestMilitary,
        nearestHeritage,
        nearestProtected,
        nearestEco,
        roadConcern,
        proposedRoadConcern,
        powerConcern,
        airportConcern,
        militaryConcern,
        heritageConcern,
        protectedConcern,
        ecoConcern,
        fetchedAt: new Date().toISOString(),
      })

      if (contextLayerRef.current) {
        contextLayerRef.current.clearLayers()

        roads.slice(0, 12).forEach((road) => {
          if (!Number.isFinite(road.lat)) return

          L.circleMarker([road.lat, road.lng], {
            radius: road === nearestRoad ? 7 : 4,
            weight: 2,
            fillOpacity: 0.7,
          })
            .bindTooltip(
              `${road.name} · ~${road.widthFt} ft`,
              { direction: 'top' }
            )
            .addTo(contextLayerRef.current)
        })

        water.slice(0, 8).forEach((item) => {
          const element = elements.find(
            (candidate) =>
              candidate.id === item.id
          )

          if (!element?.geometry?.length) return

          const latLngs = element.geometry
            .map((point) => [
              point.lat,
              point.lon,
            ])
            .filter(
              (point) =>
                Number.isFinite(point[0]) &&
                Number.isFinite(point[1])
            )

          if (latLngs.length >= 2) {
            L.polyline(latLngs, {
              weight: 4,
              opacity: 0.75,
            })
              .bindTooltip(item.name)
              .addTo(contextLayerRef.current)
          }
        })
      }
    } catch {
      setAnalysisError(
        'The site was located, but nearby GIS features could not be loaded right now.'
      )
      setAnalysis({
        roads: [],
        water: [],
        rail: [],
        nearestRoad: null,
        nearestWater: null,
        nearestRail: null,
        nearestProposedRoad: null,
        nearestLanduse: null,
        treeCount: 0,
        waterConcern: false,
        railConcern: false,
        roadWidthFt: null,
        nearestAirport: null,
        nearestPower: null,
        nearestMilitary: null,
        nearestHeritage: null,
        nearestProtected: null,
        nearestEco: null,
        roadConcern: false,
        proposedRoadConcern: false,
        powerConcern: false,
        airportConcern: false,
        militaryConcern: false,
        heritageConcern: false,
        protectedConcern: false,
        ecoConcern: false,
      })
    } finally {
      setAnalyzing(false)
    }
  }

  const performSearch = async () => {
    const clean = query.trim()

    if (!clean || searching) return

    setSearching(true)
    setSearchError('')
    setSearchResults([])

    const queries = [
      clean,
      `${clean}, Bengaluru, Karnataka, India`,
      `${clean}, Bangalore, Karnataka, India`,
    ]

    let results = []

    for (const q of queries) {
      try {
        results = await searchNominatim(q)
        if (results.length) break
      } catch {
        // Continue to the next provider/query.
      }
    }

    if (!results.length) {
      try {
        results = await searchArcGIS(
          `${clean}, Bengaluru, Karnataka, India`
        )
      } catch {
        // Continue.
      }
    }

    if (!results.length) {
      try {
        results = await searchPhoton(
          `${clean}, Bengaluru, Karnataka, India`
        )
      } catch {
        // Continue.
      }
    }

    results = uniqueResults(results)

    if (!results.length) {
      setSearchError(
        'Could not locate that place. Try the apartment name + locality, for example “AKR Comforts Arekere”, or add Bengaluru.'
      )
      setSearching(false)
      return
    }

    setSearchResults(results)

    // Automatically locate the first result, like Site Analysis.
    await selectLocation(results[0])

    setSearching(false)
  }

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setSearchError(
        'Your browser does not provide location access.'
      )
      return
    }

    setLocating(true)
    setSearchError('')

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          name: 'Current device location',
          source: 'Browser',
        }

        await selectLocation(location)
        setLocating(false)
      },
      () => {
        setSearchError(
          'Could not access your current location. Please allow location permission or search the address manually.'
        )
        setLocating(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000,
      }
    )
  }

  const resetMap = () => {
    if (!mapRef.current) return

    mapRef.current.flyTo(BENGALURU, 12, {
      duration: 1,
    })

    if (locationMarkerRef.current) {
      locationMarkerRef.current.remove()
      locationMarkerRef.current = null
    }

    contextLayerRef.current?.clearLayers()

    setQuery('')
    setSearchResults([])
    setSearchError('')
    setSelectedLocation(null)
    setAnalysis(null)
    setAnalysisError('')
  }

  const roadLabel = useMemo(() => {
    if (!analysis?.nearestRoad) return 'Not detected'
    return analysis.nearestRoad.name
  }, [analysis])

  return (
    <div className="site-intelligence-shell">
      <div className="site-intelligence-workspace">
        <div className="site-intelligence-map-card">
          <div className="site-intelligence-map-header">
            <div>
              <div className="site-intelligence-eyebrow">
                GIS SITE CONTEXT
              </div>

              <h2>Locate & inspect your property</h2>

              <p>
                Search an apartment, property, road or
                locality. The map will move directly to
                the result and inspect the surrounding
                physical context.
              </p>
            </div>

            <div className="site-intelligence-map-actions">
              <button
                className={`si-mode-button ${
                  tileType === 'street'
                    ? 'active'
                    : ''
                }`}
                onClick={() =>
                  setTileType('street')
                }
              >
                🗺️ Street
              </button>

              <button
                className={`si-mode-button ${
                  tileType === 'satellite'
                    ? 'active'
                    : ''
                }`}
                onClick={() =>
                  setTileType('satellite')
                }
              >
                🛰️ Satellite
              </button>

              <button
                className="si-secondary-button"
                onClick={useCurrentLocation}
                disabled={locating}
              >
                {locating
                  ? 'Locating…'
                  : '📍 Locate Me'}
              </button>

              <button
                className="si-secondary-button"
                onClick={resetMap}
              >
                Reset
              </button>
            </div>
          </div>

          <div className="site-intelligence-search">
            <div className="site-intelligence-search-box">
              <span>⌕</span>

              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setSearchError('')
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    performSearch()
                  }
                }}
                placeholder="Search property, apartment, road or locality — e.g. AKR Comforts Arekere"
              />

              {query && (
                <button
                  className="si-clear-search"
                  onClick={() => {
                    setQuery('')
                    setSearchResults([])
                    setSearchError('')
                  }}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>

            <button
              className="si-search-button"
              onClick={performSearch}
              disabled={searching || !query.trim()}
            >
              {searching
                ? 'Locating…'
                : 'Search'}
            </button>
          </div>

          {searchError && (
            <div className="si-search-error">
              ⚠️ {searchError}
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="si-search-results">
              {searchResults.map((result, index) => (
                <button
                  key={`${result.lat}-${result.lng}-${index}`}
                  className="si-search-result"
                  onClick={() => selectLocation(result)}
                >
                  <span className="si-result-icon">
                    📍
                  </span>

                  <span>
                    <strong>{result.name}</strong>
                    <small>
                      {result.source} · Click to locate
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="site-intelligence-map-wrap">
            <div
              ref={mapContainerRef}
              className="site-intelligence-map"
            />

            <div className="si-map-badge">
              {tileType === 'street'
                ? 'STREET MAP'
                : 'SATELLITE'}
            </div>
          </div>

          <div className="si-map-help">
            <strong>Tip</strong>
            <span>
              Search the exact apartment/property name
              first. If it is not indexed, add the
              locality or nearby road. Public geocoders
              cannot guarantee every private property is
              individually mapped.
            </span>
          </div>
        </div>

        <aside className="site-intelligence-panel">
          <div className="si-selected-card">
            <div className="si-panel-eyebrow">
              SELECTED SITE
            </div>

            <h3>
              {selectedLocation
                ? selectedLocation.name
                : 'No site selected'}
            </h3>

            {selectedLocation && (
              <p>
                {selectedLocation.lat.toFixed(6)}
                {' · '}
                {selectedLocation.lng.toFixed(6)}
              </p>
            )}
          </div>

          <div className="si-status-card">
            <div className="si-status-icon">
              {analyzing ? '⏳' : '🧭'}
            </div>

            <div>
              <strong>
                {analyzing
                  ? 'Inspecting site…'
                  : selectedLocation
                    ? 'Site located'
                    : 'Ready to inspect'}
              </strong>

              <span>
                {analyzing
                  ? 'Checking roads, water, rail, infrastructure and mapped restriction indicators.'
                  : 'Results below are preliminary GIS indicators.'}
              </span>
            </div>
          </div>

          {analysisError && (
            <div className="si-analysis-warning">
              ⚠️ {analysisError}
            </div>
          )}

          <div className="si-metrics-grid">
            <div className="si-metric">
              <span>Nearest Road</span>
              <strong>{roadLabel}</strong>
            </div>

            <div className="si-metric">
              <span>Approx. Road Width</span>
              <strong>
                {analysis?.roadWidthFt
                  ? `${analysis.roadWidthFt} ft`
                  : '—'}
              </strong>
            </div>

            <div className="si-metric">
              <span>Nearest Water / Drain</span>
              <strong>
                {analysis?.nearestWater
                  ? formatDistance(
                      analysis.nearestWater.distance
                    )
                  : '—'}
              </strong>
            </div>

            <div className="si-metric">
              <span>Nearest Rail / Metro</span>
              <strong>
                {analysis?.nearestRail
                  ? formatDistance(
                      analysis.nearestRail.distance
                    )
                  : '—'}
              </strong>
            </div>
          </div>

          <div className="si-context-section">
            <div className="si-section-title">
              <span>01</span>
              Nearby Roads
            </div>

            {analysis?.roads?.length ? (
              <div className="si-list">
                {analysis.roads
                  .slice(0, 5)
                  .map((road) => (
                    <div
                      className="si-list-row"
                      key={`${road.id}-${road.name}`}
                    >
                      <div>
                        <strong>{road.name}</strong>
                        <span>{road.type}</span>
                      </div>

                      <b>
                        {formatDistance(road.distance)}
                      </b>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="si-empty">
                {selectedLocation
                  ? 'No nearby road data returned.'
                  : 'Search a site to inspect nearby roads.'}
              </p>
            )}
          </div>

          <div className="si-context-section">
            <div className="si-section-title">
              <span>02</span>
              Water & Drainage
            </div>

            <div
              className={`si-check-row ${
                analysis?.waterConcern
                  ? 'warning'
                  : ''
              }`}
            >
              <span>
                {analysis?.waterConcern
                  ? '⚠️'
                  : '💧'}
              </span>

              <div>
                <strong>
                  {analysis?.nearestWater
                    ? analysis.nearestWater.name
                    : 'No nearby feature detected'}
                </strong>

                <small>
                  {analysis?.nearestWater
                    ? `Approx. ${formatDistance(
                        analysis.nearestWater.distance
                      )} away`
                    : 'Based on available OpenStreetMap data'}
                </small>
              </div>
            </div>
          </div>

          <div className="si-context-section">
            <div className="si-section-title">
              <span>03</span>
              Railway / Metro
            </div>

            <div
              className={`si-check-row ${
                analysis?.railConcern
                  ? 'warning'
                  : ''
              }`}
            >
              <span>
                {analysis?.railConcern
                  ? '⚠️'
                  : '🚆'}
              </span>

              <div>
                <strong>
                  {analysis?.nearestRail
                    ? analysis.nearestRail.name
                    : 'No nearby rail feature detected'}
                </strong>

                <small>
                  {analysis?.nearestRail
                    ? `Approx. ${formatDistance(
                        analysis.nearestRail.distance
                      )} away`
                    : 'Based on available OpenStreetMap data'}
                </small>
              </div>
            </div>
          </div>

          <div className="si-context-section">
            <div className="si-section-title">
              <span>04</span>
              Site Restrictions & Checks
            </div>

            <div className="si-list">
              <div className={`si-check-row ${analysis?.roadConcern ? 'warning' : ''}`}>
                <span>{analysis?.roadConcern ? '⚠️' : '✓'}</span>
                <div>
                  <strong>Road / access</strong>
                  <small>{analysis?.nearestRoad ? `${analysis.nearestRoad.name} · ${analysis.nearestRoad.widthFt} ft estimated` : 'No mapped road detected'}</small>
                </div>
              </div>

              <div className={`si-check-row ${analysis?.roadConcern ? 'warning' : ''}`}>
                <span>{analysis?.roadConcern ? '⚠️' : '✓'}</span>
                <div>
                  <strong>Road width</strong>
                  <small>{analysis?.roadWidthFt ? `Approx. ${analysis.roadWidthFt} ft · verify from official survey` : 'Manual verification required'}</small>
                </div>
              </div>

              <div className="si-check-row">
                <span>📐</span>
                <div>
                  <strong>Road-facing side / direction</strong>
                  <small>Requires plot boundary and site-survey orientation; not reliably determined from a point location alone.</small>
                </div>
              </div>

              <div className="si-check-row">
                <span>◈</span>
                <div>
                  <strong>Corner / interior plot</strong>
                  <small>Requires the actual plot boundary and road frontage; GIS point data alone cannot confirm this.</small>
                </div>
              </div>

              <div className={`si-check-row ${analysis?.waterConcern ? 'warning' : ''}`}>
                <span>{analysis?.waterConcern ? '⚠️' : '💧'}</span>
                <div>
                  <strong>Lake / tank / waterbody buffer</strong>
                  <small>{analysis?.nearestWater ? `${formatDistance(analysis.nearestWater.distance)} · verify applicable buffer from authoritative records` : 'No mapped waterbody detected nearby'}</small>
                </div>
              </div>

              <div className={`si-check-row ${analysis?.waterConcern ? 'warning' : ''}`}>
                <span>{analysis?.waterConcern ? '⚠️' : '💧'}</span>
                <div>
                  <strong>Rajakaluve / storm-water drain</strong>
                  <small>{analysis?.nearestWater ? `${formatDistance(analysis.nearestWater.distance)} · drainage feature detected in public GIS data` : 'No mapped drain/waterway detected nearby'}</small>
                </div>
              </div>

              <div className={`si-check-row ${analysis?.railConcern ? 'warning' : ''}`}>
                <span>{analysis?.railConcern ? '⚠️' : '🚇'}</span>
                <div>
                  <strong>Metro / transit corridor</strong>
                  <small>{analysis?.nearestRail ? `${formatDistance(analysis.nearestRail.distance)} · ${analysis.nearestRail.name}` : 'No mapped rail/metro feature detected nearby'}</small>
                </div>
              </div>

              <div className={`si-check-row ${analysis?.railConcern ? 'warning' : ''}`}>
                <span>{analysis?.railConcern ? '⚠️' : '🚆'}</span>
                <div>
                  <strong>Railway / suburban rail</strong>
                  <small>{analysis?.nearestRail ? `${formatDistance(analysis.nearestRail.distance)} · verify corridor-specific rules` : 'No mapped railway feature detected nearby'}</small>
                </div>
              </div>

              <div className={`si-check-row ${analysis?.powerConcern ? 'warning' : ''}`}>
                <span>{analysis?.powerConcern ? '⚠️' : '⚡'}</span>
                <div>
                  <strong>HT / electrical-line corridor</strong>
                  <small>{analysis?.nearestPower ? `${formatDistance(analysis.nearestPower.distance)} · ${analysis.nearestPower.name}` : 'No mapped power line detected nearby'}</small>
                </div>
              </div>

              <div className={`si-check-row ${analysis?.proposedRoadConcern ? 'warning' : ''}`}>
                <span>{analysis?.proposedRoadConcern ? '⚠️' : '🛣️'}</span>
                <div>
                  <strong>Proposed road / road widening</strong>
                  <small>{analysis?.nearestProposedRoad ? `${formatDistance(analysis.nearestProposedRoad.distance)} · ${analysis.nearestProposedRoad.name}` : 'No mapped proposed/construction road nearby'}</small>
                </div>
              </div>

              <div className="si-check-row warning">
                <span>◉</span>
                <div>
                  <strong>TOD zone</strong>
                  <small>Not reliably available from the public GIS feed used here · verify the applicable planning/TOD map for the site.</small>
                </div>
              </div>

              <div className="si-check-row">
                <span>🏙️</span>
                <div>
                  <strong>Land-use / zoning</strong>
                  <small>{analysis?.nearestLanduse ? `Nearest mapped land-use: ${analysis.nearestLanduse.type}` : 'Planning land-use designation requires authoritative zoning records'}</small>
                </div>
              </div>

              <div className={`si-check-row ${analysis?.ecoConcern ? 'warning' : ''}`}>
                <span>{analysis?.ecoConcern ? '⚠️' : '🌳'}</span>
                <div>
                  <strong>Tree / environmental restrictions</strong>
                  <small>{analysis?.treeCount ? `${analysis.treeCount} mapped tree feature(s) in the screening radius · verify tree permissions before removal` : 'No mapped tree point detected in the screening radius'}</small>
                </div>
              </div>

              <div className={`si-check-row ${analysis?.airportConcern ? 'warning' : ''}`}>
                <span>{analysis?.airportConcern ? '⚠️' : '✈️'}</span>
                <div>
                  <strong>Airport / air-funnel restrictions</strong>
                  <small>{analysis?.nearestAirport ? `${formatDistance(analysis.nearestAirport.distance)} · verify applicable aviation height restrictions` : 'No mapped aeroway feature in the screening radius'}</small>
                </div>
              </div>

              <div className={`si-check-row ${analysis?.heritageConcern || analysis?.protectedConcern ? 'warning' : ''}`}>
                <span>{analysis?.heritageConcern || analysis?.protectedConcern ? '⚠️' : '🏛️'}</span>
                <div>
                  <strong>Heritage / protected area</strong>
                  <small>{analysis?.nearestHeritage ? `${formatDistance(analysis.nearestHeritage.distance)} · ${analysis.nearestHeritage.name}` : analysis?.nearestProtected ? `${formatDistance(analysis.nearestProtected.distance)} · ${analysis.nearestProtected.name}` : 'No mapped heritage/protected feature detected nearby'}</small>
                </div>
              </div>

              <div className={`si-check-row ${analysis?.militaryConcern ? 'warning' : ''}`}>
                <span>{analysis?.militaryConcern ? '⚠️' : '🛡️'}</span>
                <div>
                  <strong>Other restricted / defence context</strong>
                  <small>{analysis?.nearestMilitary ? `${formatDistance(analysis.nearestMilitary.distance)} · ${analysis.nearestMilitary.name}` : 'No mapped military feature detected nearby'}</small>
                </div>
              </div>
            </div>
          </div>

          <div className="si-context-section">
            <div className="si-section-title">
              <span>05</span>
              Permission & Authority Checks
            </div>

            <div className="si-list">
              {[
                ['🏗️', 'Building approval', 'Confirm applicable building-plan approval requirements before design submission.'],
                ['📏', 'Road / building-line verification', 'Confirm official road boundary, building line and applicable setback requirements.'],
                ['💧', 'Water / sewerage', 'Confirm availability, connection requirements and applicable utility clearances.'],
                ['⚡', 'Electrical connection', 'Confirm power connection requirements and any utility corridor clearance.'],
                ['🔥', 'Fire clearance', 'Check whether the proposed building/use triggers fire-safety approval requirements.'],
                ['🌳', 'Tree / environment approval', 'Check tree-protection and environmental permissions where applicable.'],
                ['🚇', 'Metro / rail / road authority', 'Check additional authority NOCs or corridor restrictions where applicable.'],
                ['📋', 'Special-zone clearance', 'Check TOD, protected, heritage, airport, defence or other special-zone requirements.'],
              ].map(([icon, title, detail]) => (
                <div className="si-check-row" key={title}>
                  <span>{icon}</span>
                  <div>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="si-disclaimer">
            <strong>Preliminary GIS screen</strong>
            <p>
              This tool uses public geocoding and
              OpenStreetMap data. Road widths and nearby
              GIS distances and restriction indicators are
              preliminary screening information only. They do not
              establish legal setbacks, buffers, zoning, TOD status,
              aviation height limits, utility clearances or approval
              eligibility. Verify every flagged item against an
              official survey, applicable planning rules and
              authoritative records before relying on it.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
