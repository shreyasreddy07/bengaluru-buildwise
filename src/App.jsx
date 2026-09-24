import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

import GBASetbackVisualizer from './components/GBASetbackVisualizer'
import SiteIntelligence from './components/SiteIntelligence'

import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

/* =========================================================
   LEAFLET MARKER FIX
========================================================= */

const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
})

L.Marker.prototype.options.icon = DefaultIcon

/* =========================================================
   HELPERS
========================================================= */

function calculateDistanceFeet(lat1, lng1, lat2, lng2) {
  const R = 6371000

  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return (R * c * 3.28084).toFixed(1)
}

function calculatePolygonAreaSqFt(points) {
  if (!points || points.length < 3) return 0

  const lat0 = (points.reduce((sum, p) => sum + p.lat, 0) / points.length) * (Math.PI / 180)

  const metersPerDegreeLat = 111320
  const metersPerDegreeLng = 111320 * Math.cos(lat0)

  const xy = points.map((p) => ({
    x: p.lng * metersPerDegreeLng,
    y: p.lat * metersPerDegreeLat,
  }))

  let area = 0

  for (let i = 0; i < xy.length; i++) {
    const j = (i + 1) % xy.length

    area += xy[i].x * xy[j].y
    area -= xy[j].x * xy[i].y
  }

  return Math.abs(area / 2) * 10.7639
}

function calculatePolygonSides(points) {
  if (!points || points.length < 2) return []

  const sides = []

  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length

    sides.push(
      Number(
        calculateDistanceFeet(
          points[i].lat,
          points[i].lng,
          points[next].lat,
          points[next].lng
        )
      )
    )
  }

  return sides
}

/* =========================================================
   GBA CALCULATION
========================================================= */

function calculateGBABylaws(
  areaSqFt,
  roadWidthFt,
  buildingType,
  selectedFloors
) {
  let far = 2.0
  let coverage = 70

  if (buildingType === 'residential') {
    if (areaSqFt <= 1200) {
      far = 1.75
      coverage = 75
    } else if (areaSqFt <= 2400) {
      far = 2.0
      coverage = 70
    } else if (areaSqFt <= 4000) {
      far = 2.25
      coverage = 65
    } else {
      far = 2.5
      coverage = 60
    }
  }

  if (buildingType === 'commercial') {
    far = roadWidthFt >= 40 ? 3.0 : 2.25
    coverage = 80
  }

  if (roadWidthFt < 30) {
    far = Math.min(far, 1.75)
  }

  const maxGroundCoverage = areaSqFt * (coverage / 100)

  const theoreticalBuiltUp = areaSqFt * far

  const floorCap = Math.max(1, selectedFloors)

  const floorBasedBuiltUp = maxGroundCoverage * floorCap

  const maxBuiltUp = Math.min(
    theoreticalBuiltUp,
    floorBasedBuiltUp
  )

  let status = 'Within preliminary parameters'
  let statusType = 'good'

  if (roadWidthFt < 20) {
    status = 'Road width requires verification'
    statusType = 'warning'
  }

  if (roadWidthFt < 15) {
    status = 'Major road-width constraint'
    statusType = 'danger'
  }

  return {
    far,
    coverage,
    maxGroundCoverage,
    theoreticalBuiltUp,
    maxBuiltUp,
    status,
    statusType,
  }
}

/* =========================================================
   COST
========================================================= */

function calculateConstructionCost(
  builtUpArea,
  buildingType,
  qualityGrade
) {
  const rates = {
    residential: {
      basic: 1800,
      standard: 2300,
      premium: 3000,
    },
    commercial: {
      basic: 2100,
      standard: 2700,
      premium: 3500,
    },
  }

  const rate =
    rates[buildingType]?.[qualityGrade] || 2300

  const total = builtUpArea * rate

  return {
    rate,
    total,
    structure: total * 0.42,
    finishes: total * 0.22,
    electrical: total * 0.10,
    plumbing: total * 0.08,
    windows: total * 0.07,
    labour: total * 0.07,
    external: total * 0.04,
  }
}

/* =========================================================
   SEARCH / GEOCODING
========================================================= */

async function searchNominatim(query) {
  const url =
    `https://nominatim.openstreetmap.org/search?` +
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

  if (!response.ok) {
    throw new Error('Location search failed')
  }

  return response.json()
}

async function searchArcGIS(query) {
  const url =
    `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?` +
    new URLSearchParams({
      SingleLine: query,
      f: 'json',
      outFields: '*',
      maxLocations: '8',
      countryCode: 'IND',
    })

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error('Secondary location search failed')
  }

  const data = await response.json()

  return (data.candidates || []).map((item) => ({
    lat: item.location?.y,
    lon: item.location?.x,
    display_name: item.address,
    importance: item.score,
    source: 'ArcGIS',
  }))
}

