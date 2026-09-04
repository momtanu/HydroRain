# HydroRain — GitHub Pages edition

HydroRain is a static, browser-based teaching tool for comparing arithmetic-mean,
Thiessen-polygon, and isohyetal estimates of watershed-average precipitation.
Students can upload rain-gauge CSV data and a watershed GeoJSON, change the IDW
and grid settings, inspect maps and intermediate calculations, and download the
results. Uploaded files remain in the student's browser.

Link:
https://momtanu.github.io/HydroRain/


## Expected rain-gauge CSV format

```csv
station,latitude,longitude,rainfall_mm
G1,36.035,-79.865,64
G2,36.095,-79.825,78
G3,36.145,-79.760,96
```

Common alternatives such as `name`, `lat`, `lon`, `rainfall`, and
`precipitation_mm` are recognized automatically. A complete example CSV and
watershed GeoJSON are available in `public/sample-data/`.

If no watershed is uploaded, HydroRain constructs a buffered convex hull around
the gauge network.

## Run locally (optional)

Install Node.js 22 or newer, then run:

```bash
npm install
npm run dev
```

Use `npm test` to create and verify the production build.

## License

MIT
