/**
 * Greater Bengaluru Authority (GBA) Zonal Regulations
 * Setback & Height Calculation Engine
 */

export function calculateGBASetbacks({ siteAreaSqM, siteDepthM, siteWidthM, buildingHeightM, hasStilt = false }) {
  const effectiveHeight = (hasStilt && buildingHeightM <= 15.0) ? Math.max(0, buildingHeightM - 3.0) : buildingHeightM;

  const isSmallPlot15mEligible = siteAreaSqM <= 250 && buildingHeightM <= 15.0;
  const isTable8Eligible = (effectiveHeight <= 12.0) || isSmallPlot15mEligible;

  let front = 0, rear = 0, left = 0, right = 0;

  if (isTable8Eligible) {
    if (siteAreaSqM <= 60) {
      front = 0.75;
      rear = 0.00;
      left = 0.60;
      right = 0.00;
    } else if (siteAreaSqM > 60 && siteAreaSqM <= 150) {
      front = 0.90;
      rear = 0.70;
      left = 0.70;
      right = 0.70;
    } else if (siteAreaSqM > 150 && siteAreaSqM <= 250) {
      front = 1.00;
      rear = 0.80;
      left = 0.80;
      right = 0.80;
    } else if (siteAreaSqM > 250 && siteAreaSqM <= 4000) {
      front = 0.12 * siteDepthM;
      rear = 0.08 * siteDepthM;
      left = 0.08 * siteWidthM;
      right = 0.08 * siteWidthM;
    } else {
      front = 5.00;
      rear = 5.00;
      left = 5.00;
      right = 5.00;
    }
  } else {
    front = getGBATable9Setback(buildingHeightM, 'front');
    rear = getGBATable9Setback(buildingHeightM, 'rear');
    left = getGBATable9Setback(buildingHeightM, 'side');
    right = getGBATable9Setback(buildingHeightM, 'side');
  }

  return { front, rear, left, right, isTable8Eligible };
}

function getGBATable9Setback(heightM, sideType) {
  if (heightM <= 15.0) return sideType === 'front' ? 1.50 : 1.00;
  if (heightM <= 18.0) return 6.00;
  if (heightM <= 21.0) return 7.00;
  if (heightM <= 24.0) return 8.00;
  if (heightM <= 27.0) return 9.00;
  if (heightM <= 30.0) return 10.00;
  if (heightM <= 35.0) return 11.00;
  if (heightM <= 40.0) return 12.00;
  if (heightM <= 45.0) return 13.00;
  if (heightM <= 50.0) return 14.00;
  return 16.00;
}