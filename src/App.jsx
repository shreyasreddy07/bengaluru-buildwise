import GBASetbackVisualizer from './components/GBASetbackVisualizer'
import { calculateGBASetbacks } from './utils/gbaRules'
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

// Leaflet default marker fix for Vite/React
import icon from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})
L.Marker.prototype.options.icon = DefaultIcon

/* =====================================================
   ACCURATE GEODESIC CALCULATIONS
===================================================== */
const calculateAccurateDistanceFeet = (lat1, lon1, lat2, lon2) => {
  const R = 6371008.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c * 3.28084
}

const calculateAccurateAreaSqFt = (points) => {
  if (points.length < 3) return 0

  const R = 6371008.8
  const centerLat =
    (points.reduce((acc, p) => acc + p.lat, 0) / points.length) * (Math.PI / 180)

  const xyPoints = points.map((p) => {
    const x = ((p.lng * Math.PI) / 180) * R * Math.cos(centerLat)
    const y = ((p.lat * Math.PI) / 180) * R
    return { x, y }
  })

  let areaSqMeters = 0
  const numPoints = xyPoints.length

  for (let i = 0; i < numPoints; i++) {
    const j = (i + 1) % numPoints
    areaSqMeters += xyPoints[i].x * xyPoints[j].y
    areaSqMeters -= xyPoints[j].x * xyPoints[i].y
  }

  areaSqMeters = Math.abs(areaSqMeters) / 2
  return Math.round(areaSqMeters * 10.7639)
}

/* =====================================================
   GBA BYLAW & CONFIG ENGINE
===================================================== */
const calculateGBABylaws = (areaSqFt, roadWidthFt, sideLengths = [], buildingHeightM = 11.5, hasStilt = false, buildingType = 'residential', selectedFloors = 3) => {
  let far = 1.75
  let maxCoveragePct = 70

  if (buildingType === 'commercial') {
    far = roadWidthFt >= 40 ? 3.0 : 2.25
    maxCoveragePct = 80
  } else {
    if (areaSqFt <= 1200) {
      far = 1.75
      maxCoveragePct = 75
    } else if (areaSqFt <= 2400) {
      far = 2.0
      maxCoveragePct = 70
    } else if (areaSqFt <= 4000) {
      far = 2.25
      maxCoveragePct = 65
    } else {
      far = 2.5
      maxCoveragePct = 60
    }

    if (roadWidthFt < 30) {
      far = Math.min(far, 1.75)
    }
  }

  const siteAreaSqM = areaSqFt * 0.092903
  const siteWidthFt = sideLengths[0] || Math.sqrt(areaSqFt) || 30
  const siteDepthFt = sideLengths[1] || (areaSqFt / siteWidthFt) || 40
  const siteWidthM = siteWidthFt * 0.3048
  const siteDepthM = siteDepthFt * 0.3048

  const gbaSetbacks = calculateGBASetbacks({
    siteAreaSqM,
    siteDepthM,
    siteWidthM,
    buildingHeightM,
    hasStilt
  })

  const frontSetbackFt = (gbaSetbacks.front / 0.3048).toFixed(1)
  const rearSetbackFt = (gbaSetbacks.rear / 0.3048).toFixed(1)
  const sideSetbackFt = (((gbaSetbacks.left + gbaSetbacks.right) / 2) / 0.3048).toFixed(1)

  const maxGroundCoverageSqFt = Math.round(areaSqFt * (maxCoveragePct / 100))
  const maxTotalBuiltupAreaSqFt = Math.round(areaSqFt * far)

  const chosenBuiltupArea = Math.min(Math.round(maxGroundCoverageSqFt * selectedFloors), maxTotalBuiltupAreaSqFt * 1.25)

  let verificationStatus = 'green'
  let statusMessage = buildingType === 'commercial' 
    ? 'Commercial zoning checked against GBA arterial road & parking norms.' 
    : 'Your site is suitable for residential construction under GBA Zonal Regulations.'

  if (roadWidthFt < 30 && buildingType === 'commercial') {
    verificationStatus = 'red'
    statusMessage = 'Commercial buildings require a minimum 30ft to 40ft road width under GBA bylaws.'
  } else if (roadWidthFt < 30) {
    verificationStatus = 'yellow'
    statusMessage = 'Road width is below 30 ft. Strict height & setback verification required.'
  }

  return {
    far,
    maxCoveragePct,
    maxGroundCoverageSqFt,
    maxTotalBuiltupAreaSqFt,
    chosenBuiltupArea,
    frontSetback: frontSetbackFt,
    rearSetback: rearSetbackFt,
    sideSetback: sideSetbackFt,
    verificationStatus,
    statusMessage,
    gbaSetbacks,
    siteWidthFt,
    siteDepthFt
  }
}

