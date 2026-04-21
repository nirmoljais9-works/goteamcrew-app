import { Router } from "express";

const router = Router();

const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || "";

router.get("/places/autocomplete", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q || q.length < 2) return res.json({ predictions: [] });
  if (!MAPS_KEY) return res.status(503).json({ error: "Maps API key not configured" });

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.set("input", q);
    url.searchParams.set("key", MAPS_KEY);
    url.searchParams.set("components", "country:in");
    url.searchParams.set("types", "establishment|geocode");
    url.searchParams.set("language", "en");

    const response = await fetch(url.toString());
    const data: any = await response.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("[places/autocomplete] status:", data.status, data.error_message);
    }

    res.json({ predictions: data.predictions || [] });
  } catch (err: any) {
    console.error("[places/autocomplete] error:", err.message);
    res.status(500).json({ error: "Failed to fetch predictions" });
  }
});

router.get("/places/details", async (req, res) => {
  const placeId = String(req.query.place_id || "").trim();
  if (!placeId) return res.status(400).json({ error: "place_id required" });
  if (!MAPS_KEY) return res.status(503).json({ error: "Maps API key not configured" });

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.set("place_id", placeId);
    url.searchParams.set("key", MAPS_KEY);
    url.searchParams.set("fields", "name,geometry,formatted_address");
    url.searchParams.set("language", "en");

    const response = await fetch(url.toString());
    const data: any = await response.json();

    if (data.status !== "OK") {
      console.error("[places/details] status:", data.status, data.error_message);
      return res.status(502).json({ error: data.status });
    }

    const loc = data.result?.geometry?.location;
    res.json({
      name: data.result?.name || "",
      formatted_address: data.result?.formatted_address || "",
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
    });
  } catch (err: any) {
    console.error("[places/details] error:", err.message);
    res.status(500).json({ error: "Failed to fetch place details" });
  }
});

export default router;
