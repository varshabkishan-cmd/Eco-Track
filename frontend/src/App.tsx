import { useEffect, useMemo, useState } from "react";
import "./App.css";
const API = "http://127.0.0.1:8000";
const AI_API = "http://127.0.0.1:8001";
const authHeaders = () => {
    const t = localStorage.getItem("ecotrack_token");
    return t ? { Authorization: `Bearer ${t}` } : {};
};
type T = "Energy" | "Fuel" | "Resource";
type Row = {
    id: number;
    type: T;
    quantity: number;
    unit: string;
    date: string;
    emission: number;
    source?: string;
    asset_tag?: string;
};
type Summary = {
    total_records: number;
    total_emission_kg: number;
    energy_usage: number;
    fuel_usage: number;
    resource_usage: number;
};
type CurrentUser = {
    username: string;
    role: string;
};
type AuditLog = {
    id: number;
    username: string;
    action: string;
    entity: string;
    details: string;
    created_at: string | null;
};
type Detection = {
    class: number;
    confidence: number;
    box: number[];
};
type AIResult = {
    width: number;
    height: number;
    preprocessed: string;
    detections: Detection[];
    vehicle_counts?: Record<string, number>;
    vehicle_total?: number;
    note?: string;
};
type AIHealth = {
    service: string;
    opencv: string;
    model_loaded: boolean;
};
const classNames: Record<number, string> = { 0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 4: "airplane", 5: "bus", 6: "train", 7: "truck", 8: "boat", 9: "traffic light", };
/* =========================================================    MAIN APP ========================================================= */ function App() {
    const [token, setToken] = useState(localStorage.getItem("ecotrack_token") || "");
    const [login, setLogin] = useState({ username: "admin", password: "admin123", });
    const [rows, setRows] = useState<Row[]>([]);
    const [sum, setSum] = useState<Summary>({ total_records: 0, total_emission_kg: 0, energy_usage: 0, fuel_usage: 0, resource_usage: 0, });
    const [type, setType] = useState<T>("Energy");
    const [qty, setQty] = useState("");
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const [tag, setTag] = useState("");
    const [page, setPage] = useState("Dashboard");
    const [live, setLive] = useState(false);
    const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
    // Excel dataset import (additional feature only)
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importing, setImporting] = useState(false);
    const [importMessage, setImportMessage] = useState("");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    /* =========================      LOGIN   ========================= */ async function doLogin() {
        const body = new URLSearchParams({ username: login.username, password: login.password, });
        try {
            const r = await fetch(`${API}/auth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", }, body, });
            if (!r.ok) {
                alert("Login failed");
                return;
            }
            const d = await r.json();
            localStorage.setItem("ecotrack_token", d.access_token);
            setToken(d.access_token);
        }
        catch {
            alert("Backend is not running. Start FastAPI on port 8000.");
        }
    } /* =========================      LOAD DASHBOARD DATA   ========================= */
    async function load() {
        if (!token)
            return;
        try {
            const [a, b] = await Promise.all([fetch(`${API}/consumptions`, { headers, }), fetch(`${API}/summary`, { headers, }),]);
            if (a.status === 401) {
                localStorage.removeItem("ecotrack_token");
                setToken("");
                return;
            }
            if (a.ok) {
                setRows(await a.json());
            }
            if (b.ok) {
                setSum(await b.json());
            }
        }
        catch {
            console.log("Backend unavailable");
        }
    }
    useEffect(() => {
        if (!token) {
            setCurrentUser(null);
            return;
        }
        fetch(`${API}/me`, { headers }).then((r) => (r.ok ? r.json() : null)).then((d) => setCurrentUser(d)).catch(() => setCurrentUser(null));
        load();
    }, [token]);
    /* =========================      WEBSOCKET   ========================= */ useEffect(() => {
        if (!token)
            return;
        const ws = new WebSocket("ws://127.0.0.1:8000/ws/updates");
        ws.onopen = () => {
            setLive(true);
        };
        ws.onclose = () => {
            setLive(false);
        };
        ws.onmessage = () => {
            load();
        };
        return () => ws.close();
    }, [token]);
    /* =========================      ADD CONSUMPTION   ========================= */ async function add() {
        if (!qty || Number(qty) <= 0) {
            alert("Enter a positive quantity");
            return;
        }
        const unit = type === "Energy" ? "kWh" : type === "Fuel" ? "Litres" : "Units";
        try {
            const r = await fetch(`${API}/consumptions`, { method: "POST", headers: { "Content-Type": "application/json", ...headers, }, body: JSON.stringify({ type, quantity: Number(qty), unit, date, source: tag ? "rfid/barcode" : "manual", asset_tag: tag || null, }), });
            if (!r.ok) {
                alert("Could not save consumption");
                return;
            }
            setQty("");
            setTag("");
            load();
        }
        catch {
            alert("Backend is not running");
        }
    }
    async function importExcel() {
        if (!importFile) {
            setImportMessage("Please choose an Excel .xlsx file first.");
            return;
        }
        if (!importFile.name.toLowerCase().endsWith(".xlsx")) {
            setImportMessage("Please select an .xlsx Excel file.");
            return;
        }
        const formData = new FormData();
        formData.append("file", importFile);
        setImporting(true);
        setImportMessage("");
        try {
            const response = await fetch(`${API}/import/excel`, {
                method: "POST",
                headers,
                body: formData,
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                setImportMessage(typeof data.detail === "string"
                    ? data.detail
                    : `Import failed (HTTP ${response.status}).`);
                return;
            }
            setImportMessage(data.message || "Excel dataset imported successfully.");
            setImportFile(null);
            const fileInput = document.getElementById("ecotrack-excel-file") as HTMLInputElement | null;
            if (fileInput)
                fileInput.value = "";
            await load();
        }
        catch {
            setImportMessage("Could not connect to the EcoTrack backend.");
        }
        finally {
            setImporting(false);
        }
    }
    /* =========================      DELETE   ========================= */ async function del(id: number) {
        if (!confirm("Delete this record?")) {
            return;
        }
        try {
            await fetch(`${API}/consumptions/${id}`, { method: "DELETE", headers, });
            load();
        }
        catch {
            alert("Could not delete record");
        }
    } /* =========================      LOGIN SCREEN   ========================= */
    if (!token) {
        return (<div className="login">         <div className="login-card">           <div className="brand">             🌱 EcoTrack           </div>            <h1>             Enterprise Sustainability Platform           </h1>            <p>Secure OAuth2 access</p>            <input value={login.username} onChange={(e) => setLogin({ ...login, username: e.target.value, })} placeholder="Username"/>            <input type="password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value, })} placeholder="Password"/>            <button onClick={doLogin}>             Sign in           </button>            <small>             Demo: admin / admin123           </small>         </div>       </div>);
    } /* =========================      APPLICATION   ========================= */
    return (<div className="app">       <aside>         <div className="brand">           🌱 EcoTrack         </div>          <div className="nav">           {["Dashboard", "Energy", "Fuel", "Resources", "AI Monitoring", "Assets", "ZPL Labels", "Reports", "Compliance", ...(currentUser?.role === "admin" ? ["Audit Logs"] : []),].map((x) => (<button className={page === x ? "active" : ""} onClick={() => setPage(x)} key={x}>               {x}             </button>))}         </div>          <div className="live">           <span className={live ? "dot" : ""}>             ●           </span>{" "}           {live ? "Live WebSocket" : "Offline"}         </div>          <button onClick={() => {
            localStorage.removeItem("ecotrack_token");
            setToken("");
        }}>           Sign out         </button>       </aside>        <main>         <header>           <div>             <h1>{page}</h1>              <p>               Centralized environmental impact               monitoring and compliance.             </p>           </div>            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>             <div className="pill">{live ? "REAL-TIME" : "CONNECTING"}</div>             <div className="pill" style={{ background: currentUser?.role === "admin" ? "#dcfce7" : "#e0f2fe" }}>               {currentUser?.username || "user"} • {currentUser?.role || "unknown"}             </div>           </div>         </header>          {/* =================================================             DASHBOARD         ================================================= */}          {page === "Dashboard" && (<>             <section className="cards">               <Card t="Total Emissions" v={`${sum.total_emission_kg.toFixed(2)} kg CO₂`}/>                <Card t="Energy" v={`${sum.energy_usage} kWh`}/>                <Card t="Fuel" v={`${sum.fuel_usage} L`}/>                <Card t="Resources" v={`${sum.resource_usage} units`}/>             </section>              <CarbonEmissionChart rows={rows}/>              <CategoryCarbonAnalytics rows={rows}/>              <CarbonIntelligence rows={rows}/>              <section className="panel">               <h2>Add Consumption</h2>                <div className="form">                 <select value={type} onChange={(e) => setType(e.target.value as T)}>                   <option>                     Energy                   </option>                    <option>                     Fuel                   </option>                    <option>                     Resource                   </option>                 </select>                  <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Quantity"/>                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)}/>                  <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Barcode / RFID tag (optional)"/>                  <button onClick={add}>                   + Record                 </button>               </div>             </section>

            {/* EXCEL IMPORT — additive panel; existing dashboard remains unchanged */}
            <section className="panel">
              <div className="title-row">
                <div>
                  <h2>Import EcoTrack Dataset</h2>
                  <p>Upload an Excel workbook containing consumption, assets, scan history, AI detections and audit logs.</p>
                </div>
              </div>
              <div className="form">
                <input id="ecotrack-excel-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}/>
                <button onClick={importExcel} disabled={!importFile || importing}>
                  {importing ? "Importing..." : "Import Dataset"}
                </button>
              </div>
              {importFile && <p>Selected file: <strong>{importFile.name}</strong></p>}
              {importMessage && <p role="status">{importMessage}</p>}
            </section>

            <section className="panel">               <div className="title-row">                 <h2>                   Consumption Records                 </h2>                  <button onClick={load}>                   Refresh                 </button>               </div>                <table>                 <thead>                   <tr>                     <th>Type</th>                     <th>Quantity</th>                     <th>Date</th>                     <th>CO₂ kg</th>                     <th>Source</th>                     <th>Action</th>                   </tr>                 </thead>                  <tbody>                   {rows.map((r) => (<tr key={r.id}>                       <td>{r.type}</td>                        <td>                         {r.quantity} {r.unit}                       </td>                        <td>{r.date}</td>                        <td>                         {r.emission.toFixed(2)}                       </td>                        <td>                         {r.source}                       </td>                        <td>                         {currentUser?.role === "admin" ? (<button className="danger" onClick={() => del(r.id)}>Delete</button>) : (<span style={{ color: "#64748b" }}>View only</span>)}                       </td>                     </tr>))}                 </tbody>               </table>             </section>           </>)}          {/* =================================================             AI MONITORING         ================================================= */}          {page === "AI Monitoring" && (<AIMonitoring />)}          {/* =================================================             ASSETS         ================================================= */}          {page === "Assets" && (<AssetTracking />)}          {/* =================================================             ZPL         ================================================= */}          {page === "ZPL Labels" && (<ZPLLabels />)}          {/* =================================================             REPORTS         ================================================= */}          {page === "Reports" && (<ReportsPage rows={rows} sum={sum} onRefresh={load}/>)}          {page === "Audit Logs" && currentUser?.role === "admin" && <AuditLogsPage />}          {/* =================================================             OTHER MODULES         ================================================= */}          {page !== "Dashboard" && page !== "AI Monitoring" && page !== "Assets" && page !== "ZPL Labels" && page !== "Reports" && page !== "Audit Logs" && (<section className="panel feature">               <h2>{page}</h2>                <p>                 {page === "Compliance" ? "Django Admin manages compliance checks and due dates." : page === "Audit Logs" ? "FastAPI records CREATE and DELETE actions; administrators can inspect /audit-logs." : "Dedicated module ready for expansion with live PostgreSQL-backed data."}               </p>                <div className="feature-grid">                 <div>                   <b>PostgreSQL</b>                   <span>                     Primary persistence                   </span>                 </div>                  <div>                   <b>GraphQL</b>                   <span>                     /graphql analytics API                   </span>                 </div>                  <div>                   <b>OAuth2</b>                   <span>                     Bearer access tokens                   </span>                 </div>                  <div>                   <b>Docker/Kubernetes</b>                   <span>                     Deployment manifests included                   </span>                 </div>                  <div>                   <b>Barcode / RFID</b>                   <span>                     Device endpoints + asset tags                   </span>                 </div>                  <div>                   <b>ZPL</b>                   <span>                     Label command endpoint                   </span>                 </div>               </div>             </section>)}       </main>     </div>);
}
/* =========================================================    AI CARBON INTELLIGENCE ========================================================= */ function CarbonIntelligence({ rows }: {
    rows: Row[];
}) {
    const [detections, setDetections] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    async function loadAIHistory() {
        if (!localStorage.getItem("ecotrack_token"))
            return;
        setLoading(true);
        try {
            const r = await fetch(`${API}/ai/detections`, { headers: authHeaders() });
            if (r.ok)
                setDetections(await r.json());
        }
        catch { // AI history is optional for this dashboard panel.     } finally {       setLoading(false);
        }
    }
    useEffect(() => {
        loadAIHistory();
    }, [rows.length]);
    const daily = useMemo(() => {
        const map = new Map<string, number>();
        rows.forEach((r) => {
            const day = String(r.date || "").slice(0, 10);
            if (!day)
                return;
            map.set(day, (map.get(day) || 0) + Number(r.emission || 0));
        });
        return Array.from(map.entries()).map(([date, emission]) => ({ date, emission })).sort((a, b) => a.date.localeCompare(b.date));
    }, [rows]);
    const insight = useMemo(() => {
        if (daily.length === 0)
            return { status: "No data", message: "Add consumption records to generate carbon intelligence.", peak: 0, average: 0, latest: 0 };
        const average = daily.reduce((sum, item) => sum + item.emission, 0) / daily.length;
        const peak = Math.max(...daily.map((item) => item.emission));
        const latest = daily[daily.length - 1].emission;
        const elevated = daily.length >= 2 && latest > average * 1.5;
        return { status: elevated ? "Attention" : "Normal", message: elevated ? `Latest daily emissions are ${((latest / average) * 100).toFixed(0)}% of the historical daily average.` : "Latest daily emissions are within the current historical range.", peak, average, latest, };
    }, [daily]);
    const latestAI = detections.length > 0 ? detections[0] : null;
    const averageVehicles = detections.length ? detections.reduce((total, item) => total + Number(item.vehicle_total || 0), 0) / detections.length : 0;
    const vehicleDelta = latestAI ? Number(latestAI.vehicle_total || 0) - averageVehicles : 0;
    const recommendations = useMemo(() => {
        const items: string[] = [];
        if (insight.status === "Attention")
            items.push("Review the latest day’s fuel, energy, and resource entries for an unusually high contribution.");
        if (latestAI && vehicleDelta > 0)
            items.push("The latest AI image contains more detected vehicles than the stored detection average; review related fuel or fleet records for context.");
        if (rows.some((r) => r.type === "Fuel"))
            items.push("Track fuel consumption against the same asset or vehicle tag consistently to improve fleet-level carbon analysis.");
        if (items.length === 0)
            items.push("Continue recording dated consumption and asset tags consistently so EcoTrack can build a stronger historical baseline.");
        return items;
    }, [insight.status, latestAI, vehicleDelta, rows]);
    return (<section className="panel">       <div className="title-row">         <div>           <h2>🤖 AI Carbon Intelligence</h2>           <p>Rule-based analysis of recorded CO₂ data and persisted YOLO vehicle detections. It provides decision support without inventing a vehicle-to-emission conversion.</p>         </div>         <button className="secondary" onClick={loadAIHistory} disabled={loading}>           {loading ? "Refreshing..." : "Refresh AI Insights"}         </button>       </div>        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, marginTop: 18 }}>         <div className="card"><span>Daily Average CO₂</span><strong>{insight.average.toFixed(2)} kg</strong><small>Current recorded baseline</small></div>         <div className="card"><span>Peak Daily CO₂</span><strong>{insight.peak.toFixed(2)} kg</strong><small>Highest recorded day</small></div>         <div className="card"><span>Latest Daily CO₂</span><strong>{insight.latest.toFixed(2)} kg</strong><small>Most recent recorded day</small></div>         <div className="card"><span>Latest AI Vehicles</span><strong>{latestAI ? Number(latestAI.vehicle_total || 0) : 0}</strong><small>{detections.length} saved AI scans</small></div>       </div>        <div style={{ marginTop: 18, padding: 16, borderRadius: 12, border: "1px solid #e5e7eb", background: insight.status === "Attention" ? "#fff7ed" : "#f0fdf4" }}>         <strong>{insight.status === "Attention" ? "⚠️ Attention" : "✅ Carbon status"}</strong>         <p style={{ marginBottom: 0 }}>{insight.message}</p>       </div>        <div style={{ marginTop: 18 }}>         <h3>AI-assisted recommendations</h3>         <ul style={{ marginTop: 8 }}>{recommendations.map((item, index) => <li key={index} style={{ marginBottom: 8 }}>{item}</li>)}</ul>       </div>        {latestAI && <div style={{ marginTop: 14, color: "#64748b", fontSize: 13 }}>         Latest YOLO scan: <b>{latestAI.filename}</b> • {latestAI.vehicle_total} vehicles • {(Number(latestAI.avg_confidence || 0) * 100).toFixed(1)}% average confidence{vehicleDelta > 0 && " • above stored vehicle-count average"}       </div>}     </section>);
}
/* =========================================================    REPORTS ========================================================= */ function ReportsPage({ rows, sum, onRefresh, }: {
    rows: Row[];
    sum: Summary;
    onRefresh: () => void;
}) {
    const energyRows = useMemo(() => rows.filter((r) => r.type === "Energy"), [rows]);
    const fuelRows = useMemo(() => rows.filter((r) => r.type === "Fuel"), [rows]);
    const resourceRows = useMemo(() => rows.filter((r) => r.type === "Resource"), [rows]);
    const energyEmission = useMemo(() => energyRows.reduce((total, r) => total + Number(r.emission || 0), 0), [energyRows]);
    const fuelEmission = useMemo(() => fuelRows.reduce((total, r) => total + Number(r.emission || 0), 0), [fuelRows]);
    const resourceEmission = useMemo(() => resourceRows.reduce((total, r) => total + Number(r.emission || 0), 0), [resourceRows]);
    const highestEmission = useMemo(() => {
        if (rows.length === 0)
            return null;
        return [...rows].sort((a, b) => Number(b.emission || 0) - Number(a.emission || 0))[0];
    }, [rows]);
    const totalEmission = Number(sum.total_emission_kg || 0);
    function percentage(value: number) {
        if (totalEmission <= 0)
            return 0;
        return ((value / totalEmission) * 100);
    }
    function exportCSV() {
        if (rows.length === 0) {
            alert("No report data available.");
            return;
        }
        const header = ["ID", "Type", "Quantity", "Unit", "Date", "CO2 Emission (kg)", "Source", "Asset Tag",];
        const csvRows = rows.map((r) => [r.id, r.type, r.quantity, r.unit, r.date, Number(r.emission || 0).toFixed(2), r.source || "", r.asset_tag || "",]);
        const csv = [header, ...csvRows,].map((row) => row.map((value) => {
            const text = String(value ?? "");
            return `"${text.replace(/"/g, '""')}"`;
        }).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;", });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `EcoTrack_Report_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
    function exportPDF() {
        if (rows.length === 0) {
            alert("No report data available.");
            return;
        }
        const today = new Date().toLocaleDateString();
        const total = totalEmission.toFixed(2);
        const energy = energyEmission.toFixed(2);
        const fuel = fuelEmission.toFixed(2);
        const resource = resourceEmission.toFixed(2);
        const tableRows = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((r) => `           <tr>             <td>${r.id}</td>             <td>${r.type}</td>             <td>${r.quantity} ${r.unit}</td>             <td>${r.date}</td>             <td>${Number(r.emission || 0).toFixed(2)}</td>             <td>${r.source || "manual"}</td>             <td>${r.asset_tag || "—"}</td>           </tr>         `).join("");
        const reportWindow = window.open("", "_blank", "width=1100,height=800");
        if (!reportWindow) {
            alert("Please allow pop-ups to generate the PDF report.");
            return;
        }
        reportWindow.document.write(`       <!DOCTYPE html>       <html>         <head>           <title>EcoTrack Sustainability Report</title>           <meta charset="UTF-8" />           <style>             body {               font-family: Arial, Helvetica, sans-serif;

               margin: 0;

               padding: 32px;

               color: #172033;

               background: #ffffff;

             }             .header {               border-bottom: 3px solid #16a34a;

               padding-bottom: 18px;

               margin-bottom: 24px;

             }             h1 { margin: 0 0 6px; color: #166534; }             h2 {               margin-top: 28px;

               color: #166534;

               border-bottom: 1px solid #d1d5db;

               padding-bottom: 7px;

             }             .muted { color: #64748b; }             .summary {               display: grid;

               grid-template-columns: repeat(4, 1fr);

               gap: 12px;

             }             .card {               border: 1px solid #d1d5db;

               border-radius: 10px;

               padding: 14px;

               background: #f8fafc;

             }             .card span {               display: block;

               font-size: 12px;

               color: #64748b;

               margin-bottom: 7px;

             }             .card strong {               font-size: 20px;

             }             .category {               display: inline-block;

               width: 30%;

               min-width: 190px;

               margin: 0 1% 12px 0;

               vertical-align: top;

               border: 1px solid #d1d5db;

               border-radius: 10px;

               padding: 14px;

               box-sizing: border-box;

             }             table {               width: 100%;

               border-collapse: collapse;

               margin-top: 12px;

               font-size: 11px;

             }             th, td {               border: 1px solid #d1d5db;

               padding: 7px;

               text-align: left;

             }             th {               background: #f0fdf4;

               color: #166534;

             }             .footer {               margin-top: 28px;

               padding-top: 12px;

               border-top: 1px solid #d1d5db;

               font-size: 11px;

               color: #64748b;

             }             @media print {               body { padding: 18px; }               .no-print { display: none; }               table { page-break-inside: auto; }               tr { page-break-inside: avoid; }             }           </style>         </head>         <body>           <div class="header">             <h1>🌱 EcoTrack</h1>             <div>Enterprise Sustainability Platform</div>             <div class="muted">Sustainability Emissions Report • Generated ${today}</div>           </div>            <h2>Executive Summary</h2>           <div class="summary">             <div class="card"><span>Total CO₂ Emissions</span><strong>${total} kg</strong></div>             <div class="card"><span>Total Records</span><strong>${sum.total_records}</strong></div>             <div class="card"><span>Energy Usage</span><strong>${sum.energy_usage} kWh</strong></div>             <div class="card"><span>Fuel Usage</span><strong>${sum.fuel_usage} L</strong></div>           </div>            <h2>Category-wise Carbon Emissions</h2>           <div class="category"><b>⚡ Energy</b><p>${energy} kg CO₂</p><small>${percentage(energyEmission).toFixed(1)}% of total emissions</small></div>           <div class="category"><b>⛽ Fuel</b><p>${fuel} kg CO₂</p><small>${percentage(fuelEmission).toFixed(1)}% of total emissions</small></div>           <div class="category"><b>♻️ Resources</b><p>${resource} kg CO₂</p><small>${percentage(resourceEmission).toFixed(1)}% of total emissions</small></div>            <h2>Highest Emission Record</h2>           ${highestEmission ? `<p><b>${highestEmission.type}</b> — ${highestEmission.quantity} ${highestEmission.unit} on ${highestEmission.date}, producing <b>${Number(highestEmission.emission || 0).toFixed(2)} kg CO₂</b>.</p>` : "<p>No records available.</p>"}            <h2>Detailed Emissions Data</h2>           <table>             <thead>               <tr>                 <th>ID</th>                 <th>Type</th>                 <th>Quantity</th>                 <th>Date</th>                 <th>CO₂ (kg)</th>                 <th>Source</th>                 <th>Asset Tag</th>               </tr>             </thead>             <tbody>${tableRows}</tbody>           </table>            <div class="footer">             EcoTrack report generated from the application's current PostgreSQL-backed consumption records.             Values shown are the records available at report-generation time.           </div>            <div class="no-print" style="margin-top:20px">             <button onclick="window.print()" style="padding:10px 16px;border:0;border-radius:8px;background:#16a34a;color:white;font-weight:700;cursor:pointer">               Print / Save as PDF             </button>           </div>         </body>       </html>     `);
        reportWindow.document.close();
        reportWindow.focus();
    }
    return (<section className="report-page">       {/* TOP ACTIONS */}        <div className="panel">         <div className="title-row">           <div>             <h2>               Sustainability Emissions Report             </h2>              <p>               Live analysis of environmental               consumption and carbon emissions.             </p>           </div>            <div className="report-actions">             <button onClick={onRefresh}>               Refresh Data             </button>              <button className="secondary" onClick={exportCSV}>               Export CSV             </button>              <button onClick={exportPDF}>               Download PDF             </button>           </div>         </div>       </div>        {/* SUMMARY */}        <section className="cards">         <Card t="Total Emissions" v={`${totalEmission.toFixed(2)} kg CO₂`}/>          <Card t="Total Records" v={String(sum.total_records)}/>          <Card t="Energy Emissions" v={`${energyEmission.toFixed(2)} kg`}/>          <Card t="Fuel Emissions" v={`${fuelEmission.toFixed(2)} kg`}/>       </section>        {/* CATEGORY ANALYSIS */}        <section className="panel">         <h2>           Emissions by Category         </h2>          <div className="report-category-grid">           <div className="report-category">             <div className="report-category-title">               <span>⚡ Energy</span>                <b>                 {percentage(energyEmission).toFixed(1)}                 %               </b>             </div>              <div className="report-bar">               <div className="report-bar-fill" style={{ width: `${Math.min(percentage(energyEmission), 100)}%`, }}/>             </div>              <small>               {energyRows.length} records •{" "}               {sum.energy_usage} kWh             </small>           </div>            <div className="report-category">             <div className="report-category-title">               <span>⛽ Fuel</span>                <b>                 {percentage(fuelEmission).toFixed(1)}                 %               </b>             </div>              <div className="report-bar">               <div className="report-bar-fill" style={{ width: `${Math.min(percentage(fuelEmission), 100)}%`, }}/>             </div>              <small>               {fuelRows.length} records •{" "}               {sum.fuel_usage} L             </small>           </div>            <div className="report-category">             <div className="report-category-title">               <span>♻️ Resources</span>                <b>                 {percentage(resourceEmission).toFixed(1)}                 %               </b>             </div>              <div className="report-bar">               <div className="report-bar-fill" style={{ width: `${Math.min(percentage(resourceEmission), 100)}%`, }}/>             </div>              <small>               {resourceRows.length} records •{" "}               {sum.resource_usage} units             </small>           </div>         </div>       </section>        {/* KEY INSIGHT */}        <section className="panel">         <h2>           Highest Emission Record         </h2>          {highestEmission ? (<div className="report-highlight">             <div>               <span>Type</span>               <strong>                 {highestEmission.type}               </strong>             </div>              <div>               <span>Quantity</span>               <strong>                 {highestEmission.quantity}{" "}                 {highestEmission.unit}               </strong>             </div>              <div>               <span>Date</span>               <strong>                 {highestEmission.date}               </strong>             </div>              <div>               <span>CO₂ Impact</span>               <strong>                 {Number(highestEmission.emission).toFixed(2)}{" "}                 kg               </strong>             </div>           </div>) : (<p>             No consumption records are             available yet.           </p>)}       </section>        {/* FULL REPORT TABLE */}        <section className="panel">         <div className="title-row">           <h2>             Detailed Emissions Report           </h2>            <span>             {rows.length} records           </span>         </div>          {rows.length === 0 ? (<p>             No consumption data available.           </p>) : (<table>             <thead>               <tr>                 <th>ID</th>                 <th>Type</th>                 <th>Quantity</th>                 <th>Date</th>                 <th>CO₂ kg</th>                 <th>Source</th>                 <th>Asset Tag</th>               </tr>             </thead>              <tbody>               {[...rows].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((r) => (<tr key={r.id}>                     <td>{r.id}</td>                      <td>                       <b>{r.type}</b>                     </td>                      <td>                       {r.quantity} {r.unit}                     </td>                      <td>{r.date}</td>                      <td>                       {Number(r.emission || 0).toFixed(2)}                     </td>                      <td>                       {r.source || "manual"}                     </td>                      <td>                       {r.asset_tag || "—"}                     </td>                   </tr>))}             </tbody>           </table>)}       </section>        {/* REPORT INFORMATION */}        <section className="panel feature">         <h2>           Report Information         </h2>          <div className="feature-grid">           <div>             <b>Data Source</b>             <span>               PostgreSQL-backed consumption               records             </span>           </div>            <div>             <b>Live Updates</b>             <span>               WebSocket-connected dashboard             </span>           </div>            <div>             <b>Analytics</b>             <span>               Energy, fuel and resource               emissions             </span>           </div>            <div>             <b>Export</b>             <span>               CSV sustainability report             </span>           </div>         </div>       </section>     </section>);
}
/* =========================================================    CARBON EMISSIONS CHART ========================================================= */ function CarbonEmissionChart({ rows }: {
    rows: Row[];
}) {
    const chartData = useMemo(() => {
        const grouped = new Map<string, number>();
        rows.forEach((r) => {
            const date = String(r.date || "").slice(0, 10);
            if (!date)
                return;
            grouped.set(date, (grouped.get(date) || 0) + Number(r.emission || 0));
        });
        return Array.from(grouped.entries()).map(([date, emission]) => ({ date, emission })).sort((a, b) => a.date.localeCompare(b.date));
    }, [rows]);
    const total = chartData.reduce((sum, item) => sum + item.emission, 0);
    const maxValue = Math.max(...chartData.map((item) => item.emission), 1);
    const width = 900;
    const height = 320;
    const left = 65;
    const right = 25;
    const top = 30;
    const bottom = 55;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    const points = chartData.map((item, index) => {
        const x = chartData.length === 1 ? left + chartWidth / 2 : left + (index / (chartData.length - 1)) * chartWidth;
        const y = top + chartHeight - (item.emission / maxValue) * chartHeight;
        return { ...item, x, y };
    });
    const linePoints = points.map((point) => `${point.x},${point.y}`).join(" ");
    const areaPoints = points.length > 0 ? `${left},${top + chartHeight} ${linePoints} ${points[points.length - 1].x},${top + chartHeight}` : "";
    return (<section className="panel">       <div className="title-row">         <div>           <h2>Carbon Emissions Trend</h2>           <p>             Daily CO₂ emissions calculated from             PostgreSQL-backed consumption records.           </p>         </div>          <div style={{ padding: "10px 14px", borderRadius: 10, background: "#ecfdf5", border: "1px solid #bbf7d0", textAlign: "right", }}>           <small>Total CO₂</small>           <strong style={{ display: "block", fontSize: 20, marginTop: 2, }}>             {total.toFixed(2)} kg           </strong>         </div>       </div>        {chartData.length === 0 ? (<div style={{ minHeight: 220, display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed #cbd5e1", borderRadius: 12, marginTop: 18, color: "#64748b", background: "#f8fafc", }}>           Add consumption records to display the           carbon-emission graph.         </div>) : (<div style={{ marginTop: 18, overflowX: "auto", background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, }}>           <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="320" role="img" aria-label="Carbon emissions trend graph" style={{ minWidth: chartData.length > 7 ? `${Math.max(760, chartData.length * 90)}px` : "100%", display: "block", }}>             {Array.from({ length: 5 }).map((_, i) => {
                const value = (maxValue / 4) * (4 - i);
                const y = top + (i / 4) * chartHeight;
                return (<g key={`tick-${i}`}>                   <line x1={left} y1={y} x2={width - right} y2={y} stroke="#e2e8f0" strokeWidth="1"/>                   <text x={left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="#64748b">                     {value.toFixed(1)}                   </text>                 </g>);
            })}              <text x="18" y={top + chartHeight / 2} transform={`rotate(-90 18 ${top + chartHeight / 2})`} textAnchor="middle" fontSize="11" fill="#64748b">               CO₂ (kg)             </text>              {points.length > 1 && (<polygon points={areaPoints} fill="#dcfce7" opacity="0.75"/>)}              {points.length > 1 && (<polyline points={linePoints} fill="none" stroke="#16a34a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>)}              {points.map((point) => (<g key={point.date}>                 <circle cx={point.x} cy={point.y} r="6" fill="#ffffff" stroke="#16a34a" strokeWidth="3"/>                  <text x={point.x} y={point.y - 12} textAnchor="middle" fontSize="11" fontWeight="700" fill="#166534">                   {point.emission.toFixed(2)}                 </text>                  <text x={point.x} y={height - 28} textAnchor="middle" fontSize="11" fill="#475569">                   {point.date}                 </text>               </g>))}              <line x1={left} y1={top + chartHeight} x2={width - right} y2={top + chartHeight} stroke="#94a3b8" strokeWidth="1"/>           </svg>         </div>)}        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 12, color: "#64748b", fontSize: 13, }}>         <span>           <b>Records:</b> {rows.length}         </span>         <span>           <b>Days:</b> {chartData.length}         </span>         <span>           <b>Peak daily CO₂:</b> {maxValue.toFixed(2)} kg         </span>       </div>     </section>);
}
function CategoryCarbonAnalytics({ rows }: {
    rows: Row[];
}) {
    const categoryData = useMemo(() => {
        const categories: T[] = ["Energy", "Fuel", "Resource"];
        return categories.map((type) => ({ type, emission: rows.filter((r) => r.type === type).reduce((total, r) => total + Number(r.emission || 0), 0), records: rows.filter((r) => r.type === type).length, }));
    }, [rows]);
    const totalEmission = categoryData.reduce((total, item) => total + item.emission, 0);
    const highest = [...categoryData].sort((a, b) => b.emission - a.emission)[0];
    const maxEmission = Math.max(...categoryData.map((item) => item.emission), 1);
    return (<section className="panel">       <div className="title-row">         <div>           <h2>Category-wise Carbon Analytics</h2>           <p>             CO₂ contribution from Energy, Fuel, and Resource consumption.           </p>         </div>          <div style={{ padding: "10px 14px", borderRadius: 10, background: "#f0fdf4", border: "1px solid #bbf7d0", textAlign: "right", }}>           <small>Total CO₂</small>           <strong style={{ display: "block", fontSize: 20, marginTop: 2, }}>             {totalEmission.toFixed(2)} kg           </strong>         </div>       </div>        {totalEmission <= 0 ? (<div style={{ marginTop: 18, padding: 24, textAlign: "center", border: "1px dashed #cbd5e1", borderRadius: 12, color: "#64748b", background: "#f8fafc", }}>           Add consumption records to display category-wise carbon analytics.         </div>) : (<div style={{ display: "grid", gap: 18, marginTop: 18, }}>           {categoryData.map((item) => {
                const percentage = totalEmission > 0 ? (item.emission / totalEmission) * 100 : 0;
                return (<div key={item.type}>                 <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 7, }}>                   <strong>{item.type}</strong>                   <span>                     {item.emission.toFixed(2)} kg CO₂ · {percentage.toFixed(1)}%                   </span>                 </div>                  <div style={{ height: 18, background: "#e2e8f0", borderRadius: 999, overflow: "hidden", }}>                   <div style={{ width: `${Math.max(1, (item.emission / maxEmission) * 100)}%`, height: "100%", background: "#16a34a", borderRadius: 999, transition: "width 0.3s ease", }}/>                 </div>                  <small style={{ color: "#64748b" }}>                   {item.records} consumption record{item.records === 1 ? "" : "s"}                 </small>               </div>);
            })}         </div>)}        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 18, paddingTop: 14, borderTop: "1px solid #e5e7eb", color: "#475569", fontSize: 13, }}>         <span>           <b>Highest category:</b> {totalEmission > 0 ? highest.type : "—"}         </span>         <span>           <b>Highest CO₂:</b> {totalEmission > 0 ? `${highest.emission.toFixed(2)} kg` : "—"}         </span>         <span>           <b>Tracked records:</b> {rows.length}         </span>       </div>     </section>);
}
/* =========================================================    ASSET TRACKING ========================================================= */ function AssetTracking() {
    const [assets, setAssets] = useState<any[]>([]);
    const [scans, setScans] = useState<any[]>([]);
    const [form, setForm] = useState({ asset_tag: "", name: "", category: "Equipment", location: "Main Facility", barcode: "", rfid_tag: "", });
    const [scan, setScan] = useState({ tag: "", scan_type: "BARCODE", location: "Main Facility", });
    const [message, setMessage] = useState("");
    async function load() {
        try {
            const [a, b] = await Promise.all([fetch(`${API}/assets`, { headers: authHeaders(), }), fetch(`${API}/assets/scans`, { headers: authHeaders(), }),]);
            if (a.status === 401 || b.status === 401) {
                setMessage("Session expired. Please sign in again.");
                return;
            }
            if (a.ok) {
                setAssets(await a.json());
            }
            if (b.ok) {
                setScans(await b.json());
            }
        }
        catch {
            setMessage("Could not connect to the EcoTrack backend.");
        }
    }
    useEffect(() => {
        load();
    }, []);
    async function register() {
        if (!form.asset_tag || !form.name) {
            alert("Enter Asset Tag and Asset Name");
            return;
        }
        try {
            const r = await fetch(`${API}/assets`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(), }, body: JSON.stringify({ ...form, barcode: form.barcode || null, rfid_tag: form.rfid_tag || null, }), });
            const d = await r.json().catch(() => ({ detail: "Backend did not return JSON", }));
            if (!r.ok) {
                alert(d.detail || `Could not register asset (HTTP ${r.status})`);
                return;
            }
            setMessage(`Asset ${d.asset_tag} registered successfully.`);
            setForm({ asset_tag: "", name: "", category: "Equipment", location: "Main Facility", barcode: "", rfid_tag: "", });
            load();
        }
        catch {
            alert("Backend is not reachable.");
        }
    }
    async function doScan() {
        if (!scan.tag.trim()) {
            alert("Enter or scan a barcode/RFID tag");
            return;
        }
        try {
            const r = await fetch(`${API}/assets/scan`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(), }, body: JSON.stringify(scan), });
            const d = await r.json().catch(() => ({ message: `Backend error (HTTP ${r.status})`, }));
            if (!r.ok) {
                setMessage(`✕ ${d.detail || d.message || `Scan failed (HTTP ${r.status})`}`);
                return;
            }
            setMessage(d.found ? `✓ Asset found: ${d.asset.name} (${d.asset.asset_tag})` : `✕ ${d.message}`);
            setScan({ ...scan, tag: "", });
            load();
        }
        catch {
            setMessage("✕ Backend is not reachable.");
        }
    }
    return (<section className="asset-page">       <div className="panel">         <div className="title-row">           <div>             <h2>               Barcode + RFID Asset Tracking             </h2>              <p>               Register assets and record               barcode/RFID scans in PostgreSQL.             </p>           </div>            <span className="status-ok">             SECURE SCAN           </span>         </div>          <div className="asset-grid">           <div className="asset-card">             <h3>Register Asset</h3>              <input placeholder="Asset Tag *" value={form.asset_tag} onChange={(e) => setForm({ ...form, asset_tag: e.target.value, })}/>              <input placeholder="Asset Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, })}/>              <input placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value, })}/>              <input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value, })}/>              <input placeholder="Barcode value" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value, })}/>              <input placeholder="RFID tag value" value={form.rfid_tag} onChange={(e) => setForm({ ...form, rfid_tag: e.target.value, })}/>              <button onClick={register}>               + Register Asset             </button>           </div>            <div className="asset-card">             <h3>Scan Asset</h3>              <select value={scan.scan_type} onChange={(e) => setScan({ ...scan, scan_type: e.target.value, })}>               <option value="BARCODE">                 📷 Barcode Scanner               </option>                <option value="RFID">                 📡 RFID Reader               </option>             </select>              <input autoFocus placeholder="Scan / enter tag value" value={scan.tag} onChange={(e) => setScan({ ...scan, tag: e.target.value, })} onKeyDown={(e) => {
            if (e.key === "Enter") {
                doScan();
            }
        }}/>              <input placeholder="Scan location" value={scan.location} onChange={(e) => setScan({ ...scan, location: e.target.value, })}/>              <button onClick={doScan}>               Record {scan.scan_type} Scan             </button>              {message && (<div className="scan-message">                 {message}               </div>)}              <small>               For hardware scanners,               configure the device to send               its scanned value as keyboard               input or through its vendor               SDK/API.             </small>           </div>         </div>       </div>        <div className="panel">         <div className="title-row">           <h2>             Registered Assets ({assets.length})           </h2>            <button onClick={load}>             Refresh           </button>         </div>          <table>           <thead>             <tr>               <th>Asset Tag</th>               <th>Name</th>               <th>Category</th>               <th>Location</th>               <th>Barcode</th>               <th>RFID</th>               <th>Status</th>             </tr>           </thead>            <tbody>             {assets.map((a) => (<tr key={a.id}>                 <td>                   <b>{a.asset_tag}</b>                 </td>                  <td>{a.name}</td>                  <td>{a.category}</td>                  <td>{a.location}</td>                  <td>                   {a.barcode || "—"}                 </td>                  <td>                   {a.rfid_tag || "—"}                 </td>                  <td>{a.status}</td>               </tr>))}           </tbody>         </table>       </div>        <div className="panel">         <div className="title-row">           <h2>             Recent Scan History           </h2>            <span>             {scans.length} records           </span>         </div>          <table>           <thead>             <tr>               <th>Tag</th>               <th>Type</th>               <th>User</th>               <th>Location</th>               <th>Result</th>               <th>Time</th>             </tr>           </thead>            <tbody>             {scans.map((s) => (<tr key={s.id}>                 <td>{s.asset_tag}</td>                  <td>{s.scan_type}</td>                  <td>{s.username}</td>                  <td>{s.location}</td>                  <td>{s.result}</td>                  <td>                   {new Date(s.created_at).toLocaleString()}                 </td>               </tr>))}           </tbody>         </table>       </div>     </section>);
}
/* =========================================================    ZPL LABELS ========================================================= */ function ZPLLabels() {
    const [tag, setTag] = useState("");
    const [zpl, setZpl] = useState("");
    const [message, setMessage] = useState("");
    async function generate() {
        if (!tag.trim()) {
            alert("Enter an asset tag");
            return;
        }
        try {
            const r = await fetch(`${API}/device/zpl/${encodeURIComponent(tag.trim())}`, { headers: authHeaders(), });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) {
                alert(d.detail || `Could not generate ZPL (HTTP ${r.status})`);
                return;
            }
            setZpl(d.zpl || "");
            setMessage("ZPL generated successfully.");
        }
        catch {
            alert("Backend is not reachable.");
        }
    }
    async function copy() {
        try {
            await navigator.clipboard.writeText(zpl);
            setMessage("ZPL copied to clipboard.");
        }
        catch {
            setMessage("Could not copy automatically. Select and copy the ZPL text.");
        }
    }
    function downloadZPL() {
        const blob = new Blob([zpl], { type: "text/plain", });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${tag || "asset"}.zpl`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    return (<section className="panel zpl-panel">       <h2>ZPL Label Printing</h2>        <p>         Generate Zebra Programming         Language commands for registered         asset labels.       </p>        <div className="form zpl-form">         <input placeholder="Asset Tag e.g. ASSET-001" value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => {
            if (e.key === "Enter") {
                generate();
            }
        }}/>          <button onClick={generate}>           Generate ZPL         </button>       </div>        {zpl && (<>           <textarea className="zpl-box" value={zpl} readOnly/>            <div className="zpl-actions">             <button onClick={copy}>               Copy ZPL             </button>              <button className="secondary" onClick={downloadZPL}>               Download .zpl             </button>           </div>            {message && (<small>{message}</small>)}         </>)}        {!zpl && message && (<div className="scan-message">           {message}         </div>)}        <div className="note">         This generates the printer command.         A physical Zebra printer still         needs to be connected/configured         through USB or network printing.       </div>     </section>);
}
/* =========================================================    AI MONITORING ========================================================= */ function AIMonitoring() {
    const [file, setFile] = useState<File | null>(null);
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [result, setResult] = useState<AIResult | null>(null);
    const [health, setHealth] = useState<AIHealth | null>(null);
    const [busy, setBusy] = useState(false);
    const [savedId, setSavedId] = useState<number | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    useEffect(() => {
        if (!file) {
            setImageUrl(null);
            return;
        }
        const url = URL.createObjectURL(file);
        setImageUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);
    async function checkHealth() {
        try {
            const r = await fetch(`${AI_API}/health`);
            if (!r.ok) {
                setHealth(null);
                return;
            }
            setHealth(await r.json());
        }
        catch {
            setHealth(null);
        }
    }
    useEffect(() => {
        checkHealth();
    }, []);
    async function detect() {
        if (!file) {
            alert("Choose an image first.");
            return;
        }
        setBusy(true);
        setResult(null);
        setSavedId(null);
        setSaveError(null);
        try {
            const fd = new FormData();
            fd.append("file", file);
            const r = await fetch(`${AI_API}/detect`, { method: "POST", body: fd, });
            if (!r.ok) {
                throw new Error("Detection failed");
            }
            const data = await r.json();
            setResult(data);
            // Persist the AI result in PostgreSQL through the EcoTrack backend.
            try {
                const saveResponse = await fetch(`${API}/ai/detections`, {
                    method: "POST",
                    headers: {
                        ...authHeaders(),
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        filename: file.name,
                        width: data.width,
                        height: data.height,
                        object_count: data.detections?.length ?? 0,
                        vehicle_total: data.vehicle_total ?? 0,
                        vehicle_counts: data.vehicle_counts ?? {},
                        detections: data.detections ?? [],
                    }),
                });
                if (!saveResponse.ok) {
                    throw new Error("Could not save AI result");
                }
                const saved = await saveResponse.json();
                setSavedId(saved.id ?? null);
            }
            catch {
                setSaveError("AI detection worked, but the result could not be saved to PostgreSQL.");
            }
        }
        catch {
            alert("AI service is not reachable. Start Uvicorn on port 8001.");
        }
        finally {
            setBusy(false);
        }
    }
    return (<section className="panel ai-panel">       <div className="ai-header">         <div>           <h2>             Computer Vision AI Monitoring           </h2>            <p>             OpenCV preprocessing + YOLO             object detection through the             EcoTrack AI service.           </p>         </div>          <div className={health?.model_loaded ? "status-ok" : "status-warn"}>           {health?.model_loaded ? "YOLO MODEL LOADED" : "MODEL NOT LOADED"}         </div>       </div>        <div className="ai-upload">         <input type="file" accept="image/*" onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setResult(null);
        }}/>          <button onClick={detect} disabled={busy}>           {busy ? "Analyzing..." : "Run AI Detection"}         </button>          <button className="secondary" onClick={checkHealth}>           Check AI Service         </button>       </div>        {health && (<div className="health-box">           <b>AI Service:</b>{" "}           {health.service}            &nbsp;

            <b>OpenCV:</b>{" "}           {health.opencv}            &nbsp;

            <b>YOLO:</b>{" "}           {health.model_loaded ? "Ready" : "Unavailable"}         </div>)}        {savedId && (<div className="health-box" style={{ marginTop: 12 }}>           <b>PostgreSQL:</b> AI detection saved successfully (Record #{savedId})         </div>)}        {saveError && (<div className="health-box" style={{ marginTop: 12 }}>           <b>PostgreSQL:</b> {saveError}         </div>)}        {imageUrl && (<div className="panel" style={{ marginTop: 20, background: "#f8fafc", }}>           <div className="title-row">             <div>               <h2>YOLO Detection Preview</h2>               <p>                 Uploaded image with detected objects                 highlighted using bounding boxes.               </p>             </div>              {result && (<span className="status-ok">                 {result.detections.length} OBJECT                 {result.detections.length === 1 ? "" : "S"} DETECTED               </span>)}           </div>            <div style={{ marginTop: 18, width: "100%", overflow: "auto", background: "#111827", borderRadius: 12, padding: 16, boxSizing: "border-box", textAlign: "center", }}>             <div style={{ position: "relative", display: "inline-block", maxWidth: "100%", lineHeight: 0, }}>               <img src={imageUrl} alt="Uploaded image for YOLO detection" style={{ display: "block", maxWidth: "100%", height: "auto", maxHeight: "650px", borderRadius: 8, }}/>                {result && result.detections.map((d, i) => {
                if (!d.box || d.box.length !== 4 || !result.width || !result.height) {
                    return null;
                }
                const [x1, y1, x2, y2] = d.box;
                const left = (x1 / result.width) * 100;
                const top = (y1 / result.height) * 100;
                const width = ((x2 - x1) / result.width) * 100;
                const height = ((y2 - y1) / result.height) * 100;
                const name = classNames[d.class] || `class ${d.class}`;
                const confidence = d.confidence * 100;
                return (<div key={`${d.class}-${i}`} style={{ position: "absolute", left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`, border: "3px solid #22c55e", borderRadius: 4, boxSizing: "border-box", pointerEvents: "none", }}>                       <div style={{ position: "absolute", left: -3, top: -29, background: "#22c55e", color: "#fff", padding: "5px 8px", borderRadius: "4px 4px 0 0", fontSize: 12, fontWeight: 700, lineHeight: "16px", whiteSpace: "nowrap", boxShadow: "0 2px 6px rgba(0,0,0,0.3)", }}>                         {name} {confidence.toFixed(1)}%                       </div>                     </div>);
            })}             </div>           </div>            {result && (<div style={{ marginTop: 18, padding: 18, borderRadius: 12, background: "#ecfdf5", border: "1px solid #bbf7d0", }}>               <div className="title-row">                 <div>                   <h2 style={{ margin: 0 }}>Vehicle Detection Summary</h2>                   <p style={{ marginBottom: 0 }}>                     YOLO-counted road vehicles from the uploaded image.                   </p>                 </div>                 <span className="status-ok">                   {result.vehicle_total ?? 0} VEHICLES                 </span>               </div>                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 16, }}>                 {["car", "motorcycle", "bus", "truck"].map((vehicle) => (<div key={vehicle} style={{ background: "#ffffff", border: "1px solid #d1fae5", borderRadius: 10, padding: 14, }}>                     <div style={{ textTransform: "capitalize", fontWeight: 700 }}>                       {vehicle}                     </div>                     <strong style={{ fontSize: 26 }}>                       {result.vehicle_counts?.[vehicle] ?? 0}                     </strong>                   </div>))}               </div>             </div>)}            {result && (<div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 16, paddingTop: 16, borderTop: "1px solid #e5e7eb", }}>               <div>                 <b>Image Width</b>                 <div>{result.width}px</div>               </div>               <div>                 <b>Image Height</b>                 <div>{result.height}px</div>               </div>               <div>                 <b>Objects</b>                 <div>{result.detections.length}</div>               </div>             </div>)}         </div>)}        {result && (<div className="ai-results">           <div className="result-cards">             <Card t="Image Size" v={`${result.width} × ${result.height}`}/>              <Card t="Preprocessing" v={result.preprocessed}/>              <Card t="Detections" v={String(result.detections.length)}/>              <Card t="Vehicles" v={String(result.vehicle_total ?? 0)}/>           </div>            {result.note && (<p className="note">               {result.note}             </p>)}            {result.detections.length > 0 && (<table>               <thead>                 <tr>                   <th>#</th>                   <th>Class</th>                   <th>Confidence</th>                   <th>                     Bounding Box                   </th>                 </tr>               </thead>                <tbody>                 {result.detections.map((d, i) => (<tr key={i}>                       <td>{i + 1}</td>                        <td>                         {classNames[d.class] || `class ${d.class}`}                       </td>                        <td>                         {(d.confidence * 100).toFixed(1)}                         %                       </td>                        <td>                         [                         {d.box.join(", ")}                         ]                       </td>                     </tr>))}               </tbody>             </table>)}         </div>)}     </section>);
}
/* =========================================================    AUDIT LOGS / SECURITY ========================================================= */ function AuditLogsPage() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [users, setUsers] = useState<CurrentUser[]>([]);
    const [loading, setLoading] = useState(true);
    async function loadSecurity() {
        setLoading(true);
        try {
            const [a, u] = await Promise.all([fetch(`${API}/audit-logs`, { headers: authHeaders() }), fetch(`${API}/security/users`, { headers: authHeaders() }),]);
            if (a.status === 403 || u.status === 403) {
                alert("Admin permission required.");
                return;
            }
            if (a.ok)
                setLogs(await a.json());
            if (u.ok)
                setUsers(await u.json());
        }
        catch {
            alert("Backend is not reachable.");
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => { loadSecurity(); }, []);
    return (<section className="report-page">       <section className="cards">         <Card t="Current Access" v="ADMIN"/>         <Card t="Users" v={String(users.length)}/>         <Card t="Audit Events" v={String(logs.length)}/>         <Card t="Protected API" v="JWT + RBAC"/>       </section>       <section className="panel">         <div className="title-row">           <div><h2>Enterprise Security</h2><p>Role-based access control and protected administrative operations.</p></div>           <button onClick={loadSecurity}>Refresh</button>         </div>         <div className="feature-grid">           {users.map((u) => <div key={u.username}><b>{u.username}</b><span>{u.role} role</span></div>)}         </div>       </section>       <section className="panel">         <div className="title-row"><h2>Audit Logs</h2><span>{loading ? "Loading..." : `${logs.length} events`}</span></div>         {logs.length === 0 ? <p>No audit events available yet.</p> : (<div style={{ overflowX: "auto" }}>             <table><thead><tr><th>ID</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th><th>Time</th></tr></thead>               <tbody>{logs.map((log) => <tr key={log.id}><td>{log.id}</td><td><b>{log.username}</b></td><td>{log.action}</td><td>{log.entity}</td><td>{log.details}</td><td>{log.created_at ? new Date(log.created_at).toLocaleString() : "—"}</td></tr>)}</tbody>             </table>           </div>)}       </section>     </section>);
}
/* =========================================================    CARD ========================================================= */ function Card(p: {
    t: string;
    v: string;
}) { return (<div className="card">       <span>{p.t}</span>        <strong>{p.v}</strong>        <small>         Live PostgreSQL-backed metric       </small>     </div>); }
export default App;