/* =====================================================
   DYNAMIC CONSTRUCTION COST & BOQ ENGINE
===================================================== */
const calculateConstructionCost = (builtUpSqFt, quality = 'standard', buildingType = 'residential') => {
  const rates = buildingType === 'commercial' 
    ? { basic: 2100, standard: 2700, premium: 3500 }
    : { basic: 1800, standard: 2300, premium: 3000 }

  const baseRate = rates[quality] || rates.standard
  const totalCostINR = builtUpSqFt * baseRate
  const totalCostLakhs = (totalCostINR / 100000).toFixed(2)

  const cementBags = Math.round(builtUpSqFt * 0.42)
  const steelTons = (builtUpSqFt * 0.0038).toFixed(1)
  const sandSqFt = Math.round(builtUpSqFt * 1.8)
  const aggregateSqFt = Math.round(builtUpSqFt * 1.35)
  const bricksCount = Math.round(builtUpSqFt * 8.5)

  return {
    totalCostLakhs,
    baseRate,
    materials: { cementBags, steelTons, sandSqFt, aggregateSqFt, bricksCount },
  }
}

function App() {
  const [currentScreen, setCurrentScreen] = useState('welcome')
  const [selectedTool, setSelectedTool] = useState('analyze')

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const searchContainerRef = useRef(null)

  const [message, setMessage] = useState('')
  const [mapMode, setMapMode] = useState('draw')
  const [tileType, setTileType] = useState('satellite')

  const [plotPoints, setPlotPoints] = useState([])
  const [sideLengths, setSideLengths] = useState([])
  const [calculatedArea, setCalculatedArea] = useState(1200)

  const [roadWidth, setRoadWidth] = useState(30)
  const [buildingType, setBuildingType] = useState('residential')
  const [selectedFloors, setSelectedFloors] = useState(3)
  const [qualityGrade, setQualityGrade] = useState('standard')
  const [buildingHeightM, setBuildingHeightM] = useState(11.5)
  const [hasStilt, setHasStilt] = useState(false)

  const mapRef = useRef(null)
  const mapElementRef = useRef(null)
  const tileLayerRef = useRef(null)
  const polygonLayerRef = useRef(null)
  const markersGroupRef = useRef(null)
  const plotPointsRef = useRef(plotPoints)
  plotPointsRef.current = plotPoints

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const query = searchQuery.trim()
    if (query.length < 2) {
      setSearchResults([])
      setShowSuggestions(false)
      return
    }

    const timer = setTimeout(async () => {
      try {
        const endpoint = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Bengaluru, India')}&limit=5`
        const res = await fetch(endpoint)
        const data = await res.json()
        if (data && data.length > 0) {
          setSearchResults(data)
          setShowSuggestions(true)
        } else {
          setSearchResults([])
          setShowSuggestions(false)
        }
      } catch {
        setSearchResults([])
        setShowSuggestions(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery])

  const loadSamplePlotAndTool = (toolKey) => {
    const samplePoints = [
      { lat: 12.7880, lng: 77.6360 },
      { lat: 12.7880, lng: 77.6361 },
      { lat: 12.7881, lng: 77.6361 },
      { lat: 12.7881, lng: 77.6360 }
    ]
    setPlotPoints(samplePoints)
    setCalculatedArea(1200)
    setSideLengths([30, 40, 30, 40])
    setSelectedTool(toolKey)
    setCurrentScreen('tool-view')
  }

  const handleCardClick = (toolKey) => {
    setSelectedTool(toolKey)
    if (plotPoints.length === 0) {
      loadSamplePlotAndTool(toolKey)
    } else {
      setCurrentScreen('tool-view')
    }
  }

  useEffect(() => {
    if (currentScreen !== 'tool-view') return
    if (!mapElementRef.current) return
    if (mapRef.current) {
      setTimeout(() => mapRef.current?.invalidateSize(), 200)
      return
    }

    const map = L.map(mapElementRef.current, {
      center: [12.788, 77.636],
      zoom: 17,
      zoomControl: true,
      doubleClickZoom: false,
    })

    const satelliteTile = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19 }
    )
    satelliteTile.addTo(map)
    tileLayerRef.current = satelliteTile

    const polygonLayer = L.polygon([], {
      color: '#00ffcc',
      fillColor: '#00ffcc',
      fillOpacity: 0.35,
      weight: 3,
    }).addTo(map)

    const markersGroup = L.layerGroup().addTo(map)
    polygonLayerRef.current = polygonLayer
    markersGroupRef.current = markersGroup
    mapRef.current = map

    if (plotPoints.length > 0) {
      rebuildPlotOverlay(plotPoints)
    }

    setTimeout(() => map.invalidateSize(), 250)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [currentScreen])

  const toggleMapTile = (type) => {
    const map = mapRef.current
    if (!map) return
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current)
    if (type === 'satellite') {
      const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 })
      satellite.addTo(map)
      tileLayerRef.current = satellite
    } else {
      const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 })
      street.addTo(map)
      tileLayerRef.current = street
    }
    setTileType(type)
  }

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handleMapClick = (e) => {
      if (mapMode !== 'draw') return
      const newPoint = { lat: e.latlng.lat, lng: e.latlng.lng }
      const updated = [...plotPointsRef.current, newPoint]
      setPlotPoints(updated)
      rebuildPlotOverlay(updated)
    }
    map.off('click')
    map.on('click', handleMapClick)
  }, [mapMode, currentScreen])

  const rebuildPlotOverlay = (points) => {
    if (!polygonLayerRef.current || !markersGroupRef.current) return
    polygonLayerRef.current.setLatLngs(points.map((p) => [p.lat, p.lng]))
    markersGroupRef.current.clearLayers()

    points.forEach((p, index) => {
      const marker = L.marker([p.lat, p.lng], { draggable: true }).addTo(markersGroupRef.current)
      marker.bindTooltip(`P${index + 1}`, { permanent: true, direction: 'top', offset: [0, -20] })
      marker.on('drag', (event) => {
        const { lat, lng } = event.target.getLatLng()
        const currentPoints = [...plotPointsRef.current]
        currentPoints[index] = { lat, lng }
        setPlotPoints(currentPoints)
        polygonLayerRef.current.setLatLngs(currentPoints.map((pt) => [pt.lat, pt.lng]))
        computeMetrics(currentPoints)
      })
    })
    computeMetrics(points)
  }

  const computeMetrics = (points) => {
    if (points.length < 2) {
      setSideLengths([])
      setCalculatedArea(0)
      setMessage('Click corners on map to measure boundary.')
      return
    }
    const lengths = []
    for (let i = 0; i < points.length; i++) {
      const nextIdx = (i + 1) % points.length
      if (points.length > 2 || i === 0) {
        const distFeet = calculateAccurateDistanceFeet(points[i].lat, points[i].lng, points[nextIdx].lat, points[nextIdx].lng)
        lengths.push(Math.round(distFeet * 10) / 10)
      }
    }
    setSideLengths(lengths)
    if (points.length >= 3) {
      const areaSqFt = calculateAccurateAreaSqFt(points)
      setCalculatedArea(areaSqFt)
      setMessage(`Area: ${areaSqFt.toLocaleString()} sq ft`)
    }
  }

  const clearMap = () => {
    setPlotPoints([])
    setSideLengths([])
    setCalculatedArea(0)
    if (polygonLayerRef.current) polygonLayerRef.current.setLatLngs([])
    if (markersGroupRef.current) markersGroupRef.current.clearLayers()
    setMessage('Plot cleared. Click map to draw new boundary.')
  }

  const selectLocation = (item) => {
    const { lat, lon, display_name } = item
    mapRef.current?.setView([parseFloat(lat), parseFloat(lon)], 17)
    setSearchQuery(display_name.split(',')[0])
    setShowSuggestions(false)
    setMessage('Location found. Draw plot corners on map!')
  }

  const searchLocation = async () => {
    const rawQuery = searchQuery.trim()
    if (!rawQuery) return
    if (searchResults.length > 0) {
      selectLocation(searchResults[0])
      return
    }
    try {
      const endpoint = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(rawQuery + ', Bengaluru, India')}&limit=1`
      const res = await fetch(endpoint)
      const data = await res.json()
      if (data && data.length > 0) {
        selectLocation(data[0])
      }
    } catch {
      setMessage('Search error.')
    }
  }

  const bylaws = calculateGBABylaws(calculatedArea || 1200, roadWidth, sideLengths, buildingHeightM, hasStilt, buildingType, selectedFloors)
  const costs = calculateConstructionCost(bylaws.chosenBuiltupArea, qualityGrade, buildingType)

  return (
    <div className="app">
      <nav className="navbar">
        <div className="brand" onClick={() => setCurrentScreen('welcome')} style={{ cursor: 'pointer' }}>
          🏗️ Bengaluru BuildWise GBA
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="nav-link" onClick={() => setCurrentScreen('welcome')}>Home</button>
          <button className="nav-link" onClick={() => setCurrentScreen('purpose')}>Select Tool</button>
        </div>
      </nav>

      <main>
        {/* SCREEN 1: WELCOME */}
        {currentScreen === 'welcome' && (
          <section className="hero-section">
            <div className="hero-content">
              <div className="hero-text">
                <span className="eyebrow">GBA BENGALURU ZONING & CONSTRUCTION SUITE</span>
                <h1>Smart site planning.<br />Tailored for Residential & Commercial.</h1>
                <p>Select your exact workflow below to analyze site setbacks, plan floors, estimate accurate construction budgets, or verify approvals.</p>
                <div className="hero-actions">
                  <button className="primary-button" onClick={() => setCurrentScreen('purpose')}>Launch Tools →</button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* SCREEN 2: TOOL SELECTION */}
        {currentScreen === 'purpose' && (
          <section className="features-section">
            <div className="section-heading">
              <span>STEP 1 OF 2</span>
              <h2>Choose Your Dedicated Tool</h2>
              <p style={{ color: '#666', marginTop: '6px' }}>Each card opens a workspace linked dynamically to your plot dimensions and floor count.</p>
            </div>

            <div className="feature-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
              
              <div style={{ background: '#fff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 4px 12px rgba(0,0,0,0.04)', textAlign: 'left' }}>
                <div>
                  <div style={{ fontSize: '2rem', background: '#e8f5e9', width: 'fit-content', padding: '10px', borderRadius: '12px', marginBottom: '12px' }}>🗺️</div>
                  <span style={{ fontSize: '0.75rem', padding: '4px 8px', borderRadius: '20px', background: '#e3f2fd', color: '#1565c0', fontWeight: 'bold' }}>Zoning Tool</span>
                  <h3 style={{ margin: '10px 0', color: '#1b4332' }}>Analyze My Site</h3>
                  <p style={{ color: '#555', fontSize: '0.9rem', lineHeight: '1.5' }}>Map satellite boundaries, calculate precise setbacks, and verify GBA road width norms.</p>
                </div>
                <button className="primary-button" style={{ width: '100%', marginTop: '20px', background: '#2e7d32' }} onClick={() => handleCardClick('analyze')}>
                  Open Site Analyzer →
                </button>
              </div>

              <div style={{ background: '#fff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 4px 12px rgba(0,0,0,0.04)', textAlign: 'left' }}>
                <div>
                  <div style={{ fontSize: '2rem', background: '#fff3e0', width: 'fit-content', padding: '10px', borderRadius: '12px', marginBottom: '12px' }}>🏗️</div>
                  <span style={{ fontSize: '0.75rem', padding: '4px 8px', borderRadius: '20px', background: '#fff3e0', color: '#e65100', fontWeight: 'bold' }}>Floor Planner</span>
                  <h3 style={{ margin: '10px 0', color: '#1b4332' }}>Plan My Construction</h3>
                  <p style={{ color: '#555', fontSize: '0.9rem', lineHeight: '1.5' }}>Choose desired floor count, switch between residential & commercial rules, and view FAR capacity.</p>
                </div>
                <button className="primary-button" style={{ width: '100%', marginTop: '20px', background: '#e65100' }} onClick={() => handleCardClick('plan')}>
                  Open Floor Planner →
                </button>
              </div>

              <div style={{ background: '#fff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 4px 12px rgba(0,0,0,0.04)', textAlign: 'left' }}>
                <div>
                  <div style={{ fontSize: '2rem', background: '#e8f5e9', width: 'fit-content', padding: '10px', borderRadius: '12px', marginBottom: '12px' }}>💰</div>
                  <span style={{ fontSize: '0.75rem', padding: '4px 8px', borderRadius: '20px', background: '#e8f5e9', color: '#2e7d32', fontWeight: 'bold' }}>Cost Calculator</span>
                  <h3 style={{ margin: '10px 0', color: '#1b4332' }}>Estimate Construction Cost</h3>
                  <p style={{ color: '#555', fontSize: '0.9rem', lineHeight: '1.5' }}>Get stage-wise civil breakdowns, material BOQ (cement & steel), and quality grade pricing.</p>
                </div>
                <button className="primary-button" style={{ width: '100%', marginTop: '20px', background: '#1565c0' }} onClick={() => handleCardClick('cost')}>
                  Open Cost Estimator →
                </button>
              </div>

              <div style={{ background: '#fff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 4px 12px rgba(0,0,0,0.04)', textAlign: 'left' }}>
                <div>
                  <div style={{ fontSize: '2rem', background: '#f3e5f5', width: 'fit-content', padding: '10px', borderRadius: '12px', marginBottom: '12px' }}>📋</div>
                  <span style={{ fontSize: '0.75rem', padding: '4px 8px', borderRadius: '20px', background: '#f3e5f5', color: '#6a1b9a', fontWeight: 'bold' }}>Compliance</span>
                  <h3 style={{ margin: '10px 0', color: '#1b4332' }}>Check Approvals</h3>
                  <p style={{ color: '#555', fontSize: '0.9rem', lineHeight: '1.5' }}>Verify GBA sanction documents, A-Khata requirements, and commercial/residential NOC rules.</p>
                </div>
                <button className="primary-button" style={{ width: '100%', marginTop: '20px', background: '#6a1b9a' }} onClick={() => handleCardClick('approvals')}>
                  Open Document Checker →
                </button>
              </div>

            </div>
          </section>
        )}

        {/* SCREEN 3: DYNAMIC WORKSPACE VIEW */}
        {currentScreen === 'tool-view' && (
          <section className="location-section">
            <div className="location-container" style={{ maxWidth: '1100px' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <span style={{ fontSize: '0.8rem', color: '#666', fontWeight: 'bold' }}>ACTIVE WORKSPACE</span>
                  <h2 style={{ margin: 0, color: '#1b4332' }}>
                    {selectedTool === 'analyze' && '🗺️ Site & Setback Analyzer'}
                    {selectedTool === 'plan' && '🏗️ Floor & Zoning Planner'}
                    {selectedTool === 'cost' && '💰 Dynamic Construction Cost & BOQ'}
                    {selectedTool === 'approvals' && '📋 Approval & Compliance Checklist'}
                  </h2>
                </div>
                <button className="secondary-button" onClick={() => setCurrentScreen('purpose')}>← Switch Tool</button>
              </div>

              <div style={{ background: '#f8f9fa', padding: '16px', borderRadius: '12px', border: '1px solid #e0e0e0', marginBottom: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '15px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#555' }}>Building Type</label>
                  <select 
                    value={buildingType} 
                    onChange={(e) => setBuildingType(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ccc', marginTop: '4px', fontWeight: 'bold', color: buildingType === 'commercial' ? '#c62828' : '#2e7d32' }}
                  >
                    <option value="residential">🏡 Residential Bylaws</option>
                    <option value="commercial">🏢 Commercial Bylaws</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#555' }}>Floors to Construct</label>
                  <select 
                    value={selectedFloors} 
                    onChange={(e) => setSelectedFloors(Number(e.target.value))}
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ccc', marginTop: '4px' }}
                  >
                    <option value={1}>Ground Floor Only (G)</option>
                    <option value={2}>Ground + 1 Floor (G+1)</option>
                    <option value={3}>Ground + 2 Floors (G+2)</option>
                    <option value={4}>Ground + 3 Floors (G+3)</option>
                    <option value={5}>Stilt + 4 Floors</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#555' }}>Road Width (ft)</label>
                  <input 
                    type="number" 
                    value={roadWidth} 
                    onChange={(e) => setRoadWidth(Number(e.target.value))}
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ccc', marginTop: '4px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#555' }}>Construction Grade</label>
                  <select 
                    value={qualityGrade} 
                    onChange={(e) => setQualityGrade(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ccc', marginTop: '4px' }}
                  >
                    <option value="basic">Basic (₹{buildingType === 'commercial' ? '2100' : '1800'}/sq ft)</option>
                    <option value="standard">Standard (₹{buildingType === 'commercial' ? '2700' : '2300'}/sq ft)</option>
                    <option value="premium">Premium (₹{buildingType === 'commercial' ? '3500' : '3000'}/sq ft)</option>
                  </select>
                </div>
              </div>

              <div style={{ background: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #e0e0e0', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                  <h3 style={{ margin: 0, color: '#1b4332' }}>📍 Interactive Satellite Plot & Measurement Calculator</h3>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="secondary-button" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => toggleMapTile(tileType === 'satellite' ? 'street' : 'satellite')}>
                      Switch to {tileType === 'satellite' ? 'Street View' : 'Satellite'}
                    </button>
                    <button className="secondary-button" style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#ffebee', color: '#c62828' }} onClick={clearMap}>
                      Reset Plot
                    </button>
                  </div>
                </div>

                <div ref={searchContainerRef} style={{ position: 'relative', display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <input 
                    type="text" 
                    placeholder="Search locality in Bengaluru (e.g., Whitefield, Indiranagar)..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => { if (searchResults.length > 0) setShowSuggestions(true) }}
                    style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid #ccc' }}
                  />
                  <button className="primary-button" style={{ padding: '8px 16px' }} onClick={searchLocation}>Search</button>

                  {showSuggestions && searchResults.length > 0 && (
                    <ul style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: '85px',
                      background: '#fff',
                      border: '1px solid #ccc',
                      borderRadius: '0 0 6px 6px',
                      listStyle: 'none',
                      margin: '2px 0 0 0',
                      padding: 0,
                      zIndex: 1000,
                      boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                      maxHeight: '200px',
                      overflowY: 'auto',
                      textAlign: 'left'
                    }}>
                      {searchResults.map((item, idx) => (
                        <li 
                          key={idx}
                          onClick={() => selectLocation(item)}
                          style={{
                            padding: '10px 12px',
                            borderBottom: idx < searchResults.length - 1 ? '1px solid #eee' : 'none',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            color: '#333'
                          }}
                          onMouseEnter={(e) => e.target.style.background = '#f5f5f5'}
                          onMouseLeave={(e) => e.target.style.background = '#fff'}
                        >
                          📍 {item.display_name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div 
                  ref={mapElementRef} 
                  style={{ width: '100%', height: '350px', borderRadius: '8px', border: '1px solid #ccc', marginBottom: '15px' }}
                />

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', background: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
                  <div>
                    <small style={{ color: '#666', fontWeight: 'bold' }}>CALCULATED PLOT AREA</small>
                    <h3 style={{ margin: '4px 0', color: '#2e7d32' }}>{calculatedArea.toLocaleString()} sq ft</h3>
                    <small>({(calculatedArea * 0.092903).toFixed(1)} sq meters)</small>
                  </div>

                  <div>
                    <small style={{ color: '#666', fontWeight: 'bold' }}>SIDE MEASUREMENTS (FT)</small>
                    <p style={{ margin: '4px 0', fontWeight: 'bold' }}>
                      {sideLengths.length > 0 ? sideLengths.join(' ft × ') + ' ft' : 'Click corners on map'}
                    </p>
                  </div>

                  <div>
                    <small style={{ color: '#666', fontWeight: 'bold' }}>MANUAL AREA OVERRIDE</small>
                    <input 
                      type="number" 
                      value={calculatedArea}
                      onChange={(e) => setCalculatedArea(Number(e.target.value))}
                      style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #ccc', marginTop: '4px' }}
                    />
                  </div>
                </div>
              </div>

              {selectedTool === 'analyze' && (
                <div style={{ background: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #e0e0e0' }}>
                  <h3 style={{ marginTop: 0, color: '#1b4332' }}>GBA Setback & Boundary Analysis</h3>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '15px', margin: '15px 0' }}>
                    <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
                      <small style={{ color: '#666' }}>Front Setback</small>
                      <h3 style={{ margin: '5px 0', color: '#2e7d32' }}>{bylaws.frontSetback} ft</h3>
                    </div>
                    <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
                      <small style={{ color: '#666' }}>Rear Setback</small>
                      <h3 style={{ margin: '5px 0', color: '#2e7d32' }}>{bylaws.rearSetback} ft</h3>
                    </div>
                    <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
                      <small style={{ color: '#666' }}>Side Setbacks</small>
                      <h3 style={{ margin: '5px 0', color: '#2e7d32' }}>{bylaws.sideSetback} ft</h3>
                    </div>
                  </div>

                  <div style={{ padding: '15px', borderRadius: '8px', background: bylaws.verificationStatus === 'green' ? '#e8f5e9' : '#ffebee', border: '1px solid #ccc' }}>
                    <strong>Zonal Feasibility:</strong>
                    <p style={{ margin: '4px 0 0' }}>{bylaws.statusMessage}</p>
                  </div>
                </div>
              )}

              {selectedTool === 'plan' && (
                <div style={{ background: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #e0e0e0' }}>
                  <h3 style={{ marginTop: 0, color: '#1b4332' }}>Permissible Floor & Zoning Capacity ({buildingType.toUpperCase()})</h3>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', margin: '15px 0' }}>
                    <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
                      <small style={{ color: '#666' }}>Allowed FAR</small>
                      <h3 style={{ margin: '5px 0', color: '#e65100' }}>{bylaws.far} FAR</h3>
                    </div>
                    <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
                      <small style={{ color: '#666' }}>Max Ground Coverage</small>
                      <h3 style={{ margin: '5px 0', color: '#e65100' }}>{bylaws.maxGroundCoverageSqFt.toLocaleString()} sq ft ({bylaws.maxCoveragePct}%)</h3>
                    </div>
                  </div>

                  <div style={{ background: '#fff3e0', padding: '15px', borderRadius: '8px', marginBottom: '15px' }}>
                    <strong>Selected Plan:</strong> {selectedFloors} Floors yielding <b>{bylaws.chosenBuiltupArea.toLocaleString()} sq ft</b> built-up area.
                  </div>

                  <GBASetbackVisualizer
                    plotWidthFt={bylaws.siteWidthFt}
                    plotDepthFt={bylaws.siteDepthFt}
                    buildingHeightM={buildingHeightM}
                    roadWidthM={roadWidth * 0.3048}
                    hasStilt={hasStilt}
                  />
                </div>
              )}

              {selectedTool === 'cost' && (
                <div style={{ background: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #e0e0e0', textAlign: 'left' }}>
                  <h3 style={{ marginTop: 0, color: '#1b4332' }}>💰 Dynamic Construction Cost & Material BOQ</h3>
                  <p style={{ color: '#555', fontSize: '0.9rem', marginBottom: '20px' }}>
                    Calculated automatically for your site area (<b>{calculatedArea.toLocaleString()} sq ft</b>) and chosen configuration (<b>{selectedFloors} Floors</b> = <b>{bylaws.chosenBuiltupArea.toLocaleString()} sq ft</b> total built-up area).
                  </p>
                  
                  <div style={{ background: '#e8f5e9', padding: '20px', borderRadius: '8px', marginBottom: '25px', border: '1px solid #c8e6c9' }}>
                    <small style={{ color: '#2e7d32', fontWeight: 'bold' }}>TOTAL ESTIMATED CONSTRUCTION COST ({buildingType.toUpperCase()})</small>
                    <h2 style={{ margin: '5px 0', color: '#1b4332', fontSize: '2rem' }}>₹{costs.totalCostLakhs} Lakhs</h2>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#555' }}>
                      Based on <b>{bylaws.chosenBuiltupArea.toLocaleString()} sq ft</b> built-up area at ₹{costs.baseRate}/sq ft ({qualityGrade} quality grade).
                    </p>
                  </div>

                  <h4 style={{ color: '#1b4332', borderBottom: '2px solid #e0e0e0', paddingBottom: '6px', marginBottom: '15px' }}>
                    1. Detailed Stage-Wise Cost Breakdown
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '25px' }}>
                    
                    <div style={{ background: '#f8f9fa', padding: '12px 16px', borderRadius: '8px', borderLeft: '4px solid #2e7d32' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#1b4332' }}>
                        <span>Excavation & Foundation (approx. 12%)</span>
                        <span style={{ color: '#2e7d32' }}>₹{((costs.totalCostLakhs * 0.12)).toFixed(2)} Lakhs</span>
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#555' }}>Earthwork excavation, PCC (Plain Cement Concrete), column footings, plinth beam, and anti-termite treatment.</p>
                    </div>

                    <div style={{ background: '#f8f9fa', padding: '12px 16px', borderRadius: '8px', borderLeft: '4px solid #2e7d32' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#1b4332' }}>
                        <span>Structural Framework & Masonry (approx. 38%)</span>
                        <span style={{ color: '#2e7d32' }}>₹{((costs.totalCostLakhs * 0.38)).toFixed(2)} Lakhs</span>
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#555' }}>RCC columns, beams, slab casting, and brick/block masonry work for all {selectedFloors} floors.</p>
                    </div>

                    <div style={{ background: '#f8f9fa', padding: '12px 16px', borderRadius: '8px', borderLeft: '4px solid #2e7d32' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#1b4332' }}>
                        <span>Plastering & Waterproofing (approx. 10%)</span>
                        <span style={{ color: '#2e7d32' }}>₹{((costs.totalCostLakhs * 0.10)).toFixed(2)} Lakhs</span>
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#555' }}>Internal and external wall plastering, roof waterproofing, and balcony sunken slab treatment.</p>
                    </div>

                    <div style={{ background: '#f8f9fa', padding: '12px 16px', borderRadius: '8px', borderLeft: '4px solid #2e7d32' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#1b4332' }}>
                        <span>Flooring & Wall Tiling (approx. 12%)</span>
                        <span style={{ color: '#2e7d32' }}>₹{((costs.totalCostLakhs * 0.12)).toFixed(2)} Lakhs</span>
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#555' }}>Vrified tile flooring, bathroom wall/floor tiles, granite staircase steps, and parking tile paving.</p>
                    </div>

                    <div style={{ background: '#f8f9fa', padding: '12px 16px', borderRadius: '8px', borderLeft: '4px solid #2e7d32' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#1b4332' }}>
                        <span>Doors, Windows & Railings (approx. 8%)</span>
                        <span style={{ color: '#2e7d32' }}>₹{((costs.totalCostLakhs * 0.08)).toFixed(2)} Lakhs</span>
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#555' }}>Main teak wood door, flush internal doors, UPVC/aluminum windows with glass, and SS/MS balcony railings.</p>
                    </div>

                    <div style={{ background: '#f8f9fa', padding: '12px 16px', borderRadius: '8px', borderLeft: '4px solid #2e7d32' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#1b4332' }}>
                        <span>Electrical & Plumbing (approx. 12%)</span>
                        <span style={{ color: '#2e7d32' }}>₹{((costs.totalCostLakhs * 0.12)).toFixed(2)} Lakhs</span>
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#555' }}>Concealed PVC wiring, distribution boards, switches, internal water supply pipes, drainage lines, and sanitary fixtures.</p>
                    </div>

                    <div style={{ background: '#f8f9fa', padding: '12px 16px', borderRadius: '8px', borderLeft: '4px solid #2e7d32' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#1b4332' }}>
                        <span>Painting & Finishing (approx. 8%)</span>
                        <span style={{ color: '#2e7d32' }}>₹{((costs.totalCostLakhs * 0.08)).toFixed(2)} Lakhs</span>
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#555' }}>Putty work, primer, two coats of interior emulsion, exterior weather-coat paint, and metal gate painting.</p>
                    </div>

                  </div>

                  <h4 style={{ color: '#1b4332', borderBottom: '2px solid #e0e0e0', paddingBottom: '6px', marginBottom: '15px' }}>
                    2. Precise Material Bill of Quantities (BOQ)
                  </h4>
                  <p style={{ color: '#555', fontSize: '0.85rem', marginBottom: '15px' }}>
                    Automatically scaled for <b>{bylaws.chosenBuiltupArea.toLocaleString()} sq ft</b> total built-up construction:
                  </p>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '25px' }}>
                    <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                      <small style={{ color: '#666', fontWeight: 'bold' }}>CEMENT</small>
                      <h3 style={{ margin: '4px 0', color: '#1b4332' }}>~{costs.materials.cementBags.toLocaleString()} Bags</h3>
                      <small style={{ color: '#555' }}>50 kg bags (Grade 43/53 for casting & mortar)</small>
                    </div>

                    <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                      <small style={{ color: '#666', fontWeight: 'bold' }}>STEEL REINFORCEMENT</small>
                      <h3 style={{ margin: '4px 0', color: '#1b4332' }}>~{costs.materials.steelTons} Tons</h3>
                      <small style={{ color: '#555' }}>Fe 500 grade TMT bars for columns & slabs</small>
                    </div>

                    <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                      <small style={{ color: '#666', fontWeight: 'bold' }}>COARSE SAND</small>
                      <h3 style={{ margin: '4px 0', color: '#1b4332' }}>~{costs.materials.sandSqFt.toLocaleString()} cu ft</h3>
                      <small style={{ color: '#555' }}>Used for concrete mixing & brickwork mortar</small>
                    </div>

                    <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                      <small style={{ color: '#666', fontWeight: 'bold' }}>AGGREGATE STONE</small>
                      <h3 style={{ margin: '4px 0', color: '#1b4332' }}>~{costs.materials.aggregateSqFt.toLocaleString()} cu ft</h3>
                      <small style={{ color: '#555' }}>20mm & 40mm stones for structural concrete</small>
                    </div>

                    <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                      <small style={{ color: '#666', fontWeight: 'bold' }}>BRICKS / BLOCKS</small>
                      <h3 style={{ margin: '4px 0', color: '#1b4332' }}>~{costs.materials.bricksCount.toLocaleString()} Units</h3>
                      <small style={{ color: '#555' }}>Standard red clay bricks or solid concrete blocks</small>
                    </div>
                  </div>

                </div>
              )}

              {selectedTool === 'approvals' && (
                <div style={{ background: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #e0e0e0', textAlign: 'left' }}>
                  <h3 style={{ marginTop: 0, color: '#1b4332' }}>3. Clear Legal & Approval Checklist</h3>
                  <p style={{ color: '#555', fontSize: '0.9rem' }}>Verify that your property documents align with local authority requirements before commencing construction.</p>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '15px' }}>
                    <div style={{ background: '#e8f5e9', padding: '12px 16px', borderRadius: '8px', border: '1px solid #c8e6c9' }}>
                      <strong>Title Deed & A-Khata Certificate:</strong>
                      <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#333' }}>Mandatory proof of ownership, tax-paid receipts for the last 3 years, and land use classification.</p>
                    </div>

                    <div style={{ background: '#e8f5e9', padding: '12px 16px', borderRadius: '8px', border: '1px solid #c8e6c9' }}>
                      <strong>Sanctioned Building Plan:</strong>
                      <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#333' }}>Architectural and structural drawings approved by a licensed engineer, ensuring adherence to permissible FAR ({bylaws.far}) and ground coverage ({bylaws.maxCoveragePct}%) limits.</p>
                    </div>

                    <div style={{ background: '#e8f5e9', padding: '12px 16px', borderRadius: '8px', border: '1px solid #c8e6c9' }}>
                      <strong>Setback & Road Widening Clearance:</strong>
                      <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#333' }}>Verification that the building layout leaves mandatory open space ({bylaws.frontSetback}ft front, {bylaws.rearSetback}ft rear) and conforms to {roadWidth}ft road width rules.</p>
                    </div>

                    <div style={{ background: '#e8f5e9', padding: '12px 16px', borderRadius: '8px', border: '1px solid #c8e6c9' }}>
                      <strong>Utility Connections (Temporary Power & Water):</strong>
                      <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#333' }}>Securing a temporary commercial electricity meter for construction machinery (mixers, pumps) and borewell/water tanker supply arrangement.</p>
                    </div>

                    <div style={{ background: '#e8f5e9', padding: '12px 16px', borderRadius: '8px', border: '1px solid #c8e6c9' }}>
                      <strong>Commencement Certificate (CC):</strong>
                      <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#333' }}>Formal intimation submitted to local authorities prior to pouring foundation concrete.</p>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App