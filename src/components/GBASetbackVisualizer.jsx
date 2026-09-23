import React, { useRef, useEffect } from 'react';
import { calculateGBASetbacks } from '../utils/gbaRules';

export default function GBASetbackVisualizer({ plotWidthFt = 30, plotDepthFt = 40, buildingHeightM = 11.5, roadWidthM = 9.0, hasStilt = false }) {
  const canvasRef = useRef(null);

  const siteWidthM = plotWidthFt * 0.3048;
  const siteDepthM = plotDepthFt * 0.3048;
  const siteAreaSqM = siteWidthM * siteDepthM;

  const setbacks = calculateGBASetbacks({ siteAreaSqM, siteDepthM, siteWidthM, buildingHeightM, hasStilt });

  const buildableWidthM = Math.max(0, siteWidthM - setbacks.left - setbacks.right);
  const buildableDepthM = Math.max(0, siteDepthM - setbacks.front - setbacks.rear);
  const buildableAreaSqFt = (buildableWidthM / 0.3048) * (buildableDepthM / 0.3048);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const padding = 30;
    const availW = canvas.width - padding * 2;
    const availH = canvas.height - padding * 2;

    const scale = Math.min(availW / (siteWidthM || 1), availH / (siteDepthM || 1));

    const plotW = siteWidthM * scale;
    const plotH = siteDepthM * scale;
    const plotX = (canvas.width - plotW) / 2;
    const plotY = (canvas.height - plotH) / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Plot Border
    ctx.strokeStyle = '#1e3a8a';
    ctx.lineWidth = 2;
    ctx.strokeRect(plotX, plotY, plotW, plotH);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(plotX, plotY, plotW, plotH);

    // Setback Footprint
    const insetLeft = setbacks.left * scale;
    const insetRight = setbacks.right * scale;
    const insetFront = setbacks.front * scale;
    const insetRear = setbacks.rear * scale;

    const bX = plotX + insetLeft;
    const bY = plotY + insetFront;
    const bW = plotW - (insetLeft + insetRight);
    const bH = plotH - (insetFront + insetRear);

    if (bW > 0 && bH > 0) {
      ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
      ctx.fillRect(bX, bY, bW, bH);
      ctx.strokeStyle = '#059669';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(bX, bY, bW, bH);
      ctx.setLineDash([]);
    }
  }, [plotWidthFt, plotDepthFt, buildingHeightM, roadWidthM, setbacks, siteWidthM, siteDepthM]);

  return (
    <div style={{ padding: '15px', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', marginTop: '15px' }}>
      <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '10px', color: '#1e293b' }}>
        GBA 2026 Setback Footprint
      </h3>
      <canvas ref={canvasRef} width={320} height={240} style={{ background: '#f8fafc', display: 'block', margin: '0 auto', borderRadius: '6px' }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '12px', fontSize: '12px', color: '#334155' }}>
        <div><strong>Front Setback:</strong> {setbacks.front.toFixed(2)}m</div>
        <div><strong>Rear Setback:</strong> {setbacks.rear.toFixed(2)}m</div>
        <div><strong>Left Setback:</strong> {setbacks.left.toFixed(2)}m</div>
        <div><strong>Right Setback:</strong> {setbacks.right.toFixed(2)}m</div>
      </div>
      <div style={{ marginTop: '10px', padding: '8px 12px', background: '#ecfdf5', color: '#065f46', fontSize: '13px', borderRadius: '6px', textAlign: 'center' }}>
        <strong>Buildable Area:</strong> ~{Math.round(buildableAreaSqFt)} sq. ft.
      </div>
    </div>
  );
}