# HydroRain — GitHub Pages edition

HydroRain is a static, browser-based teaching tool for comparing arithmetic-mean,
Thiessen-polygon, and isohyetal estimates of watershed-average precipitation.
Students can upload rain-gauge CSV data and a watershed GeoJSON, change the IDW
and grid settings, inspect maps and intermediate calculations, and download the
results. Uploaded files remain in the student's browser.

## Publish it on GitHub Pages

1. Sign in to GitHub and create a new **public** repository. `HydroRain` is a
   good repository name. Do not initialize it with another README.
2. Extract this ZIP and upload **the contents of this folder** to the repository.
   Make sure `.github/workflows/deploy-pages.yml` is included.
3. Open the repository's **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to **GitHub Actions**.
5. Open the **Actions** tab and select **Deploy HydroRain to GitHub Pages**.
   If it is not already running, choose **Run workflow**. When its green check
   mark appears, the Pages settings screen will show the public address.

The address will normally be:

```text
https://YOUR-GITHUB-USERNAME.github.io/HydroRain/
```

You can open that address without a GitHub account and without installing
anything.

## Expected rain-gauge CSV

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
