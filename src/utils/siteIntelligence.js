/*
  Bengaluru BuildWise
  Site Intelligence Engine

  This file keeps site-intelligence calculations separate
  from the React interface.

  IMPORTANT:
  The current version uses preliminary map-based logic.
  Official GIS datasets will be connected later.
*/

export function calculateSiteArea(points) {
  if (!points || points.length < 3) {
    return 0
  }

  const earthRadius = 6371000

  let area = 0

  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const next = points[(i + 1) % points.length]

    const lat1 = (current[0] * Math.PI) / 180
    const lat2 = (next[0] * Math.PI) / 180

    const lon1 = (current[1] * Math.PI) / 180
    const lon2 = (next[1] * Math.PI) / 180

    area +=
      (lon2 - lon1) *
      (2 + Math.sin(lat1) + Math.sin(lat2))
  }

  area =
    Math.abs(area) *
    earthRadius *
    earthRadius /
    2

  return area * 10.7639
}


/*
  Distance between two latitude/longitude points.
  Result is returned in metres.
*/
export function calculateDistanceMeters(
  pointA,
  pointB
) {
  if (!pointA || !pointB) {
    return 0
  }

  const earthRadius = 6371000

  const lat1 =
    (pointA[0] * Math.PI) / 180

  const lat2 =
    (pointB[0] * Math.PI) / 180

  const deltaLat =
    ((pointB[0] - pointA[0]) * Math.PI) / 180

  const deltaLon =
    ((pointB[1] - pointA[1]) * Math.PI) / 180

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLon / 2) ** 2

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )

  return earthRadius * c
}


/*
  Determine approximate plot orientation.

  This is a preliminary geometry helper.
*/
export function calculatePlotOrientation(points) {
  if (!points || points.length < 2) {
    return 'Unknown'
  }

  let north = 0
  let south = 0
  let east = 0
  let west = 0

  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const next = points[(i + 1) % points.length]

    const latitudeDifference =
      next[0] - current[0]

    const longitudeDifference =
      next[1] - current[1]

    if (
      Math.abs(longitudeDifference) >
      Math.abs(latitudeDifference)
    ) {
      if (longitudeDifference > 0) {
        east++
      } else {
        west++
      }
    } else {
      if (latitudeDifference > 0) {
        north++
      } else {
        south++
      }
    }
  }

  const directions = [
    ['North', north],
    ['South', south],
    ['East', east],
    ['West', west],
  ]

  directions.sort((a, b) => b[1] - a[1])

  return directions[0][0]
}


/*
  Preliminary road-width classification.

  Later this will use actual road GIS data.
*/
export function classifyRoadWidth(
  roadWidthFeet
) {
  if (roadWidthFeet < 20) {
    return {
      category: 'Very Narrow',
      severity: 'danger',
      description:
        'Very narrow road. Special planning restrictions may apply.',
    }
  }

  if (roadWidthFeet < 30) {
    return {
      category: 'Narrow',
      severity: 'warning',
      description:
        'Narrow road. Additional building-rule verification may be required.',
    }
  }

  if (roadWidthFeet < 40) {
    return {
      category: 'Standard',
      severity: 'clear',
      description:
        'Standard residential road-width range.',
    }
  }

  if (roadWidthFeet < 60) {
    return {
      category: 'Wide',
      severity: 'clear',
      description:
        'Wide road with potentially different development controls.',
    }
  }

  return {
    category: 'Major Road',
    severity: 'warning',
    description:
      'Major road. Road/building-line and corridor controls should be verified.',
  }
}


/*
  Convert a constraint status into a readable label.
*/
export function getConstraintLabel(
  status
) {
  switch (status) {
    case 'clear':
      return 'No overlap detected'

    case 'nearby':
      return 'Nearby — verify'

    case 'verify':
      return 'Verification required'

    case 'detected':
      return 'Potential constraint detected'

    default:
      return 'Data unavailable'
  }
}


