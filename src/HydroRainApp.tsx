"use client";

import { ChangeEvent, useMemo, useState } from "react";
import {
  area, bbox, booleanPointInPolygon, buffer, convex, featureCollection,
  intersect, isolines, point, polygon, voronoi,
} from "@turf/turf";
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";
import {
  BookOpen, CheckCircle2, Download, FileUp, FlaskConical,
  RotateCcw, TriangleAlert, Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Gauge = { station: string; latitude: number; longitude: number; rainfall: number };
type ThiessenRow = Gauge & {
  areaKm2: number; fraction: number; weighted: number;
  geometry: Feature<Polygon | MultiPolygon>;
};
type IsohyetRow = {
  lower: number; upper: number; representative: number;
  areaKm2: number; fraction: number; weighted: number;
};
type GridPoint = { x: number; y: number; value: number; inside: boolean };
type Analysis = {
  arithmetic: number; thiessen: number; isohyetal: number;
  thiessenRows: ThiessenRow[]; isohyetRows: IsohyetRow[];
  grid: GridPoint[]; contourLines: FeatureCollection; levels: number[];
  bounds: [number, number, number, number]; watershedAreaKm2: number;
};

const SAMPLE_GAUGES: Gauge[] = [
  { station: "G1", latitude: 36.035, longitude: -79.865, rainfall: 64 },
  { station: "G2", latitude: 36.095, longitude: -79.825, rainfall: 78 },
  { station: "G3", latitude: 36.145, longitude: -79.76, rainfall: 96 },
  { station: "G4", latitude: 36.08, longitude: -79.705, rainfall: 88 },
  { station: "G5", latitude: 36.015, longitude: -79.735, rainfall: 72 },
  { station: "G6", latitude: 36.055, longitude: -79.785, rainfall: 83 },
  { station: "G7", latitude: 36.12, longitude: -79.875, rainfall: 69 },
];
const SAMPLE_WATERSHED = polygon([[[-79.91,36.02],[-79.875,36.155],[-79.785,36.175],[-79.685,36.115],[-79.7,36.015],[-79.79,35.98],[-79.91,36.02]]]);
const COLORS = ["#e8f3ef", "#c4e4dc", "#7dc5bc", "#2f9bad", "#17647c", "#102f4d"];

function formatNumber(value: number, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}
function escapeCsv(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsv(text: string): Gauge[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 4) throw new Error("The CSV needs a header and at least three gauge rows.");
  const split = (line: string) => {
    const values: string[] = []; let current = ""; let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"') { current += '"'; i += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) { values.push(current.trim()); current = ""; }
      else current += char;
    }
    values.push(current.trim()); return values;
  };
  const headers = split(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const find = (names: string[]) => headers.findIndex((header) => names.includes(header));
  const stationIndex = find(["station", "stationid", "name", "id"]);
  const latitudeIndex = find(["latitude", "lat"]);
  const longitudeIndex = find(["longitude", "lon", "lng", "long"]);
  const rainfallIndex = find(["rainfallmm", "precipitationmm", "rainfall", "precipitation", "precipmm", "precip"]);
  if ([latitudeIndex, longitudeIndex, rainfallIndex].some((index) => index < 0)) {
    throw new Error("Use latitude, longitude, and rainfall_mm columns; common variants are accepted.");
  }
  const gauges = lines.slice(1).map((line, rowIndex) => {
    const values = split(line);
    const gauge = {
      station: stationIndex >= 0 ? values[stationIndex] : `G${rowIndex + 1}`,
      latitude: Number(values[latitudeIndex]), longitude: Number(values[longitudeIndex]),
      rainfall: Number(values[rainfallIndex]),
    };
    if (![gauge.latitude, gauge.longitude, gauge.rainfall].every(Number.isFinite)) {
      throw new Error(`Row ${rowIndex + 2} contains a missing or non-numeric value.`);
    }
    return gauge;
  });
  const unique = new Set(gauges.map((g) => `${g.longitude},${g.latitude}`));
  if (gauges.length < 3 || unique.size !== gauges.length) {
    throw new Error("Use at least three gauges with unique coordinates.");
  }
  return gauges;
}

function findWatershed(json: unknown): Feature<Polygon | MultiPolygon> {
  const document = json as { type?: string; features?: Feature[]; geometry?: Polygon | MultiPolygon; coordinates?: Polygon["coordinates"] };
  if (document.type === "FeatureCollection") {
    const match = document.features?.find((feature) => feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon");
    if (match) return match as Feature<Polygon | MultiPolygon>;
  }
  if (document.type === "Feature" && (document.geometry?.type === "Polygon" || document.geometry?.type === "MultiPolygon")) {
    return document as Feature<Polygon | MultiPolygon>;
  }
  if (document.type === "Polygon") return polygon(document.coordinates!);
  throw new Error("The GeoJSON must contain a Polygon or MultiPolygon watershed.");
}

function automaticBoundary(gauges: Gauge[]): Feature<Polygon | MultiPolygon> {
  const points = featureCollection(gauges.map((g) => point([g.longitude, g.latitude])));
  const hull = convex(points);
  if (!hull) throw new Error("A boundary could not be formed from these gauge locations.");
  const buffered = buffer(hull, 5, { units: "kilometers" });
  if (!buffered) throw new Error("A boundary could not be formed from these gauge locations.");
  return buffered as Feature<Polygon | MultiPolygon>;
}

function idw(gauges: Gauge[], x: number, y: number, power: number) {
  let numerator = 0; let denominator = 0;
  for (const gauge of gauges) {
    const dx = (x - gauge.longitude) * Math.cos((y * Math.PI) / 180);
    const dy = y - gauge.latitude; const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < 1e-14) return gauge.rainfall;
    const weight = 1 / Math.pow(Math.sqrt(distanceSquared), power);
    numerator += weight * gauge.rainfall; denominator += weight;
  }
  return numerator / denominator;
}

function runAnalysis(gauges: Gauge[], watershed: Feature<Polygon | MultiPolygon>, idwPower: number, interval: number, resolution: number): Analysis {
  const stationFeatures = featureCollection(gauges.map((g) => point([g.longitude, g.latitude], { station: g.station, rainfall: g.rainfall })));
  const bounds = bbox(watershed) as [number, number, number, number];
  const padX = Math.max((bounds[2] - bounds[0]) * 0.2, 0.01);
  const padY = Math.max((bounds[3] - bounds[1]) * 0.2, 0.01);
  const cells = voronoi(stationFeatures, { bbox: [bounds[0]-padX, bounds[1]-padY, bounds[2]+padX, bounds[3]+padY] });
  const watershedArea = area(watershed); const thiessenRows: ThiessenRow[] = [];
  if (cells) cells.features.forEach((cell) => {
    if (!cell) return;
    const clipped = intersect(featureCollection([cell as Feature<Polygon | MultiPolygon>, watershed]));
    if (!clipped) return;
    const station = String(cell.properties?.station ?? "Gauge");
    const gauge = gauges.find((item) => item.station === station);
    if (!gauge) return;
    const cellArea = area(clipped); const fraction = cellArea / watershedArea;
    thiessenRows.push({ ...gauge, areaKm2: cellArea / 1_000_000, fraction, weighted: gauge.rainfall * fraction, geometry: clipped as Feature<Polygon | MultiPolygon> });
  });
  if (!thiessenRows.length) throw new Error("Thiessen polygons do not overlap the watershed.");
  const clippedAreaTotal = thiessenRows.reduce((sum, row) => sum + row.areaKm2 * 1_000_000, 0);
  thiessenRows.forEach((row) => {
    row.fraction = (row.areaKm2 * 1_000_000) / clippedAreaTotal;
    row.weighted = row.rainfall * row.fraction;
  });

  const nx = resolution;
  const aspect = Math.max(0.35, Math.min(2.5, (bounds[3]-bounds[1])/(bounds[2]-bounds[0])));
  const ny = Math.max(35, Math.round(nx * aspect));
  const grid: GridPoint[] = []; const gridFeatures: Feature<Point>[] = [];
  for (let iy = 0; iy < ny; iy += 1) {
    const y = bounds[1] + ((iy + 0.5) / ny) * (bounds[3] - bounds[1]);
    for (let ix = 0; ix < nx; ix += 1) {
      const x = bounds[0] + ((ix + 0.5) / nx) * (bounds[2] - bounds[0]);
      const value = idw(gauges, x, y, idwPower);
      const inside = booleanPointInPolygon(point([x, y]), watershed);
      grid.push({ x, y, value, inside }); gridFeatures.push(point([x, y], { rainfall: value }));
    }
  }
  const insideValues = grid.filter((cell) => cell.inside).map((cell) => cell.value);
  if (!insideValues.length) throw new Error("No analysis grid cells fall inside the watershed.");
  const minimum = Math.floor(Math.min(...insideValues) / interval) * interval;
  let maximum = Math.ceil(Math.max(...insideValues) / interval) * interval;
  if (maximum <= minimum) maximum = minimum + interval;
  const levels: number[] = [];
  for (let value = minimum; value <= maximum + interval * 0.01; value += interval) levels.push(Number(value.toFixed(6)));
  const counts = Array(levels.length - 1).fill(0) as number[];
  grid.forEach((cell) => {
    if (!cell.inside) return;
    let index = Math.floor((cell.value - minimum) / interval);
    index = Math.max(0, Math.min(counts.length - 1, index)); counts[index] += 1;
  });
  const totalCount = counts.reduce((sum, value) => sum + value, 0);
  const isohyetRows = counts.map((count, index) => {
    const fraction = count / totalCount; const lower = levels[index]; const upper = levels[index + 1];
    const representative = (lower + upper) / 2;
    return { lower, upper, representative, areaKm2: fraction * watershedArea / 1_000_000, fraction, weighted: fraction * representative };
  }).filter((row) => row.fraction > 0);
  let contourLines: FeatureCollection = featureCollection([]);
  try { contourLines = isolines(featureCollection(gridFeatures), levels, { zProperty: "rainfall" }); } catch { /* table remains valid */ }
  return {
    arithmetic: gauges.reduce((sum, g) => sum + g.rainfall, 0) / gauges.length,
    thiessen: thiessenRows.reduce((sum, row) => sum + row.weighted, 0),
    isohyetal: isohyetRows.reduce((sum, row) => sum + row.weighted, 0),
    thiessenRows, isohyetRows, grid, contourLines, levels, bounds,
    watershedAreaKm2: watershedArea / 1_000_000,
  };
}

function geometryPaths(feature: Feature<Polygon | MultiPolygon>, project: (coordinate: number[]) => [number, number]) {
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  return polygons.map((rings) => rings.map((ring) => ring.map((coordinate, index) => {
    const [x, y] = project(coordinate); return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ") + " Z").join(" "));
}

function MapPanel({ mode, gauges, watershed, analysis }: {
  mode: "gauges" | "thiessen" | "isohyetal"; gauges: Gauge[];
  watershed: Feature<Polygon | MultiPolygon>; analysis: Analysis;
}) {
  const width = 620, height = 430, margin = 25;
  const [minX, minY, maxX, maxY] = analysis.bounds;
  const project = (coordinate: number[]): [number, number] => [
    margin + ((coordinate[0]-minX)/(maxX-minX))*(width-margin*2),
    height-margin-((coordinate[1]-minY)/(maxY-minY))*(height-margin*2),
  ];
  const colorFor = (value: number) => {
    const low = analysis.levels[0], high = analysis.levels.at(-1) ?? low + 1;
    const index = Math.max(0, Math.min(COLORS.length-1, Math.floor(((value-low)/(high-low))*COLORS.length)));
    return COLORS[index];
  };
  const cellSize = Math.max(2, (width-margin*2)/Math.sqrt(analysis.grid.length));
  return <div className="map-shell">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${mode} precipitation map`}>
      <defs><clipPath id={`watershed-${mode}`}>{geometryPaths(watershed, project).map((d,i)=><path d={d} key={i}/>)}</clipPath></defs>
      <rect width={width} height={height} className="map-background" rx="18"/>
      {mode === "thiessen" && analysis.thiessenRows.map((row) => geometryPaths(row.geometry, project).map((d,i)=><path d={d} fill={colorFor(row.rainfall)} className="thiessen-cell" key={`${row.station}-${i}`}/>))}
      {mode === "isohyetal" && <g clipPath={`url(#watershed-${mode})`}>
        {analysis.grid.filter((cell)=>cell.inside).map((cell,i)=>{ const [x,y]=project([cell.x,cell.y]); return <rect key={i} x={x-cellSize} y={y-cellSize} width={cellSize*2.15} height={cellSize*2.15} fill={colorFor(cell.value)}/>; })}
        {analysis.contourLines.features.map((line,i)=>{
          if (line.geometry.type !== "MultiLineString" && line.geometry.type !== "LineString") return null;
          const groups = line.geometry.type === "LineString" ? [line.geometry.coordinates] : line.geometry.coordinates;
          return groups.map((coordinates,j)=><polyline key={`${i}-${j}`} points={coordinates.map((c)=>project(c).join(",")).join(" ")} className="contour-line"/>);
        })}
      </g>}
      {geometryPaths(watershed, project).map((d,i)=><path d={d} className="watershed-outline" key={i}/>)}
      {gauges.map((g)=>{ const [x,y]=project([g.longitude,g.latitude]); return <g key={g.station}><circle cx={x} cy={y} r="6" className="gauge-dot"/><text x={x+9} y={y-8} className="gauge-label">{g.station} · {formatNumber(g.rainfall,0)} mm</text></g>; })}
    </svg>
    <div className="legend" aria-label="Precipitation legend">
      {COLORS.map((color,index)=>{ const low=analysis.levels[0], high=analysis.levels.at(-1)??low+1; const value=low+((index+0.5)/COLORS.length)*(high-low); return <span key={color}><i style={{background:color}}/> {formatNumber(value,0)}</span>; })}<b>mm</b>
    </div>
  </div>;
}

function downloadText(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type }); const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = href; anchor.download = filename; anchor.click(); URL.revokeObjectURL(href);
}

export function HydroRainApp() {
  const [gauges, setGauges] = useState(SAMPLE_GAUGES);
  const [uploadedBoundary, setUploadedBoundary] = useState<Feature<Polygon | MultiPolygon> | null>(SAMPLE_WATERSHED);
  const [dataName, setDataName] = useState("Demonstration storm");
  const [boundaryName, setBoundaryName] = useState("Included watershed");
  const [power, setPower] = useState(2), [interval, setInterval] = useState(10), [resolution, setResolution] = useState(72);
  const [status, setStatus] = useState<{type:"ok"|"error";text:string}>({type:"ok",text:"Sample data loaded — replace either file when ready."});
  const watershed = useMemo(()=>uploadedBoundary ?? automaticBoundary(gauges),[uploadedBoundary,gauges]);
  const analysisResult = useMemo(()=>{ try { return { analysis:runAnalysis(gauges,watershed,power,interval,resolution), error:"" }; } catch(error) { return {analysis:null,error:error instanceof Error?error.message:"Analysis failed."}; } },[gauges,watershed,power,interval,resolution]);

  const handleGaugeUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file=event.target.files?.[0]; if(!file)return;
    try { const parsed=parseCsv(await file.text()); setGauges(parsed); setUploadedBoundary(null); setDataName(file.name); setBoundaryName("Automatic buffered gauge boundary"); setStatus({type:"ok",text:`${parsed.length} gauges loaded successfully.`}); }
    catch(error){ setStatus({type:"error",text:error instanceof Error?error.message:"CSV upload failed."}); }
  };
  const handleBoundaryUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file=event.target.files?.[0]; if(!file)return;
    try { setUploadedBoundary(findWatershed(JSON.parse(await file.text()))); setBoundaryName(file.name); setStatus({type:"ok",text:"Watershed loaded successfully."}); }
    catch(error){ setStatus({type:"error",text:error instanceof Error?error.message:"GeoJSON upload failed."}); }
  };
  const reset=()=>{ setGauges(SAMPLE_GAUGES);setUploadedBoundary(SAMPLE_WATERSHED);setDataName("Demonstration storm");setBoundaryName("Included watershed");setPower(2);setInterval(10);setResolution(72);setStatus({type:"ok",text:"Sample data restored."}); };
  const downloadTemplate=()=>downloadText("hydrorain-gauge-template.csv","station,latitude,longitude,rainfall_mm\nG1,36.035,-79.865,64\nG2,36.095,-79.825,78\nG3,36.145,-79.760,96\n","text/csv;charset=utf-8");
  const downloadResults=()=>{
    const result=analysisResult.analysis;if(!result)return;
    const lines=["HYDRORAIN METHOD COMPARISON","method,watershed_average_mm",`Arithmetic mean,${result.arithmetic.toFixed(4)}`,`Thiessen polygon,${result.thiessen.toFixed(4)}`,`Isohyetal,${result.isohyetal.toFixed(4)}`,"","THIESSEN WEIGHTS","station,rainfall_mm,area_km2,area_fraction,weighted_rainfall_mm",...result.thiessenRows.map(r=>[r.station,r.rainfall,r.areaKm2,r.fraction,r.weighted].map(escapeCsv).join(",")),"","ISOHYETAL BANDS","lower_mm,upper_mm,representative_mm,area_km2,area_fraction,weighted_rainfall_mm",...result.isohyetRows.map(r=>[r.lower,r.upper,r.representative,r.areaKm2,r.fraction,r.weighted].map(escapeCsv).join(",")),"","SETTINGS",`gauge_file,${escapeCsv(dataName)}`,`watershed,${escapeCsv(boundaryName)}`,`idw_power,${power}`,`grid_resolution,${resolution}`,`isohyet_interval_mm,${interval}`];
    downloadText("hydrorain-results.csv",lines.join("\n"),"text/csv;charset=utf-8");
  };
  const analysis=analysisResult.analysis;
  return <main className="app-frame">
    <header className="topbar"><div className="brand-mark" aria-hidden="true"><span/><span/><span/></div><div><p className="eyebrow">Watershed precipitation laboratory</p><h1>HydroRain</h1></div><div className="header-actions"><Button variant="ghost" onClick={downloadTemplate}><Download/> CSV template</Button><Button variant="outline" onClick={reset}><RotateCcw/> Reset sample</Button></div></header>
    <div className="workspace">
      <aside className="control-panel">
        <section><div className="section-heading"><span>01</span><div><h2>Load observations</h2><p>All processing stays in this browser.</p></div></div>
          <label className="upload-card" htmlFor="gauge-upload"><FileUp/><span><strong>Rain-gauge CSV</strong><small>{dataName}</small></span><Upload/></label><Input id="gauge-upload" className="sr-only" type="file" accept=".csv,text/csv" onChange={handleGaugeUpload}/>
          <label className="upload-card" htmlFor="boundary-upload"><FileUp/><span><strong>Watershed GeoJSON</strong><small>{boundaryName}</small></span><Upload/></label><Input id="boundary-upload" className="sr-only" type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={handleBoundaryUpload}/>
          <div className={`status-message ${status.type}`}>{status.type==="ok"?<CheckCircle2/>:<TriangleAlert/>}<span>{status.text}</span></div>
        </section>
        <section><div className="section-heading"><span>02</span><div><h2>Set analysis</h2><p>Change settings to test sensitivity.</p></div></div>
          <div className="control-group"><div className="control-label"><label htmlFor="idw-power">IDW power</label><output>{power.toFixed(1)}</output></div><Slider id="idw-power" min={0.5} max={5} step={0.5} value={[power]} onValueChange={(v)=>setPower(v[0])}/></div>
          <div className="control-group"><div className="control-label"><label>Grid resolution</label><output>{resolution} × adaptive</output></div><Slider min={45} max={110} step={5} value={[resolution]} onValueChange={(v)=>setResolution(v[0])}/></div>
          <div className="control-group"><label>Isohyet interval</label><Select value={String(interval)} onValueChange={(v)=>setInterval(Number(v))}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent>{[2,5,10,15,20,25].map(v=><SelectItem key={v} value={String(v)}>{v} mm</SelectItem>)}</SelectContent></Select></div>
        </section>
        <div className="method-note"><BookOpen/><p>Compare methods, then explain how station placement and interpolation affect the watershed average.</p></div>
      </aside>
      <section className="results-panel">{analysis ? <>
        <div className="result-heading"><div><p className="eyebrow">Current storm · {gauges.length} gauges</p><h2>Watershed-average precipitation</h2></div><Button onClick={downloadResults}><Download/> Download results</Button></div>
        <div className="metric-grid">{[["Arithmetic mean",analysis.arithmetic,"Equal station weights"],["Thiessen polygon",analysis.thiessen,"Area-weighted stations"],["Isohyetal",analysis.isohyetal,"Area between isohyets"]].map(([label,value,description],i)=><article className={`metric-card method-${i+1}`} key={String(label)}><span>{label}</span><strong>{formatNumber(Number(value))}<small> mm</small></strong><p>{description}</p></article>)}</div>
        <Tabs defaultValue="thiessen" className="analysis-tabs"><TabsList><TabsTrigger value="gauges">Gauge network</TabsTrigger><TabsTrigger value="thiessen">Thiessen</TabsTrigger><TabsTrigger value="isohyetal">Isohyetal</TabsTrigger></TabsList><TabsContent value="gauges"><MapPanel mode="gauges" gauges={gauges} watershed={watershed} analysis={analysis}/></TabsContent><TabsContent value="thiessen"><MapPanel mode="thiessen" gauges={gauges} watershed={watershed} analysis={analysis}/></TabsContent><TabsContent value="isohyetal"><MapPanel mode="isohyetal" gauges={gauges} watershed={watershed} analysis={analysis}/></TabsContent></Tabs>
        <div className="details-grid"><DataTable title="Thiessen calculation" eyebrow="Area weights" formula="P̄ = Σ(Aᵢ/A)Pᵢ" headings={["Gauge","Rainfall","Area","Weight","Contribution"]} rows={analysis.thiessenRows.map(r=>[r.station,`${formatNumber(r.rainfall,1)} mm`,`${formatNumber(r.areaKm2,2)} km²`,`${formatNumber(r.fraction*100,1)}%`,`${formatNumber(r.weighted,2)} mm`])}/><DataTable title="Isohyetal calculation" eyebrow="Contour bands" formula="P̄ = Σ(Aⱼ/A)P̄ⱼ" headings={["Band","Representative","Area","Weight","Contribution"]} rows={analysis.isohyetRows.map(r=>[`${r.lower}–${r.upper} mm`,`${formatNumber(r.representative,1)} mm`,`${formatNumber(r.areaKm2,2)} km²`,`${formatNumber(r.fraction*100,1)}%`,`${formatNumber(r.weighted,2)} mm`])}/></div>
        <footer className="analysis-footer"><FlaskConical/><span>Watershed area: <b>{formatNumber(analysis.watershedAreaKm2,2)} km²</b>. Isohyetal areas are grid approximations; report the grid, interval, and IDW power with your result.</span></footer>
      </> : <div className="error-state"><TriangleAlert/><h2>Analysis could not be completed</h2><p>{analysisResult.error}</p><Button onClick={reset}>Restore sample data</Button></div>}</section>
    </div>
  </main>;
}

function DataTable({title,eyebrow,formula,headings,rows}:{title:string;eyebrow:string;formula:string;headings:string[];rows:string[][]}) {
  return <section className="data-card"><div className="card-title"><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div><code>{formula}</code></div><div className="table-wrap"><table><thead><tr>{headings.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{j===0?<b>{cell}</b>:cell}</td>)}</tr>)}</tbody></table></div></section>;
}
