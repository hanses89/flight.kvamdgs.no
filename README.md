# Disc Golf Flight Visualizer

Interactive disc golf flight path visualizer for kvamdgs.no

## Features
- Live disc search (10,000+ discs via discit-api)
- RHBH / LHBH, Backhand / Forehand, Slow / Medium / Hard
- Hyzer / Flat / Anhyzer release angle with hyzer flip detection
- Smooth canvas animation, responsive mobile/desktop

## Physics
Calibrated via coordinate descent regression against 109 reference discs from 14 brands.
Key constants: TURN_K=0.44, FADE_K=0.745

## Files
- src/flight-path-preview.jsx — Main React app
- shopify/section-flight-path.liquid — Shopify Liquid section
- checkpoints/ — v1, v2, v3 snapshots