/*
  Generate a preliminary permission checklist.

  IMPORTANT:
  This is NOT a legal determination.
  It is an initial checklist that becomes more precise
  once official GIS and authority datasets are connected.
*/
export function generatePermissionChecklist({
  roadWidth = 30,
  lakeBuffer = 'clear',
  rajakaluve = 'clear',
  metro = 'clear',
  railway = 'clear',
  tod = 'clear',
  htLine = 'clear',
  proposedRoad = 'clear',
  buildingType = 'residential',
}) {
  const permissions = []

  permissions.push({
    id: 'building-permission',
    title: 'Building Permission',
    status: 'required',
    reason:
      'Building construction generally requires approval through the applicable planning authority.',
  })

  permissions.push({
    id: 'road-verification',
    title: 'Road / Building Line Verification',
    status: 'required',
    reason:
      'The road-facing boundary and applicable building line should be verified.',
  })

  if (
    roadWidth < 30 ||
    roadWidth === 30
  ) {
    permissions.push({
      id: 'road-width',
      title: 'Road Width Verification',
      status: 'conditional',
      reason:
        'The detected road width should be confirmed against authoritative records.',
    })
  }

  if (
    lakeBuffer === 'nearby' ||
    lakeBuffer === 'verify' ||
    lakeBuffer === 'detected'
  ) {
    permissions.push({
      id: 'lake-buffer',
      title: 'Lake / Tank Buffer Verification',
      status: 'conditional',
      reason:
        'The site appears to be near a mapped water-body constraint and requires official verification.',
    })
  }

  if (
    rajakaluve === 'nearby' ||
    rajakaluve === 'verify' ||
    rajakaluve === 'detected'
  ) {
    permissions.push({
      id: 'drain-buffer',
      title: 'Storm-Water Drain / Rajakaluve Verification',
      status: 'conditional',
      reason:
        'Drain alignment and applicable buffer restrictions should be verified.',
    })
  }

  if (
    metro === 'nearby' ||
    metro === 'verify' ||
    metro === 'detected'
  ) {
    permissions.push({
      id: 'metro',
      title: 'Metro / Transit Corridor Verification',
      status: 'conditional',
      reason:
        'The site is near a transit corridor and applicable restrictions should be checked.',
    })
  }

  if (
    railway === 'nearby' ||
    railway === 'verify' ||
    railway === 'detected'
  ) {
    permissions.push({
      id: 'railway',
      title: 'Railway Clearance Verification',
      status: 'conditional',
      reason:
        'Railway proximity may trigger additional restrictions or clearances.',
    })
  }

  if (
    tod === 'nearby' ||
    tod === 'verify' ||
    tod === 'detected'
  ) {
    permissions.push({
      id: 'tod',
      title: 'TOD / Land-Use Verification',
      status: 'conditional',
      reason:
        'Transit-oriented development controls should be checked for the site.',
    })
  }

  if (
    htLine === 'nearby' ||
    htLine === 'verify' ||
    htLine === 'detected'
  ) {
    permissions.push({
      id: 'ht-line',
      title: 'Electrical / HT Line Verification',
      status: 'conditional',
      reason:
        'High-voltage line proximity should be verified with the relevant utility authority.',
    })
  }

  if (
    proposedRoad === 'nearby' ||
    proposedRoad === 'verify' ||
    proposedRoad === 'detected'
  ) {
    permissions.push({
      id: 'proposed-road',
      title: 'Proposed Road / Road Widening Verification',
      status: 'conditional',
      reason:
        'Proposed road alignment or widening should be checked before final planning.',
    })
  }

  if (
    buildingType === 'commercial'
  ) {
    permissions.push({
      id: 'commercial',
      title: 'Commercial Use / Trade Compliance',
      status: 'conditional',
      reason:
        'Commercial development may require additional use-specific approvals.',
    })
  }

  return permissions
}


/*
  Main Site Intelligence function.
*/
export function analyzeSite({
  plotPoints = [],
  roadWidthFeet = 30,
  roadSide = 'South',
  constraints = {},
  buildingType = 'residential',
}) {
  const areaSqFt =
    calculateSiteArea(plotPoints)

  const orientation =
    calculatePlotOrientation(plotPoints)

  const roadClassification =
    classifyRoadWidth(roadWidthFeet)

  const permissions =
    generatePermissionChecklist({
      roadWidth: roadWidthFeet,
      lakeBuffer:
        constraints.lakeBuffer || 'clear',
      rajakaluve:
        constraints.rajakaluve || 'clear',
      metro:
        constraints.metro || 'clear',
      railway:
        constraints.railway || 'clear',
      tod:
        constraints.tod || 'clear',
      htLine:
        constraints.htLine || 'clear',
      proposedRoad:
        constraints.proposedRoad || 'clear',
      buildingType,
    })

  return {
    site: {
      areaSqFt: Math.round(areaSqFt),
      roadSide,
      orientation,
      roadWidthFeet,
      roadClassification,
    },

    constraints: {
      lakeBuffer:
        constraints.lakeBuffer || 'clear',

      rajakaluve:
        constraints.rajakaluve || 'clear',

      metro:
        constraints.metro || 'clear',

      railway:
        constraints.railway || 'clear',

      tod:
        constraints.tod || 'clear',

      htLine:
        constraints.htLine || 'clear',

      proposedRoad:
        constraints.proposedRoad || 'clear',
    },

    permissions,

    verificationRequired: true,

    dataNote:
      'Preliminary site intelligence. Official GIS, planning authority and utility records must be verified before construction or approval decisions.',
  }
}