/* =========================================================
   MAIN APP
========================================================= */

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('welcome')
  const [selectedTool, setSelectedTool] = useState('analyze')

  /* ---------------------------------------------
     ANALYZER STATE
  --------------------------------------------- */

  const [plotPoints, setPlotPoints] = useState([])
  const [sideLengths, setSideLengths] = useState([])
  const [calculatedArea, setCalculatedArea] = useState(0)

  const [roadWidth, setRoadWidth] = useState(30)
  const [buildingType, setBuildingType] = useState('residential')
  const [selectedFloors, setSelectedFloors] = useState(3)
  const [qualityGrade, setQualityGrade] = useState('standard')

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')

  const [tileType, setTileType] = useState('satellite')

  const mapRef = useRef(null)
  const mapContainerRef = useRef(null)
  const markersLayerRef = useRef(null)
  const polygonLayerRef = useRef(null)
  const locationMarkerRef = useRef(null)

  /* ---------------------------------------------
     SEARCH / LOCATION
  --------------------------------------------- */

  const performLocationSearch = async () => {
    const query = searchQuery.trim()

    if (!query) return

    setSearching(true)
    setSearchError('')
    setSearchResults([])

    try {
      const queries = [
        query,
        `${query}, Bengaluru, Karnataka, India`,
        `${query}, Bangalore, Karnataka, India`,
      ]

      let results = []

      for (const q of queries) {
        try {
          const found = await searchNominatim(q)

          if (found.length) {
            results = found
            break
          }
        } catch {
          /* continue */
        }
      }

      /* -----------------------------------------
         SECONDARY GEOCODER
      ----------------------------------------- */

      if (!results.length) {
        try {
          results = await searchArcGIS(
            `${query}, Bengaluru, Karnataka, India`
          )
        } catch {
          /* continue */
        }
      }

      if (!results.length) {
        setSearchError(
          'We could not locate this place automatically. Try adding the locality, road name, or Bengaluru.'
        )
        return
      }

      const cleaned = results
        .filter((item) => item.lat && item.lon)
        .map((item) => ({
          lat: Number(item.lat),
          lng: Number(item.lon),
          name:
            item.display_name ||
            item.address ||
            'Selected location',
        }))

      setSearchResults(cleaned)

      if (cleaned.length) {
        selectSearchLocation(cleaned[0])
      }
    } catch {
      setSearchError(
        'Location search failed. Please try again.'
      )
    } finally {
      setSearching(false)
    }
  }

  const selectSearchLocation = (location) => {
    if (!mapRef.current) return

    const lat = Number(location.lat)
    const lng = Number(location.lng)

    mapRef.current.flyTo(
      [lat, lng],
      18,
      {
        duration: 1.5,
      }
    )

    if (locationMarkerRef.current) {
      locationMarkerRef.current.remove()
    }

    locationMarkerRef.current = L.marker([
      lat,
      lng,
    ])
      .addTo(mapRef.current)
      .bindPopup(
        `<strong>${location.name}</strong><br/>Site search location`
      )
      .openPopup()

    setSearchResults([])
  }

  /* ---------------------------------------------
     MAP INITIALIZATION
  --------------------------------------------- */

  useEffect(() => {
    if (
      currentScreen !== 'workspace' ||
      selectedTool !== 'analyze' ||
      !mapContainerRef.current
    ) {
      return
    }

    if (mapRef.current) {
      setTimeout(() => {
        mapRef.current.invalidateSize()
      }, 100)

      return
    }

    const map = L.map(mapContainerRef.current, {
      center: [12.9716, 77.5946],
      zoom: 12,
      zoomControl: true,
      attributionControl: true,
    })

    const satelliteLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 20,
        attribution:
          'Tiles © Esri, Maxar, Earthstar Geographics',
      }
    )

    const streetLayer = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 20,
        attribution: '© OpenStreetMap contributors',
      }
    )

    if (tileType === 'satellite') {
      satelliteLayer.addTo(map)
    } else {
      streetLayer.addTo(map)
    }

    mapRef.current = map

    markersLayerRef.current = L.layerGroup().addTo(map)

    map.on('click', (event) => {
      const newPoint = {
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      }

      setPlotPoints((previous) => [
        ...previous,
        newPoint,
      ])
    })

    setTimeout(() => {
      map.invalidateSize()
    }, 300)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [currentScreen, selectedTool])

  /* ---------------------------------------------
     CHANGE TILE LAYER
  --------------------------------------------- */

  useEffect(() => {
    if (!mapRef.current) return

    mapRef.current.eachLayer((layer) => {
      if (
        layer instanceof L.TileLayer
      ) {
        mapRef.current.removeLayer(layer)
      }
    })

    if (tileType === 'satellite') {
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 20,
          attribution:
            'Tiles © Esri, Maxar, Earthstar Geographics',
        }
      ).addTo(mapRef.current)
    } else {
      L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          maxZoom: 20,
          attribution: '© OpenStreetMap contributors',
        }
      ).addTo(mapRef.current)
    }
  }, [tileType])

  /* ---------------------------------------------
     DRAW MARKERS + POLYGON
  --------------------------------------------- */

  useEffect(() => {
    if (!mapRef.current) return

    if (markersLayerRef.current) {
      markersLayerRef.current.clearLayers()
    }

    if (polygonLayerRef.current) {
      mapRef.current.removeLayer(
        polygonLayerRef.current
      )
      polygonLayerRef.current = null
    }

    plotPoints.forEach((point, index) => {
      const marker = L.marker(
        [point.lat, point.lng],
        {
          draggable: true,
          autoPan: true,
        }
      )

      marker.bindTooltip(
        `P${index + 1}`,
        {
          permanent: true,
          direction: 'top',
          offset: [0, -18],
        }
      )

      marker.on('dragend', (event) => {
        const position =
          event.target.getLatLng()

        setPlotPoints((previous) =>
          previous.map((item, i) =>
            i === index
              ? {
                  lat: position.lat,
                  lng: position.lng,
                }
              : item
          )
        )
      })

      marker.addTo(markersLayerRef.current)
    })

    if (plotPoints.length >= 3) {
      polygonLayerRef.current =
        L.polygon(plotPoints, {
          color: '#0f5a40',
          weight: 4,
          fillColor: '#6cae88',
          fillOpacity: 0.18,
        }).addTo(mapRef.current)
    }

    const area =
      calculatePolygonAreaSqFt(plotPoints)

    const sides =
      calculatePolygonSides(plotPoints)

    setCalculatedArea(area)
    setSideLengths(sides)
  }, [plotPoints])

  /* ---------------------------------------------
     SAMPLE PLOT
  --------------------------------------------- */

  const loadSamplePlot = () => {
    const centerLat = 12.9352
    const centerLng = 77.6245

    const latOffset = 0.00016
    const lngOffset = 0.0002

    const sample = [
      {
        lat: centerLat + latOffset,
        lng: centerLng - lngOffset,
      },
      {
        lat: centerLat + latOffset,
        lng: centerLng + lngOffset,
      },
      {
        lat: centerLat - latOffset,
        lng: centerLng + lngOffset,
      },
      {
        lat: centerLat - latOffset,
        lng: centerLng - lngOffset,
      },
    ]

    setPlotPoints(sample)

    if (mapRef.current) {
      mapRef.current.fitBounds(sample, {
        padding: [50, 50],
      })
    }
  }

  /* ---------------------------------------------
     RESET PLOT
  --------------------------------------------- */

  const resetPlot = () => {
    setPlotPoints([])
    setSideLengths([])
    setCalculatedArea(0)

    if (locationMarkerRef.current) {
      locationMarkerRef.current.remove()
      locationMarkerRef.current = null
    }

    if (mapRef.current) {
      mapRef.current.flyTo(
        [12.9716, 77.5946],
        12,
        {
          duration: 1,
        }
      )
    }
  }

  /* ---------------------------------------------
     TOOL NAVIGATION
  --------------------------------------------- */

  const openWorkspace = (tool) => {
    setSelectedTool(tool)
    setCurrentScreen('workspace')

    setTimeout(() => {
      mapRef.current?.invalidateSize()
    }, 250)
  }

  const openSiteIntelligence = () => {
    setSelectedTool('intelligence')
    setCurrentScreen('site-intelligence')
  }

  /* ---------------------------------------------
     CALCULATIONS
  --------------------------------------------- */

  const bylaws = useMemo(
    () =>
      calculateGBABylaws(
        calculatedArea || 1200,
        Number(roadWidth) || 0,
        buildingType,
        Number(selectedFloors) || 1
      ),
    [
      calculatedArea,
      roadWidth,
      buildingType,
      selectedFloors,
    ]
  )

  const cost = useMemo(
    () =>
      calculateConstructionCost(
        bylaws.maxBuiltUp || 0,
        buildingType,
        qualityGrade
      ),
    [
      bylaws.maxBuiltUp,
      buildingType,
      qualityGrade,
    ]
  )

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div className="app">

      {/* =====================================================
          NAVBAR
      ===================================================== */}

      <nav className="navbar">

        <div
          className="brand"
          onClick={() =>
            setCurrentScreen('welcome')
          }
          style={{
            cursor: 'pointer',
          }}
        >
          <div className="brand-icon">
            🏗️
          </div>

          <div>
            <h2>Bengaluru BuildWise</h2>

            <span>
              CONSTRUCTION INTELLIGENCE
            </span>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '10px',
          }}
        >
          <button
            className="nav-button"
            onClick={() =>
              setCurrentScreen('welcome')
            }
          >
            Home
          </button>

          <button
            className="nav-button"
            onClick={() =>
              setCurrentScreen('tools')
            }
          >
            Tools
          </button>
        </div>

      </nav>


      <main>

        {/* ===================================================
            HOME
        =================================================== */}

        {currentScreen === 'welcome' && (
          <section className="home-page">

            <div className="home-hero">

              <div className="hero-overlay"></div>

              <div className="hero-copy">

                <div className="hero-badge">
                  BENGALURU CONSTRUCTION INTELLIGENCE
                </div>

                <h1>
                  Understand your site.
                  <br />
                  <span>Build with clarity.</span>
                </h1>

                <p className="hero-subtitle">
                  A practical planning workspace for
                  Bengaluru property owners, architects
                  and builders.
                </p>

                <div className="hero-buttons">

                  <button
                    className="hero-main-button"
                    onClick={() =>
                      setCurrentScreen('tools')
                    }
                  >
                    Explore BuildWise →
                  </button>

                  <button
                    className="hero-secondary-button"
                    onClick={openSiteIntelligence}
                  >
                    Inspect a Site
                  </button>

                </div>

                <div className="hero-trust">
                  SITE · CAPACITY · COST · APPROVALS · GIS
                </div>

              </div>

            </div>


            {/* HOME TOOLS */}

            <div className="home-tools">

              <div className="home-section-heading">

                <span>
                  BUILDWISE WORKFLOWS
                </span>

                <h2>
                  Everything starts with the site.
                </h2>

                <p>
                  Choose the workflow based on what
                  you need to understand.
                </p>

              </div>


              <div className="home-tool-grid">

                <div
                  className="home-tool-card"
                  onClick={() =>
                    openWorkspace('analyze')
                  }
                >
                  <div className="home-tool-icon">
                    📐
                  </div>

                  <h3>
                    Site Analysis
                  </h3>

                  <p>
                    Draw your property boundary,
                    calculate area and explore
                    preliminary development parameters.
                  </p>

                  <button>
                    Analyze Site →
                  </button>
                </div>


                <div
                  className="home-tool-card"
                  onClick={() =>
                    openWorkspace('plan')
                  }
                >
                  <div className="home-tool-icon">
                    🏢
                  </div>

                  <h3>
                    Planning Capacity
                  </h3>

                  <p>
                    Explore FAR, ground coverage,
                    built-up capacity and floor
                    potential.
                  </p>

                  <button>
                    View Capacity →
                  </button>
                </div>


                <div
                  className="home-tool-card"
                  onClick={() =>
                    openWorkspace('cost')
                  }
                >
                  <div className="home-tool-icon">
                    ₹
                  </div>

                  <h3>
                    Construction Cost
                  </h3>

                  <p>
                    Generate an early budget estimate
                    using your proposed built-up area
                    and construction grade.
                  </p>

                  <button>
                    Estimate Cost →
                  </button>
                </div>


                <div
                  className="home-tool-card"
                  onClick={() =>
                    openWorkspace('approvals')
                  }
                >
                  <div className="home-tool-icon">
                    ✓
                  </div>

                  <h3>
                    Approval Checklist
                  </h3>

                  <p>
                    Understand the preliminary
                    permissions, documents and
                    checks that may apply.
                  </p>

                  <button>
                    Check Approvals →
                  </button>
                </div>

                <div
                  className="home-tool-card"
                  onClick={() =>
                    openSiteIntelligence()
                  }
                >
                  <div className="home-tool-icon">
                    🧭
                  </div>

                  <h3>
                    Site Intelligence
                  </h3>

                  <p>
                    Locate your property and
                    understand roads, water bodies,
                    drains, rail and nearby planning
                    constraints.
                  </p>

                  <button>
                    Inspect Site →
                  </button>
                </div>


              </div>

            </div>


            {/* HOW IT WORKS */}

            <div className="how-it-works">

              <div className="home-section-heading">

                <span>
                  HOW BUILDWISE WORKS
                </span>

                <h2>
                  From location to planning.
                </h2>

              </div>

              <div className="steps-grid">

                <div className="step-card">
                  <div className="step-number">
                    01
                  </div>

                  <h3>
                    Locate
                  </h3>

                  <p>
                    Find the property and understand
                    its surrounding context.
                  </p>
                </div>

                <div className="step-card">
                  <div className="step-number">
                    02
                  </div>

                  <h3>
                    Measure
                  </h3>

                  <p>
                    Mark the site boundary and estimate
                    the site area.
                  </p>
                </div>

                <div className="step-card">
                  <div className="step-number">
                    03
                  </div>

                  <h3>
                    Plan
                  </h3>

                  <p>
                    Explore preliminary capacity,
                    costs and approval checks.
                  </p>
                </div>

              </div>

            </div>

          </section>
        )}


        {/* ===================================================
            TOOLS PAGE
        =================================================== */}

        {currentScreen === 'tools' && (
          <section className="features-section">

            <div className="section-heading">

              <span>
                BUILDWISE TOOLS
              </span>

              <h2>
                Everything starts with the site.
              </h2>

              <p>
                Choose a workflow based on what you
                want to understand.
              </p>

            </div>


            <div className="feature-grid">

              {/* 1 */}

              <div className="feature-card">

                <div className="feature-icon">
                  📐
                </div>

                <h3>
                  Site Analysis
                </h3>

                <p>
                  Draw your property boundary,
                  calculate approximate area and
                  explore preliminary development
                  parameters.
                </p>

                <button
                  className="primary-button"
                  onClick={() =>
                    openWorkspace('analyze')
                  }
                >
                  Analyze Site →
                </button>

              </div>


              {/* 3 */}

              <div className="feature-card">

                <div className="feature-icon">
                  🏢
                </div>

                <h3>
                  Planning Capacity
                </h3>

                <p>
                  Explore FAR, ground coverage,
                  approximate built-up capacity and
                  floor potential.
                </p>

                <button
                  className="primary-button"
                  onClick={() =>
                    openWorkspace('plan')
                  }
                >
                  View Capacity →
                </button>

              </div>


              {/* 4 */}

              <div className="feature-card">

                <div className="feature-icon">
                  ₹
                </div>

                <h3>
                  Construction Cost
                </h3>

                <p>
                  Generate an early construction budget
                  using your proposed built-up area and
                  quality grade.
                </p>

                <button
                  className="primary-button"
                  onClick={() =>
                    openWorkspace('cost')
                  }
                >
                  Estimate Cost →
                </button>

              </div>


              {/* 5 */}

              <div className="feature-card">

                <div className="feature-icon">
                  ✓
                </div>

                <h3>
                  Approval Checklist
                </h3>

                <p>
                  Understand the preliminary documents
                  and permission checks that may apply
                  to your project.
                </p>

                <button
                  className="primary-button"
                  onClick={() =>
                    openWorkspace('approvals')
                  }
                >
                  Check Approvals →
                </button>

              <div className="feature-card">

                <div className="feature-icon">
                  🧭
                </div>

                <h3>
                  Site Intelligence
                </h3>

                <p>
                  Locate your site and inspect nearby
                  roads, water bodies, drains, railway
                  and metro corridors.
                </p>

                <button
                  className="primary-button"
                  onClick={openSiteIntelligence}
                >
                  Inspect My Site →
                </button>

              </div>


              {/* 2 */}

              </div>

            </div>

          </section>
        )}


        {/* ===================================================
            SITE INTELLIGENCE
        =================================================== */}

        {currentScreen === 'site-intelligence' && (
          <section className="site-intelligence-page">

            <div className="site-intelligence-topbar">

              <div>

                <div className="workspace-eyebrow">
                  BUILDWISE GIS
                </div>

                <h1>
                  Site Intelligence
                </h1>

                <p>
                  Understand the physical and planning
                  context around your property before
                  you start designing.
                </p>

              </div>

              <button
                className="workspace-back"
                onClick={() =>
                  setCurrentScreen('tools')
                }
              >
                ← All Tools
              </button>

            </div>

            <SiteIntelligence />

          </section>
        )}


        {/* ===================================================
            ANALYSIS WORKSPACE
        =================================================== */}

        {currentScreen === 'workspace' && (
          <section className="buildwise-workspace">

            <div className="workspace-header">

              <div>

                <div className="workspace-eyebrow">
                  ACTIVE WORKSPACE
                </div>

                <h1>
                  {selectedTool === 'analyze' &&
                    '📐 Site & Setback Analyzer'}

                  {selectedTool === 'plan' &&
                    '🏢 Planning Capacity'}

                  {selectedTool === 'cost' &&
                    '₹ Construction Cost'}

                  {selectedTool === 'approvals' &&
                    '✓ Approval Checklist'}
                </h1>

              </div>

              <button
                className="workspace-back"
                onClick={() =>
                  setCurrentScreen('tools')
                }
              >
                ← Switch Tool
              </button>

            </div>


            {/* CONFIGURATION */}

            <div className="workspace-config">

              <div className="config-grid">

                <div className="config-field">

                  <label>
                    Building Type
                  </label>

                  <select
                    value={buildingType}
                    onChange={(e) =>
                      setBuildingType(e.target.value)
                    }
                  >
                    <option value="residential">
                      🏠 Residential Bylaws
                    </option>

                    <option value="commercial">
                      🏢 Commercial
                    </option>
                  </select>

                </div>


                <div className="config-field">

                  <label>
                    Floors to Construct
                  </label>

                  <select
                    value={selectedFloors}
                    onChange={(e) =>
                      setSelectedFloors(
                        Number(e.target.value)
                      )
                    }
                  >
                    <option value={1}>
                      Ground Floor
                    </option>

                    <option value={2}>
                      Ground + 1 Floor
                    </option>

                    <option value={3}>
                      Ground + 2 Floors (G+2)
                    </option>

                    <option value={4}>
                      Ground + 3 Floors (G+3)
                    </option>

                    <option value={5}>
                      Ground + 4 Floors (G+4)
                    </option>

                    <option value={6}>
                      Ground + 5 Floors (G+5)
                    </option>
                  </select>

                </div>


                <div className="config-field">

                  <label>
                    Road Width (ft)
                  </label>

                  <input
                    type="number"
                    min="0"
                    value={roadWidth}
                    onChange={(e) =>
                      setRoadWidth(
                        Number(e.target.value)
                      )
                    }
                  />

                </div>


                <div className="config-field">

                  <label>
                    Construction Grade
                  </label>

                  <select
                    value={qualityGrade}
                    onChange={(e) =>
                      setQualityGrade(
                        e.target.value
                      )
                    }
                  >
                    <option value="basic">
                      Basic (₹1800/sq ft)
                    </option>

                    <option value="standard">
                      Standard (₹2300/sq ft)
                    </option>

                    <option value="premium">
                      Premium (₹3000/sq ft)
                    </option>
                  </select>

                </div>

              </div>

            </div>


            {/* =================================================
                ANALYZE
            ================================================= */}

            {selectedTool === 'analyze' && (
              <div className="analysis-layout">

                <div className="map-workspace-card">

                  <div className="map-card-header">

                    <div>

                      <div className="map-eyebrow">
                        SITE MEASUREMENT
                      </div>

                      <h2>
                        Interactive Satellite Plot &
                        Measurement Calculator
                      </h2>

                    </div>

                    <div
                      style={{
                        display: 'flex',
                        gap: '10px',
                        flexWrap: 'wrap',
                      }}
                    >

                      <button
                        className="map-mode-pill"
                        onClick={() =>
                          setTileType(
                            tileType === 'satellite'
                              ? 'street'
                              : 'satellite'
                          )
                        }
                      >
                        {tileType === 'satellite'
                          ? '🗺️ Street Map'
                          : '🛰️ Satellite'}
                      </button>

                      <button
                        className="map-reset"
                        onClick={loadSamplePlot}
                      >
                        Sample Plot
                      </button>

                      <button
                        className="map-reset"
                        onClick={resetPlot}
                      >
                        Reset Plot
                      </button>

                    </div>

                  </div>


                  {/* SEARCH */}

                  <div
                    className="workspace-search"
                    style={{
                      display: 'flex',
                      gap: '10px',
                      position: 'relative',
                    }}
                  >

                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value)
                        setSearchError('')
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          performLocationSearch()
                        }
                      }}
                      placeholder="Search your property, apartment, road or locality — e.g. AKR Comforts Arekere"
                      style={{
                        flex: 1,
                      }}
                    />

                    <button
                      className="primary-button"
                      onClick={
                        performLocationSearch
                      }
                      disabled={searching}
                    >
                      {searching
                        ? 'Locating...'
                        : 'Search'}
                    </button>

                  </div>


                  {searchError && (
                    <div
                      style={{
                        marginTop: '10px',
                        padding: '12px 15px',
                        borderRadius: '10px',
                        background: '#fff4e8',
                        color: '#8a4b08',
                        fontSize: '14px',
                      }}
                    >
                      {searchError}
                    </div>
                  )}


                  {searchResults.length > 0 && (
                    <div
                      style={{
                        marginTop: '10px',
                        border:
                          '1px solid #dce5db',
                        borderRadius: '12px',
                        overflow: 'hidden',
                        background: '#fff',
                      }}
                    >
                      {searchResults.map(
                        (result, index) => (
                          <button
                            key={`${result.lat}-${result.lng}-${index}`}
                            onClick={() =>
                              selectSearchLocation(
                                result
                              )
                            }
                            style={{
                              width: '100%',
                              padding: '13px 15px',
                              textAlign: 'left',
                              border: 'none',
                              borderBottom:
                                index <
                                searchResults.length -
                                  1
                                  ? '1px solid #edf1ec'
                                  : 'none',
                              background: '#fff',
                              cursor: 'pointer',
                            }}
                          >
                            <strong>
                              📍 {result.name}
                            </strong>

                            <div
                              style={{
                                marginTop: '4px',
                                color: '#718078',
                                fontSize: '12px',
                              }}
                            >
                              Click to locate this
                              result on the map
                            </div>
                          </button>
                        )
                      )}
                    </div>
                  )}


                  {/* MAP */}

                  <div
                    ref={mapContainerRef}
                    className="buildwise-map"
                    style={{
                      minHeight: '540px',
                      cursor: 'crosshair',
                    }}
                  />


                  {/* MAP INSTRUCTIONS */}

                  <div className="map-instruction">

                    <strong>
                      How to mark your property
                    </strong>

                    <span>
                      Click the map to place each
                      boundary point. Continue around
                      the property clockwise or
                      anticlockwise.
                    </span>

                    <span>
                      Drag any numbered point to
                      fine-tune its position.
                    </span>

                    <span>
                      Use Street Map when satellite
                      imagery makes the property
                      boundary difficult to identify.
                    </span>

                  </div>

                </div>


                {/* RIGHT SIDE */}

                <aside className="site-insights">

                  <div className="metric-main">

                    <span>
                      ESTIMATED SITE AREA
                    </span>

                    <strong>
                      {Math.round(
                        calculatedArea || 0
                      ).toLocaleString('en-IN')}
                    </strong>

                    <small>
                      sq ft
                    </small>

                  </div>


                  <div className="metric-grid">

                    <div className="metric-card">

                      <span>
                        Boundary Points
                      </span>

                      <strong>
                        {plotPoints.length}
                      </strong>

                    </div>


                    <div className="metric-card">

                      <span>
                        Road Width
                      </span>

                      <strong>
                        {roadWidth}
                        <small> ft</small>
                      </strong>

                    </div>


                    <div className="metric-card">

                      <span>
                        FAR
                      </span>

                      <strong>
                        {bylaws.far}
                      </strong>

                    </div>


                    <div className="metric-card">

                      <span>
                        Ground Coverage
                      </span>

                      <strong>
                        {bylaws.coverage}%
                      </strong>

                    </div>

                  </div>


                  <div className="dimensions-card">

                    <h3>
                      Site Dimensions
                    </h3>

                    {sideLengths.length === 0 && (
                      <p>
                        Mark at least two boundary
                        points to see dimensions.
                      </p>
                    )}

                    {sideLengths.map(
                      (side, index) => (
                        <div key={index}>
                          Side {index + 1}{' '}
                          <strong>
                            {side.toLocaleString(
                              'en-IN'
                            )}{' '}
                            ft
                          </strong>
                        </div>
                      )
                    )}

                  </div>


                  <div className="manual-area-card">

                    <h3>
                      Manual Area Override
                    </h3>

                    <input
                      type="number"
                      value={
                        calculatedArea
                          ? Math.round(
                              calculatedArea
                            )
                          : ''
                      }
                      onChange={(e) =>
                        setCalculatedArea(
                          Number(e.target.value)
                        )
                      }
                    />

                    <p>
                      Use this only when you already
                      know the survey area.
                    </p>

                  </div>


                  <div className="result-card">

                    <span>
                      PRELIMINARY CHECK
                    </span>

                    <h3>
                      {bylaws.status}
                    </h3>

                    <p>
                      FAR: {bylaws.far}
                      <br />
                      Maximum ground coverage:{' '}
                      {Math.round(
                        bylaws.maxGroundCoverage
                      ).toLocaleString(
                        'en-IN'
                      )}{' '}
                      sq ft
                      <br />
                      Preliminary maximum built-up:{' '}
                      {Math.round(
                        bylaws.maxBuiltUp
                      ).toLocaleString(
                        'en-IN'
                      )}{' '}
                      sq ft
                    </p>

                  </div>

                </aside>

              </div>
            )}


            {/* =================================================
                PLANNING CAPACITY
            ================================================= */}

            {selectedTool === 'plan' && (
              <div className="professional-panel">

                <div className="panel-heading">

                  <span>
                    PLANNING CAPACITY
                  </span>

                  <h2>
                    Understand your development
                    potential.
                  </h2>

                  <p>
                    These are preliminary planning
                    calculations based on the site
                    information entered above.
                  </p>

                </div>


                <div className="capacity-grid">

                  <div className="capacity-card">

                    <span>
                      SITE AREA
                    </span>

                    <strong>
                      {Math.round(
                        calculatedArea || 1200
                      ).toLocaleString(
                        'en-IN'
                      )}
                    </strong>

                    <small>
                      sq ft
                    </small>

                  </div>


                  <div className="capacity-card">

                    <span>
                      FAR
                    </span>

                    <strong>
                      {bylaws.far}
                    </strong>

                  </div>


                  <div className="capacity-card">

                    <span>
                      GROUND COVERAGE
                    </span>

                    <strong>
                      {bylaws.coverage}%
                    </strong>

                  </div>


                  <div className="capacity-card green-card">

                    <span>
                      PRELIMINARY BUILT-UP
                    </span>

                    <strong>
                      {Math.round(
                        bylaws.maxBuiltUp
                      ).toLocaleString(
                        'en-IN'
                      )}
                    </strong>

                    <small>
                      sq ft
                    </small>

                  </div>

                </div>


                <div
                  style={{
                    marginTop: '30px',
                    padding: '25px',
                    border:
                      '1px solid #dce5db',
                    borderRadius: '18px',
                    background: '#fff',
                  }}
                >

                  <h3>
                    Floor potential
                  </h3>

                  <p>
                    {selectedFloors} floor
                    configuration selected.
                  </p>

                  <p>
                    Approximate buildable floor
                    plate:{' '}
                    <strong>
                      {Math.round(
                        bylaws.maxGroundCoverage
                      ).toLocaleString(
                        'en-IN'
                      )}{' '}
                      sq ft
                    </strong>
                  </p>

                  <p>
                    Approximate total built-up
                    potential:{' '}
                    <strong>
                      {Math.round(
                        bylaws.maxBuiltUp
                      ).toLocaleString(
                        'en-IN'
                      )}{' '}
                      sq ft
                    </strong>
                  </p>

                </div>


                <div
                  style={{
                    marginTop: '25px',
                  }}
                >

                  <GBASetbackVisualizer
                    areaSqFt={
                      calculatedArea || 1200
                    }
                    roadWidthFt={roadWidth}
                    sideLengths={
                      sideLengths.length
                        ? sideLengths
                        : [30, 40, 30, 40]
                    }
                  />

                </div>

              </div>
            )}


            {/* =================================================
                COST
            ================================================= */}

            {selectedTool === 'cost' && (
              <div className="professional-panel">

                <div className="cost-hero">

                  <span>
                    PRELIMINARY CONSTRUCTION
                    ESTIMATE
                  </span>

                  <h2>
                    ₹
                    {Math.round(
                      cost.total
                    ).toLocaleString(
                      'en-IN'
                    )}
                  </h2>

                  <p>
                    Based on approximately{' '}
                    {Math.round(
                      bylaws.maxBuiltUp
                    ).toLocaleString(
                      'en-IN'
                    )}{' '}
                    sq ft of built-up area.
                  </p>

                </div>


                <h3 className="subsection-title">
                  Cost Breakdown
                </h3>


                <div className="cost-breakdown">

                  <div className="cost-row">
                    <span>
                      Structure & civil works
                    </span>

                    <strong>
                      ₹
                      {Math.round(
                        cost.structure
                      ).toLocaleString(
                        'en-IN'
                      )}
                    </strong>
                  </div>


                  <div className="cost-row">
                    <span>
                      Finishes
                    </span>

                    <strong>
                      ₹
                      {Math.round(
                        cost.finishes
                      ).toLocaleString(
                        'en-IN'
                      )}
                    </strong>
                  </div>


                  <div className="cost-row">
                    <span>
                      Electrical
                    </span>

                    <strong>
                      ₹
                      {Math.round(
                        cost.electrical
                      ).toLocaleString(
                        'en-IN'
                      )}
                    </strong>
                  </div>


                  <div className="cost-row">
                    <span>
                      Plumbing
                    </span>

                    <strong>
                      ₹
                      {Math.round(
                        cost.plumbing
                      ).toLocaleString(
                        'en-IN'
                      )}
                    </strong>
                  </div>


                  <div className="cost-row">
                    <span>
                      Windows & doors
                    </span>

                    <strong>
                      ₹
                      {Math.round(
                        cost.windows
                      ).toLocaleString(
                        'en-IN'
                      )}
                    </strong>
                  </div>


                  <div className="cost-row">
                    <span>
                      Labour
                    </span>

                    <strong>
                      ₹
                      {Math.round(
                        cost.labour
                      ).toLocaleString(
                        'en-IN'
                      )}
                    </strong>
                  </div>


                  <div className="cost-row">
                    <span>
                      External works
                    </span>

                    <strong>
                      ₹
                      {Math.round(
                        cost.external
                      ).toLocaleString(
                        'en-IN'
                      )}
                    </strong>
                  </div>

                </div>


                <div className="boq-grid">

                  <div className="boq-card">

                    <span>
                      SELECTED GRADE
                    </span>

                    <strong>
                      {qualityGrade
                        .charAt(0)
                        .toUpperCase() +
                        qualityGrade.slice(1)}
                    </strong>

                  </div>


                  <div className="boq-card">

                    <span>
                      RATE
                    </span>

                    <strong>
                      ₹
                      {cost.rate.toLocaleString(
                        'en-IN'
                      )}
                      /sq ft
                    </strong>

                  </div>

                </div>

              </div>
            )}


            {/* =================================================
                APPROVALS
            ================================================= */}

            {selectedTool === 'approvals' && (
              <div className="professional-panel">

                <div className="panel-heading">

                  <span>
                    PRELIMINARY CHECKLIST
                  </span>

                  <h2>
                    What should you verify
                    before construction?
                  </h2>

                  <p>
                    This checklist is an early planning
                    guide and should not be treated as
                    a statutory approval.
                  </p>

                </div>


                <div className="approval-list">

                  <div className="approval-item">

                    <div className="approval-number">
                      01
                    </div>

                    <div>
                      <h3>
                        Property ownership
                        documents
                      </h3>

                      <p>
                        Verify title, sale deed,
                        khata and applicable property
                        records.
                      </p>
                    </div>

                  </div>


                  <div className="approval-item">

                    <div className="approval-number">
                      02
                    </div>

                    <div>
                      <h3>
                        Survey & site dimensions
                      </h3>

                      <p>
                        Confirm the property boundary,
                        dimensions and survey area.
                      </p>
                    </div>

                  </div>


                  <div className="approval-item">

                    <div className="approval-number">
                      03
                    </div>

                    <div>
                      <h3>
                        Road width & building line
                      </h3>

                      <p>
                        Verify the actual abutting road
                        width and applicable building
                        line/setback requirements.
                      </p>
                    </div>

                  </div>


                  <div className="approval-item">

                    <div className="approval-number">
                      04
                    </div>

                    <div>
                      <h3>
                        Development regulations
                      </h3>

                      <p>
                        Confirm the applicable zoning,
                        FAR, setbacks, coverage and
                        development controls.
                      </p>
                    </div>

                  </div>


                  <div className="approval-item">

                    <div className="approval-number">
                      05
                    </div>

                    <div>
                      <h3>
                        Water bodies & drains
                      </h3>

                      <p>
                        Check whether the property is
                        affected by lakes, drains,
                        rajakaluve or other protected
                        features.
                      </p>
                    </div>

                  </div>


                  <div className="approval-item">

                    <div className="approval-number">
                      06
                    </div>

                    <div>
                      <h3>
                        Infrastructure corridors
                      </h3>

                      <p>
                        Verify applicable Metro,
                        railway, highway or other
                        infrastructure restrictions.
                      </p>
                    </div>

                  </div>

                </div>

              </div>
            )}

          </section>
        )}

      </main>


      {/* =====================================================
          FOOTER
      ===================================================== */}

      <footer
        style={{
          padding: '40px 6%',
          textAlign: 'center',
          color: '#718078',
          fontSize: '13px',
        }}
      >
        Bengaluru BuildWise · Construction
        Intelligence · Preliminary planning
        information only
      </footer>

    </div>
  )
}